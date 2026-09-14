import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../services/api";
import { createInventory } from "../services/inventories";
import { InventoryCreateForm } from "./InventoryCreateForm";

vi.mock("../services/inventories", () => ({
  createInventory: vi.fn(),
  getInventories: vi.fn(),
}));

const mockedCreateInventory = vi.mocked(createInventory);

function renderInventoryCreateForm() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <InventoryCreateForm />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InventoryCreateForm", () => {
  it("submits the entered inventory data", async () => {
    const user = userEvent.setup();
    mockedCreateInventory.mockResolvedValue({
      id: "inventory-1",
      name: "Cables",
      description: "Cable collection",
      created_at: "2026-09-14T10:00:00Z",
      updated_at: "2026-09-14T10:00:00Z",
    });

    renderInventoryCreateForm();

    await user.type(screen.getByLabelText("Name"), "Cables");
    await user.type(
      screen.getByLabelText("Description"),
      "  Cable collection  ",
    );
    await user.click(screen.getByRole("button", { name: "Create inventory" }));

    await waitFor(() => {
      expect(mockedCreateInventory).toHaveBeenCalledWith({
        name: "Cables",
        description: "Cable collection",
      });
    });
  });

  it("clears fields after a successful submission", async () => {
    const user = userEvent.setup();
    mockedCreateInventory.mockResolvedValue({
      id: "inventory-1",
      name: "Cables",
      description: null,
      created_at: "2026-09-14T10:00:00Z",
      updated_at: "2026-09-14T10:00:00Z",
    });

    renderInventoryCreateForm();

    const nameInput = screen.getByLabelText("Name");
    const descriptionInput = screen.getByLabelText("Description");

    await user.type(nameInput, "Cables");
    await user.type(descriptionInput, "Cable collection");
    await user.click(screen.getByRole("button", { name: "Create inventory" }));

    await waitFor(() => {
      expect(nameInput).toHaveValue("");
      expect(descriptionInput).toHaveValue("");
    });
  });

  it("displays an API error message after a failed submission", async () => {
    const user = userEvent.setup();
    mockedCreateInventory.mockRejectedValue(
      new ApiError(500, "Unable to reach the backend."),
    );

    renderInventoryCreateForm();

    await user.type(screen.getByLabelText("Name"), "Cables");
    await user.click(screen.getByRole("button", { name: "Create inventory" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the backend.",
    );
  });

  it("disables submission while the request is pending", async () => {
    const user = userEvent.setup();
    mockedCreateInventory.mockImplementation(
      () => new Promise<never>(() => {}),
    );

    renderInventoryCreateForm();

    await user.type(screen.getByLabelText("Name"), "Cables");
    await user.click(screen.getByRole("button", { name: "Create inventory" }));

    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  });
});
