import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { InventoryField } from "../types/inventoryField";
import type { InventoryItem } from "../types/inventoryItem";
import { InventoryItemList } from "./InventoryItemList";

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

afterEach(cleanup);

describe("InventoryItemList", () => {
  it("renders fields as columns and items as rows", () => {
    render(<InventoryItemList fields={fields} items={items} />);

    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual(["Title", "Genre", "Played"]);

    const row = screen.getAllByRole("row")[1];
    expect(within(row).getByText("Baldur's Gate 3")).toBeInTheDocument();
    expect(within(row).getByText("RPG")).toBeInTheDocument();
    expect(within(row).getByText("Yes")).toBeInTheDocument();
  });

  it("renders an em dash for a missing field value", () => {
    render(
      <InventoryItemList
        fields={fields}
        items={[{ ...items[0], values: [] }]}
      />,
    );

    expect(screen.getAllByText("—")).toHaveLength(3);
  });
});
