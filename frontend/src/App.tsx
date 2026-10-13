import "./App.css";

import { BrowserRouter, Route, Routes } from "react-router-dom";

import { InventoryOverviewPage } from "./pages/InventoryOverviewPage";
import { InventoryItemsPage } from "./pages/InventoryItemsPage";
import { InventoryFieldsPage } from "./pages/InventoryFieldsPage";
import { LanguageSwitch } from "./components/LanguageSwitch";

/** Render the application router. */
function App() {
  return (
    <BrowserRouter>
      <div className="fixed right-6 top-6 z-40">
        <LanguageSwitch />
      </div>
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
    </BrowserRouter>
  );
}

export default App;
