import { app, BrowserWindow, dialog, shell } from "electron";
import { basename, join } from "node:path";
import { desktopMessages } from "./messages.js";

/**
 * Keep application navigation local and hand explicit external links to the browser.
 * @param window The sole application window.
 * @param origin The backend's actual loopback origin.
 * @param language Read the currently saved language or system locale.
 * @param report Record errors without exposing Node.js to the page.
 */
export function configureWindow(
  window: BrowserWindow,
  origin: string,
  language: () => string,
  report: (error: unknown) => void,
) {
  window.removeMenu();

  /**
   * Open ordinary web links outside the application.
   * @param url The requested navigation target.
   */
  function external(url: string) {
    if (!/^https?:\/\//i.test(url)) return;
    void shell.openExternal(url).catch((error: unknown) => {
      report(error);
      if (!window.isDestroyed())
        void dialog.showMessageBox(window, {
          type: "error",
          message: desktopMessages(language()).linkFailed,
        });
    });
  }
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin === origin) {
      if (new URL(url).pathname.endsWith("/download"))
        window.webContents.downloadURL(url);
      else void window.loadURL(url).catch(report);
    } else external(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== origin) {
      event.preventDefault();
      external(url);
    }
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("will-prevent-unload", (event) => {
    const text = desktopMessages(language());
    const choice = dialog.showMessageBoxSync(window, {
      type: "question",
      title: text.leaveTitle,
      message: text.leaveMessage,
      buttons: [text.stay, text.leave],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (choice === 1) event.preventDefault();
  });
  const session = window.webContents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.setPermissionCheckHandler(() => false);
  session.on("will-download", (event, item, contents) => {
    if (
      contents !== window.webContents ||
      item.getURLChain().some((url) => new URL(url).origin !== origin)
    ) {
      event.preventDefault();
      return;
    }
    item.setSaveDialogOptions({
      defaultPath: join(app.getPath("downloads"), basename(item.getFilename())),
    });
    item.once("done", (_event, state) => {
      if (state === "interrupted" && !window.isDestroyed())
        void dialog.showMessageBox(window, {
          type: "error",
          message: desktopMessages(language()).downloadFailed,
        });
    });
  });
}
