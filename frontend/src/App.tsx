import "./App.css";

import { BrowserRouter, Route, Routes } from "react-router-dom";

import { InventoryOverviewPage } from "./pages/InventoryOverviewPage";

/** Render the application router. */
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<InventoryOverviewPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
