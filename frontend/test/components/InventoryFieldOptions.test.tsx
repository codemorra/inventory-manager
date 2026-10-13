import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createInventoryFieldOption,
  deleteInventoryFieldOption,
  updateInventoryFieldOption,
} from "../../src/services/inventoryFields";
import { InventoryFieldOptions } from "../../src/components/InventoryFieldOptions";

vi.mock("../../src/services/inventoryFields", () => ({
  createInventoryFieldOption: vi.fn(),
  deleteInventoryFieldOption: vi.fn(),
  getInventoryFields: vi.fn(),
  updateInventoryFieldOption: vi.fn(),
}));

const option = {
  id: "option-1",
  field_id: "field-1",
  name: "RPG",
  position: 0,
  created_at: "2026-09-17T10:00:00Z",
  updated_at: "2026-09-17T10:00:00Z",
};

function renderOptions() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <InventoryFieldOptions
        fieldId="field-1"
        inventoryId="inventory-1"
        options={[option]}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("InventoryFieldOptions", () => {
  // Test that a new option can be created successfully
  test("creates an option", async () => {
    const user = userEvent.setup();
    vi.mocked(createInventoryFieldOption).mockResolvedValue(option);
    renderOptions();
    await user.type(screen.getByLabelText("New option name"), "Strategy");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(createInventoryFieldOption).toHaveBeenCalledWith(
        "inventory-1",
        "field-1",
        { name: "Strategy" },
      ),
    );
  });

  // Test that an existing option can be updated and deleted successfully
  test("updates and deletes options", async () => {
    const user = userEvent.setup();
    vi.mocked(updateInventoryFieldOption).mockResolvedValue({
      ...option,
      name: "Role-playing game",
    });
    vi.mocked(deleteInventoryFieldOption).mockResolvedValue();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderOptions();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Option name"));
    await user.type(screen.getByLabelText("Option name"), "Role-playing game");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateInventoryFieldOption).toHaveBeenCalledWith(
        "inventory-1",
        "field-1",
        "option-1",
        { name: "Role-playing game" },
      ),
    );
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(deleteInventoryFieldOption).toHaveBeenCalledWith(
        "inventory-1",
        "field-1",
        "option-1",
      ),
    );
  });
});
