/** Test the inventory field creation form. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ApiError } from "../../src/services/api";
import { createInventoryField } from "../../src/services/inventoryFields";
import { InventoryFieldCreateForm } from "../../src/components/InventoryFieldCreateForm";

vi.mock("../../src/services/inventoryFields", () => ({
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
  // Test that the form submits a trimmed field name
  test("submits a trimmed field name", async () => {
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
        field_type: "text",
        max_length: 255,
      });
    });
  });

  // Test that the form clears the field name after a successful submission
  test("clears the name after a successful submission", async () => {
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

  // Test that an API error message is displayed after a failed submission
  test("displays an API error after a failed submission", async () => {
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

  // Test that select options are submitted correctly
  test("submits select options", async () => {
    const user = userEvent.setup();
    mockedCreateInventoryField.mockResolvedValue({
      id: "field-1",
      inventory_id: "inventory-1",
      name: "Played",
      field_type: "select",
      max_length: null,
      options: [],
      position: 0,
      created_at: "2026-09-17T10:00:00Z",
      updated_at: "2026-09-17T10:00:00Z",
    });
    renderInventoryFieldCreateForm();
    await user.type(screen.getByLabelText("Field name"), "Played");
    await user.selectOptions(screen.getByLabelText("Field type"), "select");
    await user.type(screen.getByLabelText("Option 1"), "Not started");
    await user.click(screen.getByRole("button", { name: "Add option" }));
    await user.type(screen.getByLabelText("Option 2"), "Completed");
    await user.click(screen.getByRole("button", { name: "Add field" }));
    await waitFor(() => {
      expect(mockedCreateInventoryField).toHaveBeenCalledWith("inventory-1", {
        name: "Played",
        field_type: "select",
        options: [{ name: "Not started" }, { name: "Completed" }],
      });
    });
  });
});
