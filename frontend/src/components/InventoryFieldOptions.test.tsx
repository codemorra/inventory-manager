import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createInventoryFieldOption,
  deleteInventoryFieldOption,
  updateInventoryFieldOption,
} from "../services/inventoryFields";
import { InventoryFieldOptions } from "./InventoryFieldOptions";

vi.mock("../services/inventoryFields", () => ({
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
  it("creates an option", async () => {
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

  it("updates and deletes options", async () => {
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
