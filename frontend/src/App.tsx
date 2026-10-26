import "./App.css";

import { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";

import { AppShell } from "./components/layout/AppShell";
import { InventoryOverviewPage } from "./pages/InventoryOverviewPage";
import { InventoryItemsPage } from "./pages/InventoryItemsPage";
import { InventoryFieldsPage } from "./pages/InventoryFieldsPage";

// A data router supports explicit navigation blocking for unsaved table drafts.
const router = createBrowserRouter([
  {
    element: (
      <AppShell>
        <Outlet />
      </AppShell>
    ),
    children: [
      { path: "/", element: <InventoryOverviewPage /> },
      {
        path: "/inventories/:inventoryId/items",
        element: <InventoryItemsPage />,
      },
      {
        path: "/inventories/:inventoryId/fields",
        element: <InventoryFieldsPage />,
      },
    ],
  },
]);

/** Render the application router with draft-aware navigation support. */
function App() {
  return <RouterProvider router={router} />;
}

export default App;
