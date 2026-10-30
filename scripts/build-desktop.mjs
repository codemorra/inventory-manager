import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  nodeDistribution,
  prepareBuildRuntime,
} from "../desktop/scripts/build-runtime.mjs";
import { npm } from "../desktop/scripts/prepare.mjs";
import { verifyPackageFiles } from "../desktop/scripts/package-content.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

/**
 * Assemble the Electron application with the version from the root package.
 * @returns {Promise<void>} Resolves when the application files are ready.
 * @throws {Error} When the application version or files are invalid.
 */
export async function prepareDesktopApp() {
  const { version } = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version))
    throw new Error(
      "The root package.json must define an X.Y.Z application version.",
    );
  const app = join(root, "build/.work/app");
  await mkdir(app, { recursive: true });
  await rm(join(app, "dist"), { recursive: true, force: true });
  await cp(join(root, "desktop/dist"), join(app, "dist"), { recursive: true });
  await cp(join(root, "LICENSE"), join(app, "LICENSE"));
  await writeFile(
    join(app, "package.json"),
    JSON.stringify(
      {
        name: "inventory-manager",
        productName: "Inventory Manager",
        version,
        description: "Local inventory management",
        author: "Christopher Kranz",
        type: "module",
        main: "dist/main.js",
      },
      null,
      2,
    ) + "\n",
  );
}

/**
 * Select the requested desktop build format.
 * @param {string[]} args Command-line arguments.
 * @returns {"onefile" | "onedir"} Requested build format.
 * @throws {Error} When arguments are unsupported.
 */
export function desktopBuildFormat(args) {
  if (args.length === 0) return "onefile";
  if (args.length === 1 && args[0] === "--dir") return "onedir";
  throw new Error("Expected no arguments or --dir.");
}

/**
 * Replace a generated result only after the new build has been verified.
 * @param {string} source Verified build file or directory.
 * @param {string} destination Final output path.
 * @returns {Promise<void>} Resolves after the result is moved into place.
 * @throws {Error} When publication or recovery fails.
 */
export async function publishDesktopBuild(source, destination) {
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  const backupDirectory = await mkdtemp(join(parent, ".previous-build-"));
  const backup = join(backupDirectory, "previous");
  let hasBackup = false;
  let safeToRemove = false;
  try {
    try {
      await rename(destination, backup);
      hasBackup = true;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      await rename(source, destination);
    } catch (error) {
      if (hasBackup) {
        await rename(backup, destination);
        hasBackup = false;
      }
      throw error;
    }
    safeToRemove = true;
  } finally {
    if (safeToRemove || !hasBackup)
      await rm(backupDirectory, { recursive: true, force: true });
  }
}

/**
 * Install dependencies and build a desktop application for the host system.
 * @param {"onefile" | "onedir"} format Requested build format.
 * @returns {Promise<void>} Resolves after the local artifact is built.
 * @throws {Error} When the platform, installation or build is unsupported or fails.
 */
export async function buildDesktop(format) {
  nodeDistribution(process.platform, process.arch);
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Desktop builds require Node.js 24 or later.");
  for (const prefix of [".", "backend", "frontend", "desktop"])
    await npm(["--prefix", prefix, "ci"]);
  await prepareBuildRuntime();
  await prepareDesktopApp();
  const output = join(root, "build", format);
  const packageArguments = [
    "--prefix",
    "desktop",
    "run",
    "package:local",
    "--",
    process.platform === "win32" ? "--win" : "--linux",
    "--x64",
  ];
  if (format === "onedir")
    packageArguments.push("--dir", `--config.directories.output=${output}`);
  await npm(packageArguments);
  const unpacked =
    process.platform === "win32" ? "win-unpacked" : "linux-unpacked";
  const resources = join(
    root,
    "build",
    format,
    unpacked,
    "resources/app-runtime",
  );
  for (const name of ["backend", "frontend", "node", "icons"])
    await verifyPackageFiles(
      join(root, "build/.work/runtime", name),
      join(resources, name),
    );
  let source;
  if (format === "onefile") {
    const { version } = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    );
    const suffix =
      process.platform === "win32" ? "win-x64.exe" : "linux-x64.AppImage";
    source = join(output, `Inventory-Manager-${version}-${suffix}`);
    await access(source);
  } else {
    await access(
      join(
        output,
        unpacked,
        process.platform === "win32"
          ? "Inventory Manager.exe"
          : "inventory-manager",
      ),
    );
    source = join(output, unpacked);
  }
  const destination = join(
    root,
    "dist",
    format,
    format === "onedir" ? "inventory-manager" : basename(source),
  );
  await publishDesktopBuild(source, destination);
  console.log(`Desktop build available in ${destination}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await buildDesktop(desktopBuildFormat(process.argv.slice(2)));
