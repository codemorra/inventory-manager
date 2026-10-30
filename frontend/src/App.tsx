import "./App.css";

import { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AppShell } from "./components/layout/AppShell";

/** Show a localized status while the initial route module loads. */
function InitialLoading() {
  const { t } = useTranslation();
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas p-5 text-foreground">
      <p role="status">{t("common.loading")}</p>
    </main>
  );
}

// A data router supports explicit navigation blocking for unsaved table drafts.
const router = createBrowserRouter([
  {
    HydrateFallback: InitialLoading,
    element: (
      <AppShell>
        <Outlet />
      </AppShell>
    ),
    children: [
      {
        path: "/",
        lazy: async () => ({
          Component: (await import("./pages/InventoryOverviewPage"))
            .InventoryOverviewPage,
        }),
      },
      {
        path: "/settings",
        lazy: async () => ({
          Component: (await import("./pages/SettingsPage")).SettingsPage,
        }),
      },
      {
        path: "/inventories/:inventoryId/items",
        lazy: async () => ({
          Component: (await import("./pages/InventoryItemsPage"))
            .InventoryItemsPage,
        }),
      },
      {
        path: "/inventories/:inventoryId/fields",
        lazy: async () => ({
          Component: (await import("./pages/InventoryFieldsPage"))
            .InventoryFieldsPage,
        }),
      },
    ],
  },
]);

/** Render the application router with draft-aware navigation support. */
function App() {
  return <RouterProvider router={router} />;
}

export default App;
