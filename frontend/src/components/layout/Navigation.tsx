import { Link, NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { useInventories } from "../../hooks/useInventories";
import { ApiError } from "../../services/api";
import { InventoryCreateForm } from "../InventoryCreateForm";

// Define properties for the primary application navigation.
interface NavigationProps {
  onNavigate?: () => void;
}

/**
 * Render links to the main application sections.
 * @param onNavigate Callback invoked after selecting a navigation link.
 * @returns The primary application navigation.
 */
export function Navigation({ onNavigate }: NavigationProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const { data: inventories, error, isError, isPending } = useInventories();

  return (
    <nav
      aria-label={t("navigation.label")}
      className="mt-8 flex min-h-0 flex-1 flex-col"
    >
      <InventoryCreateForm triggerClassName="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-surface transition hover:bg-accent-hover" />

      <NavLink
        className={({ isActive }) =>
          `mt-5 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
            isActive
              ? "bg-accent-soft text-accent"
              : "text-muted hover:bg-surface-hover hover:text-foreground"
          }`
        }
        end
        onClick={onNavigate}
        to="/"
      >
        <svg
          aria-hidden="true"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.7"
          viewBox="0 0 24 24"
        >
          <path d="M4 7.5 12 3l8 4.5-8 4.5-8-4.5Z" />
          <path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5" />
        </svg>
        {t("navigation.allInventories")}
      </NavLink>

      <div className="mt-5 flex min-h-0 flex-1 flex-col border-t border-shell pt-4">
        <p className="px-3 text-xs font-semibold uppercase tracking-wider text-muted">
          {t("navigation.inventories")}
        </p>

        {isPending && (
          <p className="px-3 py-3 text-sm text-muted" role="status">
            {t("navigation.loadingInventories")}
          </p>
        )}

        {isError && (
          <p className="px-3 py-3 text-sm text-danger" role="alert">
            {error instanceof ApiError
              ? error.message
              : t("navigation.inventoryError")}
          </p>
        )}

        {!isPending && !isError && inventories?.length === 0 && (
          <p className="px-3 py-3 text-sm leading-relaxed text-muted">
            {t("navigation.noInventories")}
          </p>
        )}

        {!isPending && !isError && inventories && inventories.length > 0 && (
          <ul className="mt-2 space-y-1 overflow-y-auto">
            {inventories.map((inventory) => {
              const isActive = location.pathname.startsWith(
                `/inventories/${inventory.id}/`,
              );

              return (
                <li key={inventory.id}>
                  <Link
                    aria-current={isActive ? "page" : undefined}
                    className={`block truncate rounded-lg px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? "bg-accent-soft font-medium text-accent"
                        : "text-muted hover:bg-surface-hover hover:text-foreground"
                    }`}
                    onClick={onNavigate}
                    title={inventory.name}
                    to={`/inventories/${inventory.id}/items`}
                  >
                    {inventory.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>
  );
}
