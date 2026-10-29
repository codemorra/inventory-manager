import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const targets = process.argv.slice(2);
if (targets.length === 0) targets.push("frontend", "backend");
if (targets.some((target) => !["frontend", "backend"].includes(target))) {
  throw new Error("Expected frontend or backend as the generation target.");
}
const { version } = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
);
if (typeof version !== "string" || version.trim() === "") {
  throw new Error("The root package.json must define an application version.");
}
const source = `// Generated from the root package.json. Do not edit.\nexport const APP_VERSION = ${JSON.stringify(version)};\n`;
for (const target of targets) {
  const directory = new URL(`${target}/src/generated/`, root);
  const output = new URL("app-version.ts", directory);
  await mkdir(directory, { recursive: true });
  const previous = await readFile(output, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return undefined;
  });
  if (previous !== source) await writeFile(output, source);
}
