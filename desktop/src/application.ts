import { app, BrowserWindow, dialog } from "electron";
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectBackend } from "./backend-controller.js";
import { APP_VERSION } from "./generated/app-version.js";
import { desktopMessages } from "./messages.js";
import { desktopPaths } from "./paths.js";

/**
 * Start the desktop host, wait for its backend and show the shared application UI.
 * @param options Optional hidden-window mode for Electron integration tests.
 * @returns The running window and backend, or undefined when startup is cancelled.
 * @throws {Error} When configuration, startup or page loading fails.
 */
export async function startDesktop(options: { show?: boolean } = {}) {
  app.setName("Inventory Manager");
  const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
  const paths = desktopPaths({
    packaged: app.isPackaged,
    platform: process.platform,
    homeDirectory: app.getPath("home"),
    userTemporaryDirectory: app.getPath("temp"),
    repositoryRoot,
    environment: process.env,
  });
  const configDirectory = join(paths.storageRoot, "config");
  const logsDirectory = join(paths.storageRoot, "logs");
  const sessionDirectory = join(paths.tempDirectory, "chromium");
  for (const path of [configDirectory, logsDirectory, sessionDirectory])
    mkdirSync(path, { recursive: true, mode: 0o700 });
  app.setPath("userData", join(configDirectory, "desktop"));
  mkdirSync(app.getPath("userData"), { recursive: true, mode: 0o700 });
  app.setPath("sessionData", sessionDirectory);

  /**
   * Record desktop host failures separately from the backend's rotating log.
   * @param error The startup, runtime or persistence failure.
   */
  function report(error: unknown) {
    console.error(error);
    try {
      appendFileSync(
        join(logsDirectory, "desktop.log"),
        `${new Date().toISOString()} ${String(error instanceof Error ? error.stack : error)}\n`,
        { mode: 0o600 },
      );
    } catch (failure) {
      console.error("Unable to write the desktop log:", failure);
    }
  }
  /**
   * Resolve native dialog language from saved preferences.
   * @returns The saved language or the operating-system locale.
   */
  function language(): string {
    try {
      const settings = JSON.parse(
        readFileSync(join(configDirectory, "settings.json"), "utf8"),
      );
      if (["de", "en"].includes(settings.preferences?.language))
        return settings.preferences.language;
    } catch {
      /* Startup may precede initial settings creation. */
    }
    return app.getLocale();
  }
  let window: BrowserWindow | undefined;
  let backend: ReturnType<typeof connectBackend> | undefined;
  let shutdown: Promise<void> | undefined;
  let allowQuit = false;
  let backendFailed = false;
  let startupFailed = false;
  let starting = true;
  let resolveStopped: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  /**
   * Drain active backend work before allowing Electron to exit.
   * @returns Completion after cleanup, with failures reported in a native dialog.
   */
  function stop() {
    shutdown ??= (async () => {
      try {
        await backend?.stop();
      } catch (error) {
        report(error);
        if (!backendFailed && !startupFailed)
          dialog.showErrorBox(
            "Inventory Manager",
            desktopMessages(language()).shutdownFailed,
          );
      } finally {
        allowQuit = true;
        resolveStopped();
        app.quit();
      }
    })();
    return shutdown;
  }
  app.on("before-quit", (event) => {
    if (allowQuit) return;
    event.preventDefault();
    if (window && !window.isDestroyed()) window.close();
    else void stop();
  });
  app.on("window-all-closed", () => {
    if (!starting) void stop();
  });
  process.once("SIGINT", () => app.quit());
  process.once("SIGTERM", () => app.quit());

  await app.whenReady();
  app.setAboutPanelOptions({
    applicationName: "Inventory Manager",
    applicationVersion: APP_VERSION,
  });
  const runtimeDirectory = app.isPackaged
    ? join(process.resourcesPath, "app-runtime")
    : join(repositoryRoot, ".local/desktop-runtime");
  try {
    const nodeExecutable = app.isPackaged
      ? join(
          runtimeDirectory,
          "node",
          process.platform === "win32" ? "node.exe" : "bin/node",
        )
      : process.env.INVENTORY_NODE_EXECUTABLE;
    if (!nodeExecutable)
      throw new Error(
        "Start the desktop application through npm run dev:desktop.",
      );
    const environment = { ...process.env };
    delete environment.ELECTRON_RUN_AS_NODE;
    const child = spawn(
      nodeExecutable,
      [
        join(runtimeDirectory, "backend/dist/desktop.js"),
        JSON.stringify({
          ...paths,
          frontendDirectory: join(runtimeDirectory, "frontend/dist"),
        }),
      ],
      {
        env: environment,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
      },
    );
    child.stdout?.on("data", (chunk: Buffer) => process.stdout.write(chunk));
    child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    backend = connectBackend(child, (error) => {
      backendFailed = true;
      report(error);
      dialog.showErrorBox(
        "Inventory Manager",
        desktopMessages(language()).backendFailed,
      );
      window?.destroy();
      void stop();
    });
    const origin = await backend.origin;
    if (shutdown) return;
    window = new BrowserWindow({
      width: 1200,
      height: 800,
      title: "Inventory Manager",
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    // Block new windows and keep navigation on the local backend.
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault();
    });
    window.webContents.on("will-redirect", (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault();
    });
    window.once("closed", () => {
      window = undefined;
    });
    await window.loadURL(origin);
    starting = false;
    if (options.show !== false) window.show();
    return { window, backend, origin, paths, stopped };
  } catch (error) {
    if (shutdown) {
      await shutdown;
      return;
    }
    // The entry point reports startup failure; cleanup must not open a second dialog.
    startupFailed = true;
    report(error);
    window?.destroy();
    await backend?.stop().catch(report);
    throw error;
  }
}
