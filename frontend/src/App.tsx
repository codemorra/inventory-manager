import "./App.css";

import { BrowserRouter, Route, Routes } from "react-router-dom";

import { InventoryOverviewPage } from "./pages/InventoryOverviewPage";
import { InventoryFieldsPage } from "./pages/InventoryFieldsPage";

/** Render the application router. */
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<InventoryOverviewPage />} />
        <Route
          path="/inventories/:inventoryId/fields"
          element={<InventoryFieldsPage />}
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
