import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { saveInventoryConfiguration } from "../../src/services/inventoryEditor";
vi.mock("../../src/services/inventoryEditor", () => ({
  saveInventoryConfiguration: vi.fn(),
  getInventoryConfiguration: vi.fn(async () => ({ inventory, fields: [] })),
}));
vi.mock("../../src/services/inventoryFields", () => ({
  getInventoryFields: vi.fn().mockResolvedValue([]),
}));

import { ApiError } from "../../src/services/api";
import { deleteInventory } from "../../src/services/inventories";
import { InventoryTable } from "../../src/components/InventoryTable";

vi.mock("../../src/services/inventories", () => ({
  createInventory: vi.fn(),
  deleteInventory: vi.fn(),
  getInventories: vi.fn(),
  updateInventory: vi.fn(),
}));

const mockedDeleteInventory = vi.mocked(deleteInventory);
const mockedUpdateInventory = vi.mocked(saveInventoryConfiguration);

const inventory = {
  configuration_revision: 1,
  id: "inventory-1",
  name: "Cables",
  description: "Cable collection",
  created_at: "2026-09-14T10:00:00Z",
  updated_at: "2026-09-14T10:00:00Z",
};

/** Render an inventory table with an isolated query client. */
function renderInventoryTable() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Routes>
          <Route
            path="/"
            element={<InventoryTable inventories={[inventory]} />}
          />
          <Route
            path="/inventories/:id/items"
            element={<p>Inventory opened</p>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("InventoryTable", () => {
  test.each(["description", "row"])(
    "opens an inventory by clicking its %s",
    async (target) => {
      const user = userEvent.setup();
      renderInventoryTable();
      const description = screen.getByText("Cable collection");

      await user.click(
        target === "row" ? description.closest("tr")! : description,
      );

      expect(screen.getByText("Inventory opened")).toBeInTheDocument();
    },
  );

  test("keeps keyboard navigation through the title link without a separate items action", async () => {
    const user = userEvent.setup();
    renderInventoryTable();
    expect(
      screen.queryByRole("link", { name: "Items" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Items" }),
    ).not.toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole("link", { name: "Cables" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.getByText("Inventory opened")).toBeInTheDocument();
  });

  // Test that inventory actions use the same enabled-only hover treatment as item actions.
  test("uses a distinct hover surface for inventory editing", () => {
    renderInventoryTable();
    expect(screen.getByRole("button", { name: "Edit" })).toHaveClass(
      "enabled:hover:bg-control-hover",
      "enabled:hover:border-accent/50",
    );
  });
  // Test that inventory values can be updated successfully
  test("submits changed inventory values", async () => {
    const user = userEvent.setup();
    mockedUpdateInventory.mockResolvedValue({
      inventory: {
        ...inventory,
        name: "Tools",
        description: "Updated description",
      },
      fields: [],
    });

    renderInventoryTable();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      screen.getByRole("dialog", { name: "Edit inventory" }),
    ).toBeInTheDocument();
    await user.clear(await screen.findByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Tools");
    await user.clear(screen.getByLabelText("Description"));
    await user.type(
      screen.getByLabelText("Description"),
      "Updated description",
    );
    await user.click(
      await screen.findByRole("button", { name: "Save changes" }),
    );

    await waitFor(() => {
      expect(mockedUpdateInventory).toHaveBeenCalledWith("inventory-1", {
        expected_revision: 1,
        inventory: { name: "Tools", description: "Updated description" },
        fields: [],
        options: [],
      });
    });
  });

  // Test that editing can be canceled without submitting changes
  test("cancels editing without submitting changes", async () => {
    const user = userEvent.setup();

    renderInventoryTable();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      screen.getByRole("dialog", { name: "Edit inventory" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedUpdateInventory).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
  });

  // Test that an inventory is deleted after the user confirms the action
  test("deletes an inventory after confirmation", async () => {
    const user = userEvent.setup();
    mockedDeleteInventory.mockResolvedValue();

    renderInventoryTable();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const confirmation = screen.getByRole("dialog", {
      name: "Delete inventory",
    });
    expect(mockedDeleteInventory).not.toHaveBeenCalled();
    await user.click(
      within(confirmation).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() => {
      expect(mockedDeleteInventory).toHaveBeenCalledWith("inventory-1");
    });
  });

  // Test that an inventory is not deleted when the user cancels the confirmation
  test("does not delete an inventory when confirmation is rejected", async () => {
    const user = userEvent.setup();

    renderInventoryTable();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const confirmation = screen.getByRole("dialog", {
      name: "Delete inventory",
    });
    expect(mockedDeleteInventory).not.toHaveBeenCalled();
    await user.click(
      within(confirmation).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    expect(mockedDeleteInventory).not.toHaveBeenCalled();
  });

  // Test that an API error message is displayed after a failed inventory update
  test("displays an update error", async () => {
    const user = userEvent.setup();
    mockedUpdateInventory.mockRejectedValue(
      new ApiError(500, "Unable to reach the backend."),
    );

    renderInventoryTable();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      screen.getByRole("dialog", { name: "Edit inventory" }),
    ).toBeInTheDocument();
    await user.click(
      await screen.findByRole("button", { name: "Save changes" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the backend.",
    );
  });
});

// Test that a failed deletion remains in the confirmation and can be retried.
test("keeps deletion failures in the dialog and closes after retry", async () => {
  const user = userEvent.setup();
  mockedDeleteInventory
    .mockRejectedValueOnce(new Error("Synthetic failure"))
    .mockResolvedValueOnce();
  renderInventoryTable();
  await user.click(screen.getByRole("button", { name: "Delete" }));
  const confirmation = screen.getByRole("dialog", { name: "Delete inventory" });
  await user.click(
    within(confirmation).getByRole("button", { name: "Delete" }),
  );
  expect(await within(confirmation).findByRole("alert")).toBeInTheDocument();
  expect(
    screen.getByRole("dialog", { name: "Delete inventory" }),
  ).toBeInTheDocument();
  await user.click(
    within(confirmation).getByRole("button", { name: "Delete" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
