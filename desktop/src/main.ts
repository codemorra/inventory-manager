import { app, dialog } from "electron";
import { startDesktop } from "./application.js";
import { desktopMessages } from "./messages.js";

// Let Electron finish evaluating the ESM entry before waiting for app readiness.
void startDesktop().catch(async (error: unknown) => {
  console.error("Desktop startup failed:", error);
  await app.whenReady();
  const text = desktopMessages(app.getLocale());
  dialog.showErrorBox(text.startupTitle, text.startupFailed);
  app.quit();
});
