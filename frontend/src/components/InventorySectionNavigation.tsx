import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

// Define properties for inventory section navigation.
interface InventorySectionNavigationProps {
  inventoryId: string;
}

/**
 * Render navigation between inventory items and field configuration.
 * @param inventoryId The active inventory identifier.
 * @returns Navigation links for the inventory sections.
 */
export function InventorySectionNavigation({
  inventoryId,
}: InventorySectionNavigationProps) {
  const { t } = useTranslation();
  const links = [
    {
      label: t("inventories.actions.items"),
      to: `/inventories/${inventoryId}/items`,
    },
    {
      label: t("inventories.actions.fields"),
      to: `/inventories/${inventoryId}/fields`,
    },
  ];

  return (
    <nav aria-label={t("navigation.inventorySections")} className="mb-8">
      <div className="inline-flex rounded-xl border border-shell bg-surface p-1 shadow-soft">
        {links.map((link) => (
          <NavLink
            className={({ isActive }) =>
              `rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                isActive
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-surface-hover hover:text-foreground"
              }`
            }
            key={link.to}
            to={link.to}
          >
            {link.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
