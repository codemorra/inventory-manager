import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../services/api";
import {
  deleteInventoryItem,
  updateInventoryItem,
} from "../services/inventoryItems";
import type { InventoryField } from "../types/inventoryField";
import type { InventoryItem } from "../types/inventoryItem";
import { InventoryItemList } from "./InventoryItemList";

vi.mock("../services/inventoryItems", () => ({
  createInventoryItem: vi.fn(),
  deleteInventoryItem: vi.fn(),
  getInventoryItems: vi.fn(),
  updateInventoryItem: vi.fn(),
}));

const mockedDeleteInventoryItem = vi.mocked(deleteInventoryItem);
const mockedUpdateInventoryItem = vi.mocked(updateInventoryItem);
const timestamp = "2026-09-24T10:00:00Z";

const fields: InventoryField[] = [
  {
    id: "title-field",
    inventory_id: "inventory-1",
    name: "Title",
    field_type: "text",
    max_length: 120,
    options: [],
    position: 0,
    created_at: timestamp,
    updated_at: timestamp,
  },
  {
    id: "genre-field",
    inventory_id: "inventory-1",
    name: "Genre",
    field_type: "multiselect",
    max_length: null,
    options: [
      {
        id: "genre-rpg",
        field_id: "genre-field",
        name: "RPG",
        position: 0,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    position: 1,
    created_at: timestamp,
    updated_at: timestamp,
  },
  {
    id: "played-field",
    inventory_id: "inventory-1",
    name: "Played",
    field_type: "boolean",
    max_length: null,
    options: [],
    position: 2,
    created_at: timestamp,
    updated_at: timestamp,
  },
];

const items: InventoryItem[] = [
  {
    id: "item-1",
    inventory_id: "inventory-1",
    values: [
      {
        id: "value-1",
        field_id: "title-field",
        value: "Baldur's Gate 3",
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: "value-2",
        field_id: "genre-field",
        value: ["genre-rpg"],
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: "value-3",
        field_id: "played-field",
        value: true,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    created_at: timestamp,
    updated_at: timestamp,
  },
];

/** Render the item table with an isolated query client. */
function renderInventoryItemList(testItems = items) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <InventoryItemList fields={fields} items={testItems} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("InventoryItemList", () => {
  it("renders fields as columns and items as rows", () => {
    renderInventoryItemList();

    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual(["Title", "Genre", "Played", "Actions"]);

    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("Baldur's Gate 3")).toBeInTheDocument();
    expect(within(row).getByText("RPG")).toBeInTheDocument();
    expect(within(row).getByText("Yes")).toBeInTheDocument();
  });

  it("renders an em dash for a missing field value", () => {
    renderInventoryItemList([{ ...items[0], values: [] }]);

    expect(screen.getAllByText("—")).toHaveLength(3);
  });

  it("replaces all values when saving an edited item", async () => {
    const user = userEvent.setup();
    mockedUpdateInventoryItem.mockResolvedValue(items[0]);
    renderInventoryItemList();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const titleInput = screen.getByLabelText("Title");
    await user.clear(titleInput);
    await user.type(titleInput, "Divinity: Original Sin 2");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(mockedUpdateInventoryItem).toHaveBeenCalledWith(
        "inventory-1",
        "item-1",
        {
          values: [
            { field_id: "title-field", value: "Divinity: Original Sin 2" },
            { field_id: "genre-field", value: ["genre-rpg"] },
            { field_id: "played-field", value: true },
          ],
        },
      );
    });
  });

  it("cancels editing without submitting changes", async () => {
    const user = userEvent.setup();
    renderInventoryItemList();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mockedUpdateInventoryItem).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Save changes" }),
    ).not.toBeInTheDocument();
  });

  it("deletes an item after confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mockedDeleteInventoryItem.mockResolvedValue();
    renderInventoryItemList();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(window.confirm).toHaveBeenCalledWith("Delete this inventory item?");
    await waitFor(() => {
      expect(mockedDeleteInventoryItem).toHaveBeenCalledWith(
        "inventory-1",
        "item-1",
      );
    });
  });

  it("keeps an item when deletion is not confirmed", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderInventoryItemList();

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(mockedDeleteInventoryItem).not.toHaveBeenCalled();
  });

  it("displays an API error after a failed update", async () => {
    const user = userEvent.setup();
    mockedUpdateInventoryItem.mockRejectedValue(
      new ApiError(422, "Inventory item values are invalid."),
    );
    renderInventoryItemList();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Inventory item values are invalid.",
    );
  });
});
