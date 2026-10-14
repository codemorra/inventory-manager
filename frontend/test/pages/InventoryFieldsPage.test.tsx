import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import { InventoryFieldsPanel } from "../../src/components/InventoryFieldsPanel";
import { InventoryFieldsPage } from "../../src/pages/InventoryFieldsPage";
import { renderDraftControl, field } from "../helpers/inventoryDraft";
afterEach(cleanup);

// Expose the redirected URL without rendering a full item page.
function RedirectLocation() {
  const location = useLocation();
  return <p>{location.pathname + location.search}</p>;
}

// Test that field bookmarks still open the shared editor.
test("redirects the old fields route to the editor", async () => {
  render(
    <MemoryRouter initialEntries={["/inventories/inventory-1/fields"]}>
      <Routes>
        <Route
          path="/inventories/:inventoryId/fields"
          element={<InventoryFieldsPage />}
        />
        <Route
          path="/inventories/:inventoryId/items"
          element={<RedirectLocation />}
        />
      </Routes>
    </MemoryRouter>,
  );
  expect(
    await screen.findByText("/inventories/inventory-1/items?edit=fields"),
  ).toBeInTheDocument();
});

// Test that an empty draft offers local field creation.
test("displays an empty field draft", () => {
  renderDraftControl(<InventoryFieldsPanel />, { fields: [] });
  expect(screen.getByText("No fields configured yet.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New field" })).toBeEnabled();
});

// Test that existing draft fields retain their display and independently scrollable list.
test("displays draft fields in a separate scroll area", () => {
  renderDraftControl(<InventoryFieldsPanel />);
  const list = screen.getByRole("list", { name: "Inventory fields" });
  expect(list).toHaveClass("overflow-y-auto", "min-h-0");
  expect(within(list).getByText("Brand")).toBeInTheDocument();
  expect(within(list).getByText("Text")).toBeInTheDocument();
  expect(field.field_type).toBe("text");
});
