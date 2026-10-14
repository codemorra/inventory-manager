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
    <nav
      aria-label={t("navigation.inventorySections")}
      className="mb-5 border-b border-shell"
    >
      <div className="flex gap-1">
        {links.map((link) => (
          <NavLink
            className={({ isActive }) =>
              `border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
                isActive
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-transparent text-muted hover:bg-surface-hover hover:text-foreground"
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
