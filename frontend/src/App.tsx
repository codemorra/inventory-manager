import "./App.css";

import { BrowserRouter, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/layout/AppShell";
import { InventoryOverviewPage } from "./pages/InventoryOverviewPage";
import { InventoryItemsPage } from "./pages/InventoryItemsPage";
import { InventoryFieldsPage } from "./pages/InventoryFieldsPage";

/** Render the application router. */
function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<InventoryOverviewPage />} />
          <Route
            path="/inventories/:inventoryId/items"
            element={<InventoryItemsPage />}
          />
          <Route
            path="/inventories/:inventoryId/fields"
            element={<InventoryFieldsPage />}
          />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}

export default App;
