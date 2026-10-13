/** Test the inventory field management card. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "../../src/services/api";
import {
  deleteInventoryField,
  updateInventoryField,
} from "../../src/services/inventoryFields";
import type { InventoryField } from "../../src/types/inventoryField";
import { InventoryFieldCard } from "../../src/components/InventoryFieldCard";

vi.mock("../../src/services/inventoryFields", () => ({
  createInventoryField: vi.fn(),
  deleteInventoryField: vi.fn(),
  getInventoryFields: vi.fn(),
  updateInventoryField: vi.fn(),
}));

const mockedDeleteInventoryField = vi.mocked(deleteInventoryField);
const mockedUpdateInventoryField = vi.mocked(updateInventoryField);

const inventoryField: InventoryField = {
  id: "field-1",
  inventory_id: "inventory-1",
  name: "Brand",
  field_type: "text",
  max_length: 255,
  options: [],
  position: 0,
  created_at: "2026-09-15T10:00:00Z",
  updated_at: "2026-09-15T10:00:00Z",
};

/** Render an inventory field card with an isolated query client. */
function renderInventoryFieldCard() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <InventoryFieldCard
        inventoryField={inventoryField}
        inventoryId="inventory-1"
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("InventoryFieldCard", () => {
  // Test that a field name can be updated successfully
  test("submits a changed field name", async () => {
    const user = userEvent.setup();
    mockedUpdateInventoryField.mockResolvedValue({
      ...inventoryField,
      name: "Manufacturer",
    });

    renderInventoryFieldCard();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Field name"));
    await user.type(screen.getByLabelText("Field name"), "Manufacturer");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockedUpdateInventoryField).toHaveBeenCalledWith(
        "inventory-1",
        "field-1",
        {
          name: "Manufacturer",
        },
      );
    });
  });

  // Test that editing can be canceled without submitting changes
  test("cancels editing without submitting a change", async () => {
    const user = userEvent.setup();

    renderInventoryFieldCard();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedUpdateInventoryField).not.toHaveBeenCalled();
  });

  // Test that a field is deleted after the user confirms the action
  test("deletes a field after confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockedDeleteInventoryField.mockResolvedValue();

    renderInventoryFieldCard();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(window.confirm).toHaveBeenCalledWith('Delete "Brand"?');

    await waitFor(() => {
      expect(mockedDeleteInventoryField).toHaveBeenCalledWith(
        "inventory-1",
        "field-1",
      );
    });
  });

  // Test that a field is not deleted when the user rejects the confirmation
  test("does not delete a field when confirmation is rejected", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    renderInventoryFieldCard();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(mockedDeleteInventoryField).not.toHaveBeenCalled();
  });

  // Test that a mutation error is displayed when the update fails
  test("displays a mutation error", async () => {
    const user = userEvent.setup();
    mockedUpdateInventoryField.mockRejectedValue(
      new ApiError(500, "Unable to reach the backend."),
    );

    renderInventoryFieldCard();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the backend.",
    );
  });
});
