import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

import { ApiError } from "../../src/services/api";
import { createInventory } from "../../src/services/inventories";
import { InventoryCreateForm } from "../../src/components/InventoryCreateForm";

vi.mock("../../src/services/inventories", () => ({
  createInventory: vi.fn(),
  getInventories: vi.fn(),
}));

const mockedCreateInventory = vi.mocked(createInventory);

// Expose the destination URL without replacing the form under test.
function Location() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname + location.search}</p>;
}

/** Render the creation form with an isolated query client. */
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
      <MemoryRouter initialEntries={["/inventories/existing/items"]}>
        <InventoryCreateForm />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InventoryCreateForm", () => {
  // Test suite for the InventoryCreateForm component
  test("submits the entered inventory data", async () => {
    const user = userEvent.setup();
    mockedCreateInventory.mockResolvedValue({
      id: "inventory-1",
      name: "Cables",
      description: "Cable collection",
      created_at: "2026-09-14T10:00:00Z",
      updated_at: "2026-09-14T10:00:00Z",
    });

    renderInventoryCreateForm();

    await user.click(screen.getByRole("button", { name: "New inventory" }));

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
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/inventories/inventory-1/items",
      ),
    );
  });

  // Test that the form clears its fields after a successful submission
  test("clears fields after a successful submission", async () => {
    const user = userEvent.setup();
    mockedCreateInventory.mockResolvedValue({
      id: "inventory-1",
      name: "Cables",
      description: null,
      created_at: "2026-09-14T10:00:00Z",
      updated_at: "2026-09-14T10:00:00Z",
    });

    renderInventoryCreateForm();

    await user.click(screen.getByRole("button", { name: "New inventory" }));

    const nameInput = screen.getByLabelText("Name");
    const descriptionInput = screen.getByLabelText("Description");

    await user.type(nameInput, "Cables");
    await user.type(descriptionInput, "Cable collection");
    await user.click(screen.getByRole("button", { name: "Create inventory" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "New inventory" }));

    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByLabelText("Description")).toHaveValue("");
  });

  // Test that an API error message is displayed after a failed submission
  test("displays an API error message after a failed submission", async () => {
    const user = userEvent.setup();
    mockedCreateInventory.mockRejectedValue(
      new ApiError(500, "Unable to reach the backend."),
    );

    renderInventoryCreateForm();

    await user.click(screen.getByRole("button", { name: "New inventory" }));

    await user.type(screen.getByLabelText("Name"), "Cables");
    await user.click(screen.getByRole("button", { name: "Create inventory" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to reach the backend.",
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/inventories/existing/items",
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Cables");
  });

  // Test that the submission button is disabled while the request is pending
  test("disables submission while the request is pending", async () => {
    const user = userEvent.setup();
    mockedCreateInventory.mockImplementation(
      () => new Promise<never>(() => {}),
    );

    renderInventoryCreateForm();

    await user.click(screen.getByRole("button", { name: "New inventory" }));

    await user.type(screen.getByLabelText("Name"), "Cables");
    await user.click(screen.getByRole("button", { name: "Create inventory" }));

    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/inventories/existing/items",
    );
  });
});
