import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SettingsDialog } from "../../src/components/SettingsDialog";
import { UpdateSettings } from "../../src/components/UpdateSettings";
import { APP_VERSION } from "../../src/generated/app-version";
import * as api from "../../src/services/applicationUpdates";
import type { ApplicationUpdate } from "../../src/types/applicationUpdate";
import i18n from "../../src/i18n";
import { deferred } from "../helpers/inventoryArchives";

vi.mock("../../src/services/applicationUpdates", () => ({
  checkForUpdates: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const available: ApplicationUpdate = {
  current_version: APP_VERSION,
  status: "available",
  latest_version: "1.10.0",
  release_url:
    "https://github.com/codemorra/inventory-manager/releases/tag/v1.10.0",
};

test("Settings shows its build version without checking on open, even under StrictMode", () => {
  render(
    <StrictMode>
      <SettingsDialog onClose={() => {}} />
    </StrictMode>,
  );
  expect(screen.getByText(`Version ${APP_VERSION}`)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Check for updates" }),
  ).toBeEnabled();
  expect(api.checkForUpdates).not.toHaveBeenCalled();
});

test("checks manually, prevents duplicate requests and links to the release and update instructions", async () => {
  const pending = deferred<ApplicationUpdate>();
  vi.mocked(api.checkForUpdates).mockReturnValue(pending.promise);
  const user = userEvent.setup();
  render(<UpdateSettings />);
  const button = screen.getByRole("button", { name: "Check for updates" });
  await user.click(button);
  expect(button).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("Checking for updates");
  await user.click(button);
  expect(api.checkForUpdates).toHaveBeenCalledOnce();
  await act(async () => pending.resolve(available));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Version 1.10.0 is available.",
  );
  expect(button).toBeEnabled();
  expect(screen.getByRole("link", { name: "Open release" })).toHaveAttribute(
    "href",
    available.release_url,
  );
  expect(screen.getByRole("link", { name: "Open release" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  expect(
    screen.getByRole("link", { name: "Update instructions" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/codemorra/inventory-manager#updates",
  );
});

for (const [status, text] of [
  ["current", "No newer published version is available."],
  ["no_release", "No public release is available yet."],
  ["rate_limited", "GitHub’s request limit has been reached."],
  ["failed", "Unable to check for updates."],
] as const) {
  test(`shows ${status} and supports another explicit check`, async () => {
    vi.mocked(api.checkForUpdates)
      .mockResolvedValueOnce(
        status === "current"
          ? { ...available, status }
          : { current_version: APP_VERSION, status },
      )
      .mockResolvedValueOnce(available);
    const user = userEvent.setup();
    render(<UpdateSettings />);
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(text),
    );
    expect(
      screen.queryByRole("link", { name: "Open release" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Check for updates" }));
    expect(
      await screen.findByRole("link", { name: "Open release" }),
    ).toBeInTheDocument();
  });
}

test("handles a local backend failure and replaces an older available result", async () => {
  vi.mocked(api.checkForUpdates)
    .mockResolvedValueOnce(available)
    .mockRejectedValueOnce(new TypeError("Offline"));
  const user = userEvent.setup();
  render(<UpdateSettings />);
  await user.click(screen.getByRole("button", { name: "Check for updates" }));
  expect(
    await screen.findByRole("link", { name: "Open release" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Check for updates" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Unable to check for updates.",
    ),
  );
  expect(
    screen.queryByRole("link", { name: "Open release" }),
  ).not.toBeInTheDocument();
});

test("cancels a dismissed check and reopens Settings without old state or an automatic request", async () => {
  const pending = deferred<ApplicationUpdate>();
  vi.mocked(api.checkForUpdates).mockReturnValue(pending.promise);
  const user = userEvent.setup();
  const view = render(<UpdateSettings />);
  await user.click(screen.getByRole("button", { name: "Check for updates" }));
  const signal = vi.mocked(api.checkForUpdates).mock.calls[0]![0];
  expect(signal.aborted).toBe(false);
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(available));
  render(<UpdateSettings />);
  expect(
    screen.getByRole("button", { name: "Check for updates" }),
  ).toBeEnabled();
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  expect(api.checkForUpdates).toHaveBeenCalledOnce();
});

test("renders the check and result in German", async () => {
  await i18n.changeLanguage("de");
  vi.mocked(api.checkForUpdates).mockResolvedValue(available);
  const user = userEvent.setup();
  render(<UpdateSettings />);
  await user.click(screen.getByRole("button", { name: "Nach Updates suchen" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      "Version 1.10.0 ist verfügbar.",
    ),
  );
  expect(screen.getByRole("link", { name: "Release öffnen" })).toHaveAttribute(
    "href",
    available.release_url,
  );
});
