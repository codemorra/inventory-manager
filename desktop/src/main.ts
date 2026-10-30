import { app, BrowserWindow } from "electron";
import { APP_VERSION } from "./generated/app-version.js";

app.setName("Inventory Manager");
app.on("window-all-closed", () => app.quit());
process.once("SIGINT", () => app.quit());
process.once("SIGTERM", () => app.quit());

// Finish evaluating the ESM entry before waiting for Electron readiness.
void app
  .whenReady()
  .then(async () => {
    app.setAboutPanelOptions({
      applicationName: "Inventory Manager",
      applicationVersion: APP_VERSION,
    });
    const window = new BrowserWindow({
      title: "Inventory Manager",
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    await window.loadURL("about:blank");
  })
  .catch((error: unknown) => {
    console.error("Desktop startup failed:", error);
    app.exit(1);
  });
