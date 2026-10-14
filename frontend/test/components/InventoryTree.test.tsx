import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { InventoryTree } from "../../src/components/InventoryTree";

afterEach(cleanup);
const group = { id: "group", name: "Leisure", created_at: "", updated_at: "" };
const inventory = {
  id: "games",
  name: "Games",
  group_id: "group",
  description: null,
  created_at: "",
  updated_at: "",
};

// Test that group right-clicks select the group without collapsing or navigating.
test("opens context actions for the right-clicked group", () => {
  const context = vi.fn();
  render(
    <MemoryRouter>
      <InventoryTree
        groups={[group]}
        inventories={[inventory]}
        searching={false}
        onContext={context}
      />
    </MemoryRouter>,
  );
  const button = screen.getByRole("button", { name: "Leisure" });
  fireEvent.contextMenu(button, { clientX: 20, clientY: 40 });
  expect(context).toHaveBeenCalledWith({
    kind: "group",
    entry: group,
    x: 20,
    y: 40,
    source: button,
  });
  expect(button).toHaveAttribute("aria-expanded", "true");
});

// Test native inventory drags to a group, rejecting external or mismatched payloads.
test("moves a dragged inventory to a group and rejects external data", () => {
  const move = vi.fn();
  render(
    <MemoryRouter>
      <InventoryTree
        groups={[group]}
        inventories={[{ ...inventory, group_id: null }]}
        searching={false}
        onMove={move}
      />
    </MemoryRouter>,
  );
  const source = screen.getByRole("link", { name: "Games" });
  const target = screen.getByRole("button", { name: "Leisure" });
  const values = new Map<string, string>();
  const dataTransfer = {
    types: ["application/x-inventory-manager-inventory"],
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? "",
    effectAllowed: "",
    dropEffect: "",
  };
  fireEvent.drop(target, { dataTransfer });
  expect(move).not.toHaveBeenCalled();
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
  expect(move).toHaveBeenCalledWith("games", "group");
});

// Test that inventories can be moved out of a group even when the destination is empty.
test("drops an inventory into the empty ungrouped area", () => {
  const move = vi.fn();
  render(
    <MemoryRouter>
      <InventoryTree
        groups={[group]}
        inventories={[inventory]}
        searching={false}
        onMove={move}
      />
    </MemoryRouter>,
  );
  const values = new Map<string, string>();
  const dataTransfer = {
    types: ["application/x-inventory-manager-inventory"],
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? "",
    effectAllowed: "",
    dropEffect: "",
  };
  fireEvent.dragStart(screen.getByRole("link", { name: "Games" }), {
    dataTransfer,
  });
  fireEvent.drop(screen.getByText("Without a group"), {
    dataTransfer,
  });
  expect(move).toHaveBeenCalledWith("games", null);
});

// Test that pending saves prevent a second movement request.
test("disables dragging while a move is pending", () => {
  const move = vi.fn();
  render(
    <MemoryRouter>
      <InventoryTree
        groups={[group]}
        inventories={[inventory]}
        searching={false}
        onMove={move}
        disabled
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Games" })).toHaveAttribute(
    "draggable",
    "false",
  );
});

// Test that search temporarily reveals collapsed groups without losing their collapsed state.
test("opens matching collapsed groups during a title search", async () => {
  const user = userEvent.setup();
  const { rerender } = render(
    <MemoryRouter>
      <InventoryTree
        groups={[group]}
        inventories={[inventory]}
        searching={false}
      />
    </MemoryRouter>,
  );
  await user.click(screen.getByRole("button", { name: "Leisure" }));
  expect(screen.queryByRole("link", { name: "Games" })).not.toBeInTheDocument();
  rerender(
    <MemoryRouter>
      <InventoryTree groups={[group]} inventories={[inventory]} searching />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Games" })).toBeInTheDocument();
  rerender(
    <MemoryRouter>
      <InventoryTree
        groups={[group]}
        inventories={[inventory]}
        searching={false}
      />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("link", { name: "Games" })).not.toBeInTheDocument();
});

// Test that empty groups are hidden during filtering and unassigned inventories remain accessible.
test("hides nonmatching groups and renders inventories without a group", () => {
  render(
    <MemoryRouter>
      <InventoryTree
        groups={[group]}
        inventories={[{ ...inventory, group_id: null }]}
        searching
      />
    </MemoryRouter>,
  );
  expect(
    screen.queryByRole("button", { name: "Leisure" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Games" })).toHaveAttribute(
    "href",
    "/inventories/games/items",
  );
});
