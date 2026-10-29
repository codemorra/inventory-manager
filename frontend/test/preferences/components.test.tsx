import { StrictMode, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { PreferenceBootstrap } from "../../src/components/PreferenceBootstrap";
import { PreferenceStatus } from "../../src/components/PreferenceStatus";
import { SettingsPage } from "../../src/pages/SettingsPage";
import { preferenceStore } from "../../src/preferences/store";
import * as api from "../../src/services/preferences";
import { ApiError } from "../../src/services/api";
import { useInventoryView } from "../../src/hooks/useInventoryView";
import type {
  ApplicationSettings,
  InventoryViewState,
} from "../../src/types/preferences";
import type { InventoryField } from "../../src/types/inventoryField";
import { deferred } from "../helpers/inventoryArchives";

vi.mock("../../src/services/preferences", () => ({
  getApplicationSettings: vi.fn(),
  updateApplicationSettings: vi.fn(),
  getInventoryViews: vi.fn(),
  getInventoryView: vi.fn(),
  updateInventoryView: vi.fn(),
}));
const initial: ApplicationSettings = {
  version: 1,
  revision: 0,
  preferences: {
    language: "system",
    theme: "system",
    accent: "brand",
    attachmentWarnings: "show",
  },
};
beforeEach(() => {
  preferenceStore.dispose();
  vi.mocked(api.getApplicationSettings).mockResolvedValue(
    structuredClone(initial),
  );
  vi.mocked(api.getInventoryViews).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  preferenceStore.dispose();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function renderPreferences(node: ReactNode) {
  void preferenceStore.initialize(api).catch(() => {});
  return render(node);
}
function show() {
  return renderPreferences(
    <PreferenceBootstrap>
      <SettingsPage />
      <PreferenceStatus />
    </PreferenceBootstrap>,
  );
}

// Backend initialization failures keep editable controls unavailable until a successful retry.
test("gates the interface on backend loading and offers a safe startup retry", async () => {
  vi.mocked(api.getApplicationSettings)
    .mockRejectedValueOnce(new TypeError("Offline"))
    .mockResolvedValueOnce(initial);
  show();
  expect(screen.queryByLabelText("Appearance")).not.toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be loaded",
  );
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByLabelText("Appearance");
});

// StrictMode's effect remount must join one bootstrap operation, not issue duplicate reads.
test("loads once under StrictMode and applies saved theme/accent before editable controls appear", async () => {
  vi.mocked(api.getApplicationSettings).mockResolvedValue({
    ...initial,
    preferences: { ...initial.preferences, theme: "dark", accent: "purple" },
  });
  renderPreferences(
    <StrictMode>
      <PreferenceBootstrap>
        <SettingsPage />
      </PreferenceBootstrap>
    </StrictMode>,
  );
  await screen.findByLabelText("Appearance");
  expect(api.getApplicationSettings).toHaveBeenCalledOnce();
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.dataset.accent).toBe("purple");
});

// Controls share a file-backed optimistic cache, and explicit language choices persist without browser mirroring.
test("persists appearance, accent, language and warning choices through the backend", async () => {
  let saved = {
    ...initial,
    preferences: {
      ...initial.preferences,
      attachmentWarnings: "hide" as const,
    },
  } as ApplicationSettings;
  vi.mocked(api.getApplicationSettings).mockResolvedValue(saved);
  vi.mocked(api.updateApplicationSettings).mockImplementation(
    async (revision, preferences) => {
      saved = {
        ...saved,
        revision: revision + 1,
        preferences: { ...saved.preferences, ...preferences },
      };
      return saved;
    },
  );
  const user = userEvent.setup();
  show();
  await screen.findByLabelText("Appearance");
  const browserWrite = vi.spyOn(Storage.prototype, "setItem");
  await user.selectOptions(screen.getByLabelText("Appearance"), "dark");
  await user.click(screen.getByRole("button", { name: "Blue" }));
  await user.click(
    screen.getByRole("checkbox", { name: "Warn before adding large files" }),
  );
  await user.selectOptions(screen.getByLabelText("Language"), "de");
  await screen.findByLabelText("Sprache");
  await waitFor(() => expect(preferenceStore.getStatus().pending).toBe(0));
  expect(saved.preferences).toEqual({
    language: "de",
    theme: "dark",
    accent: "blue",
    attachmentWarnings: "show",
  });
  expect(browserWrite).not.toHaveBeenCalled();
  expect(document.documentElement.lang).toBe("de");
});

// Automatic language is the client's system locale, not a language selected by the backend host.
test("supports returning to system language without writing a resolved language back to the server", async () => {
  vi.spyOn(navigator, "language", "get").mockReturnValue("de-DE");
  vi.mocked(api.getApplicationSettings).mockResolvedValue({
    ...initial,
    preferences: { ...initial.preferences, language: "en" },
  });
  vi.mocked(api.updateApplicationSettings).mockResolvedValue({
    ...initial,
    revision: 1,
  });
  const user = userEvent.setup();
  show();
  await screen.findByLabelText("Language");
  await user.selectOptions(screen.getByLabelText("Language"), "system");
  await screen.findByLabelText("Sprache");
  expect(api.updateApplicationSettings).toHaveBeenCalledExactlyOnceWith(0, {
    language: "system",
  });
  expect(screen.getByLabelText("Sprache")).toHaveValue("system");
});

// Failed automatic saves remain visible and editable, but are never mislabeled as safely persisted.
test("shows unsaved changes and lets the user explicitly retry transport failures", async () => {
  vi.mocked(api.updateApplicationSettings)
    .mockRejectedValueOnce(new TypeError("Offline"))
    .mockResolvedValueOnce({
      ...initial,
      revision: 1,
      preferences: { ...initial.preferences, theme: "dark" },
    });
  const user = userEvent.setup();
  show();
  await screen.findByLabelText("Appearance");
  await user.selectOptions(screen.getByLabelText("Appearance"), "dark");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be saved",
  );
  expect(
    screen.queryByText("Some changes have not been saved."),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Appearance")).toHaveValue("dark");
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
});

// Conflicts require an explicit discard/reload action, rather than retrying with a guessed newer revision.
test("reloads authoritative preferences after an explicit conflict recovery action", async () => {
  vi.mocked(api.updateApplicationSettings).mockRejectedValue(
    new ApiError(409, "Changed", "application_settings_conflict"),
  );
  const user = userEvent.setup();
  show();
  await screen.findByLabelText("Appearance");
  await user.selectOptions(screen.getByLabelText("Appearance"), "dark");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "changed elsewhere",
  );
  expect(
    screen.queryByRole("button", { name: "Retry" }),
  ).not.toBeInTheDocument();
  vi.mocked(api.getApplicationSettings).mockResolvedValue({
    ...initial,
    revision: 2,
    preferences: { ...initial.preferences, theme: "light" },
  });
  await user.click(screen.getByRole("button", { name: "Load saved values" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Appearance")).toHaveValue("light"),
  );
  expect(api.updateApplicationSettings).toHaveBeenCalledOnce();
});

const field: InventoryField = {
  id: "column",
  name: "Column",
  inventory_id: "inventory",
  field_type: "text",
  max_length: 255,
  is_required: false,
  is_sortable: true,
  options: [],
  position: 0,
  created_at: "",
  updated_at: "",
};
function Table() {
  const { view, setColumnWidth, setAutomaticColumnWidth, setWrapText } =
    useInventoryView("inventory", [field]);
  return (
    <>
      <p data-testid="width">{view.columnWidths.column ?? "auto"}</p>
      <p data-testid="wrap">{String(view.wrapText)}</p>
      <button onClick={() => setColumnWidth("column", 180)}>Resize</button>
      <button onClick={() => setAutomaticColumnWidth("column")}>Auto</button>
      <button onClick={() => setWrapText(false)}>No wrap</button>
    </>
  );
}

// The real hook uses acknowledged database state and preserves Auto as absence of a manual base.
test("switches inventory view hooks to database persistence after bootstrap", async () => {
  const stored: InventoryViewState = {
    inventory_id: "inventory",
    revision: 3,
    preferences: {
      version: 1,
      sort: null,
      hiddenFieldIds: [],
      wrapText: false,
      attachmentPreviews: true,
      columnWidths: {},
    },
  };
  vi.mocked(api.getInventoryViews).mockResolvedValue([stored]);
  vi.mocked(api.updateInventoryView).mockImplementation(
    async (id, revision, preferences) => ({
      inventory_id: id,
      revision: revision + 1,
      preferences,
    }),
  );
  const user = userEvent.setup();
  renderPreferences(
    <PreferenceBootstrap>
      <Table />
    </PreferenceBootstrap>,
  );
  expect(await screen.findByTestId("width")).toHaveTextContent("auto");
  expect(screen.getByTestId("wrap")).toHaveTextContent("false");
  const browserWrite = vi.spyOn(Storage.prototype, "setItem");
  await user.click(screen.getByRole("button", { name: "Resize" }));
  expect(screen.getByTestId("width")).toHaveTextContent("180");
  await user.click(screen.getByRole("button", { name: "Auto" }));
  await waitFor(() => expect(preferenceStore.getStatus().pending).toBe(0));
  expect(api.updateInventoryView).toHaveBeenLastCalledWith(
    "inventory",
    4,
    expect.objectContaining({ columnWidths: {} }),
  );
  expect(browserWrite).not.toHaveBeenCalled();
});

// Rendering a pending bootstrap never enables preference changes against unknown server revisions.
test("keeps controls hidden until the final view load completes", async () => {
  const pending = deferred<InventoryViewState[]>();
  vi.mocked(api.getInventoryViews).mockReturnValue(pending.promise);
  show();
  expect(screen.queryByLabelText("Appearance")).not.toBeInTheDocument();
  await act(async () => pending.resolve([]));
  expect(await screen.findByLabelText("Appearance")).toBeInTheDocument();
});
