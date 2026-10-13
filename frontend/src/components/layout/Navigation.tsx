import { NavLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

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

  return (
    <nav aria-label={t("navigation.label")} className="mt-8">
      <NavLink
        className={({ isActive }) =>
          `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
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
        {t("navigation.inventories")}
      </NavLink>
    </nav>
  );
}
