import { useRef, useState } from "react";
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
  const { t, i18n } = useTranslation();
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const location = useLocation();
  const { data: inventories, error, isError, isPending } = useInventories();
  const locale = i18n.resolvedLanguage ?? "en";
  const query = search.trim().toLocaleLowerCase(locale);
  const filteredInventories = inventories?.filter((inventory) =>
    inventory.name.toLocaleLowerCase(locale).includes(query),
  );

  // Restore the full inventory list and keep keyboard focus in the search field.
  function clearSearch() {
    setSearch("");
    searchInput.current?.focus();
  }

  return (
    <nav
      aria-label={t("navigation.label")}
      className="flex min-h-0 flex-1 flex-col px-3 pb-4 pt-5"
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

        <div
          className="relative mt-3 shrink-0"
          role="search"
          aria-label={t("navigation.searchInventories")}
        >
          <label className="block">
            <span className="sr-only">{t("navigation.searchInventories")}</span>
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              viewBox="0 0 24 24"
            >
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="m16 16 4 4" />
            </svg>
            <input
              className="w-full rounded-md border border-shell bg-surface py-2 pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 [&::-webkit-search-cancel-button]:appearance-none"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && search) {
                  // Clear the filter before Escape dismisses the mobile navigation.
                  event.preventDefault();
                  event.stopPropagation();
                  clearSearch();
                }
              }}
              placeholder={t("navigation.searchPlaceholder")}
              ref={searchInput}
              type="search"
              value={search}
            />
          </label>
          {search && (
            <button
              aria-label={t("navigation.clearSearch")}
              className="absolute right-1 top-1 rounded-md p-1.5 text-muted hover:bg-surface-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
              onClick={clearSearch}
              type="button"
            >
              <svg
                aria-hidden="true"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                viewBox="0 0 24 24"
              >
                <path d="m6 6 12 12M6 18 18 6" />
              </svg>
            </button>
          )}
        </div>

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

        {!isPending &&
          !isError &&
          inventories &&
          inventories.length > 0 &&
          filteredInventories?.length === 0 && (
            <p
              className="px-3 py-3 text-sm leading-relaxed text-muted"
              role="status"
            >
              {t("navigation.noSearchResults")}
            </p>
          )}

        {!isPending &&
          !isError &&
          filteredInventories &&
          filteredInventories.length > 0 && (
            <ul className="mt-2 min-h-0 space-y-0.5 overflow-y-auto overscroll-contain">
              {filteredInventories.map((inventory) => {
                const isActive = location.pathname.startsWith(
                  `/inventories/${inventory.id}/`,
                );

                return (
                  <li key={inventory.id}>
                    <Link
                      aria-current={isActive ? "page" : undefined}
                      className={`block truncate rounded-lg px-3 py-2 text-sm transition-colors ${
                        isActive
                          ? "bg-accent-soft font-semibold text-accent"
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
