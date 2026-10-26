import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

// Configure the compact action row without coupling it to item mutations or routing.
interface InventoryTableControlsProps {
  itemCount?: number;
  actions?: ReactNode;
  wrapText?: boolean;
  onWrapTextChange?: (wrap: boolean) => void;
  disabled?: boolean;
}

/**
 * Render view options on the left and item actions on the right.
 * @param props The item count, actions, and text wrapping preference.
 * @returns A compact action row with a keyboard-accessible View dropdown.
 */
export function InventoryTableControls({
  itemCount,
  actions,
  wrapText = true,
  onWrapTextChange,
  disabled = false,
}: InventoryTableControlsProps) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusLast = useRef(false);
  const available = !disabled && !!onWrapTextChange;
  const expanded = open && available;

  // Discard a menu that becomes unavailable instead of reopening it after a save.
  if (open && !available) setOpen(false);

  useLayoutEffect(() => {
    if (!expanded) return;
    const element = menu.current;
    const anchor = trigger.current?.getBoundingClientRect();
    if (!element || !anchor) return;
    const rect = element.getBoundingClientRect();
    // Portal menus remain visible above the table's scrolling and sticky cells.
    element.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - rect.height - 8))}px`;
    const buttons = element.querySelectorAll<HTMLButtonElement>("button");
    buttons[focusLast.current ? buttons.length - 1 : 0]?.focus();
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    /**
     * Dismiss the menu without stealing focus from the clicked control.
     * @param event The pointer event outside the dropdown and its trigger.
     */
    function dismissOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false);
    }
    // A changed viewport invalidates the menu's anchor position.
    function dismissOnMove() {
      setOpen(false);
    }
    document.addEventListener("pointerdown", dismissOutside);
    window.addEventListener("resize", dismissOnMove);
    window.addEventListener("scroll", dismissOnMove, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      window.removeEventListener("resize", dismissOnMove);
      window.removeEventListener("scroll", dismissOnMove, true);
    };
  }, [expanded]);

  // Return keyboard focus to View when closing its dropdown.
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  /**
   * Navigate view options while allowing Tab to continue to the direct actions.
   * @param event The keyboard event from the View button or a dropdown action.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    const inMenu = menu.current?.contains(event.target as Node);
    const buttons = Array.from(
      menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    );
    if (event.key === "Tab" && expanded) {
      // Move focus out of the portal before the browser advances to the next control.
      close();
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (inMenu && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (inMenu) {
        const index = buttons.findIndex(
          (button) => button === document.activeElement,
        );
        const direction = event.key === "ArrowDown" ? 1 : -1;
        buttons[(index + direction + buttons.length) % buttons.length]?.focus();
      } else if (available) {
        focusLast.current = event.key === "ArrowUp";
        setOpen(true);
      }
    }
  }

  return (
    <div
      role="group"
      aria-label={t("table.menu.label")}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-t-md border border-b-0 border-shell bg-surface-muted p-1.5 text-sm text-foreground"
    >
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={expanded}
        aria-controls={expanded ? `${id}-menu` : undefined}
        disabled={!available}
        className={`cursor-pointer rounded-sm px-2.5 py-1.5 text-sm font-medium transition enabled:hover:bg-control-hover focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${expanded ? "bg-control-hover text-heading" : ""}`}
        onKeyDown={handleKeyDown}
        onClick={() => {
          focusLast.current = false;
          setOpen(!expanded);
        }}
      >
        {t("table.menu.view")}
      </button>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {itemCount !== undefined && (
          <p className="text-xs tabular-nums text-muted">
            {t("items.count", { count: itemCount })}
          </p>
        )}
        {actions}
      </div>
      {expanded &&
        createPortal(
          <div
            ref={menu}
            id={`${id}-menu`}
            role="menu"
            aria-label={t("table.menu.view")}
            className="fixed z-40 min-w-48 max-w-[calc(100vw-1rem)] rounded-md border border-shell bg-surface p-1 text-sm text-foreground shadow-raised"
            onKeyDown={handleKeyDown}
          >
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={wrapText}
              tabIndex={-1}
              className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-left outline-none hover:bg-control-hover focus:bg-control-hover"
              onClick={() => {
                onWrapTextChange?.(!wrapText);
                close();
              }}
            >
              <span aria-hidden="true" className="w-4 text-accent">
                {wrapText ? "✓" : ""}
              </span>
              {t("table.menu.wrapText")}
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
