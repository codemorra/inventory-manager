/** Test the inventory field creation form. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../services/api";
import { createInventoryField } from "../services/inventoryFields";
import { InventoryFieldCreateForm } from "./InventoryFieldCreateForm";

vi.mock("../services/inventoryFields", () => ({
  createInventoryField: vi.fn(),
  deleteInventoryField: vi.fn(),
  getInventoryFields: vi.fn(),
  updateInventoryField: vi.fn(),
}));

const mockedCreateInventoryField = vi.mocked(createInventoryField);

/** Render the inventory field creation form with an isolated query client. */
function renderInventoryFieldCreateForm() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <InventoryFieldCreateForm inventoryId="inventory-1" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InventoryFieldCreateForm", () => {
  it("submits a trimmed field name", async () => {
    const user = userEvent.setup();
    mockedCreateInventoryField.mockResolvedValue({
      id: "field-1",
      inventory_id: "inventory-1",
      name: "Brand",
      field_type: "text",
      max_length: 255,
      options: [],
      position: 0,
      created_at: "2026-09-15T10:00:00Z",
      updated_at: "2026-09-15T10:00:00Z",
    });

    renderInventoryFieldCreateForm();

    await user.type(screen.getByLabelText("Field name"), "  Brand  ");
    await user.click(screen.getByRole("button", { name: "Add field" }));

    await waitFor(() => {
      expect(mockedCreateInventoryField).toHaveBeenCalledWith("inventory-1", {
        name: "Brand",
      });
    });
  });

  it("clears the name after a successful submission", async () => {
    const user = userEvent.setup();
    mockedCreateInventoryField.mockResolvedValue({
      id: "field-1",
      inventory_id: "inventory-1",
      name: "Brand",
      field_type: "text",
      max_length: 255,
      options: [],
      position: 0,
      created_at: "2026-09-15T10:00:00Z",
      updated_at: "2026-09-15T10:00:00Z",
    });

    renderInventoryFieldCreateForm();

    const input = screen.getByLabelText("Field name");

    await user.type(input, "Brand");
    await user.click(screen.getByRole("button", { name: "Add field" }));

    await waitFor(() => {
      expect(input).toHaveValue("");
    });
  });

  it("displays an API error after a failed submission", async () => {
    const user = userEvent.setup();
    mockedCreateInventoryField.mockRejectedValue(
      new ApiError(500, "Unable to reach the backend."),
    );

    renderInventoryFieldCreateForm();

    await user.type(screen.getByLabelText("Field name"), "Brand");
    await user.click(screen.getByRole("button", { name: "Add field" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the backend.",
    );
  });
});
