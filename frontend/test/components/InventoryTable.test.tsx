import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { ApiError } from "../../src/services/api";
import {
  deleteInventory,
  updateInventory,
} from "../../src/services/inventories";
import { InventoryTable } from "../../src/components/InventoryTable";

vi.mock("../../src/services/inventories", () => ({
  createInventory: vi.fn(),
  deleteInventory: vi.fn(),
  getInventories: vi.fn(),
  updateInventory: vi.fn(),
}));

const mockedDeleteInventory = vi.mocked(deleteInventory);
const mockedUpdateInventory = vi.mocked(updateInventory);

const inventory = {
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
        <InventoryTable inventories={[inventory]} />
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
      ...inventory,
      name: "Tools",
      description: "Updated description",
    });

    renderInventoryTable();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(
      screen.getByRole("dialog", { name: "Edit inventory" }),
    ).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Tools");
    await user.clear(screen.getByLabelText("Description"));
    await user.type(
      screen.getByLabelText("Description"),
      "Updated description",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockedUpdateInventory).toHaveBeenCalledWith("inventory-1", {
        name: "Tools",
        description: "Updated description",
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
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockedDeleteInventory.mockResolvedValue();

    renderInventoryTable();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(window.confirm).toHaveBeenCalledWith('Delete "Cables"?');

    await waitFor(() => {
      expect(mockedDeleteInventory).toHaveBeenCalledWith("inventory-1");
    });
  });

  // Test that an inventory is not deleted when the user cancels the confirmation
  test("does not delete an inventory when confirmation is rejected", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    renderInventoryTable();

    await user.click(screen.getByRole("button", { name: "Delete" }));

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
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the backend.",
    );
  });
});
