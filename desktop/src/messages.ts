const messages = {
  en: {
    startupTitle: "Inventory Manager could not start",
    startupFailed:
      "The application could not start. Check the application log and try again.",
    backendFailed:
      "The local server stopped unexpectedly. Close the application and try again.",
    shutdownFailed:
      "The application could not shut down cleanly. Check the application log before restarting.",
    leaveTitle: "Leave the application?",
    leaveMessage: "Unsaved changes may be lost. Leave anyway?",
    stay: "Stay",
    leave: "Leave",
    downloadFailed: "The file could not be downloaded. Please try again.",
    linkFailed: "The link could not be opened.",
  },
  de: {
    startupTitle: "Inventory Manager konnte nicht starten",
    startupFailed:
      "Die Anwendung konnte nicht starten. Prüfe das Anwendungsprotokoll und versuche es erneut.",
    backendFailed:
      "Der lokale Server wurde unerwartet beendet. Schließe die Anwendung und versuche es erneut.",
    shutdownFailed:
      "Die Anwendung konnte nicht sauber beendet werden. Prüfe vor dem nächsten Start das Anwendungsprotokoll.",
    leaveTitle: "Anwendung verlassen?",
    leaveMessage:
      "Ungespeicherte Änderungen können verloren gehen. Trotzdem verlassen?",
    stay: "Bleiben",
    leave: "Verlassen",
    downloadFailed:
      "Die Datei konnte nicht heruntergeladen werden. Versuche es erneut.",
    linkFailed: "Der Link konnte nicht geöffnet werden.",
  },
};

/**
 * Select native dialog text using the effective application language.
 * @param language Saved preference or operating-system locale.
 * @returns German or English desktop text.
 */
export function desktopMessages(language: string) {
  return language.toLowerCase().startsWith("de") ? messages.de : messages.en;
}
