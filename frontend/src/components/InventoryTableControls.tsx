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

// Describe a field's presentation without exposing mutable field configuration.
interface TableColumn {
  id: string;
  name: string;
  visible: boolean;
}

// Configure the compact action row without coupling it to item mutations or routing.
interface InventoryTableControlsProps {
  itemCount?: number;
  actions?: ReactNode;
  wrapText?: boolean;
  onWrapTextChange?: (wrap: boolean) => void;
  disabled?: boolean;
  columns?: TableColumn[];
  onToggleColumn?: (fieldId: string) => void;
  onAutomaticWidths?: () => void;
  allColumnsAutomatic?: boolean;
}

/**
 * Render view options on the left and item actions on the right.
 * @param props The item count, actions, text wrapping, and visible columns.
 * @returns A compact action row with a keyboard-accessible View dropdown.
 */
export function InventoryTableControls({
  itemCount,
  actions,
  wrapText = true,
  onWrapTextChange,
  disabled = false,
  columns = [],
  onToggleColumn,
  onAutomaticWidths,
  allColumnsAutomatic = true,
}: InventoryTableControlsProps) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const columnsTrigger = useRef<HTMLButtonElement>(null);
  const columnsMenu = useRef<HTMLDivElement>(null);
  const focusColumns = useRef(false);
  const focusLast = useRef(false);
  const available =
    !disabled &&
    (!!onWrapTextChange ||
      !!onAutomaticWidths ||
      (!!onToggleColumn && columns.length > 0));
  const expanded = open && available;
  const hasColumns = !!onToggleColumn && columns.length > 0;
  const columnsExpanded = expanded && columnsOpen && hasColumns;
  const visibleCount = columns.filter((column) => column.visible).length;

  // Discard a menu that becomes unavailable instead of reopening it after a save.
  if (open && !available) setOpen(false);
  if (columnsOpen && (!expanded || !hasColumns)) setColumnsOpen(false);

  useLayoutEffect(() => {
    if (!expanded) return;
    const element = menu.current;
    const anchor = trigger.current?.getBoundingClientRect();
    if (!element || !anchor) return;
    const rect = element.getBoundingClientRect();
    // Portal menus remain visible above the table's scrolling and sticky cells.
    element.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - rect.height - 8))}px`;
    const buttons = element.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    buttons[focusLast.current ? buttons.length - 1 : 0]?.focus();
  }, [expanded]);

  useLayoutEffect(() => {
    if (!columnsExpanded) return;
    const element = columnsMenu.current;
    const anchor = columnsTrigger.current?.getBoundingClientRect();
    if (!element || !anchor) return;
    const rect = element.getBoundingClientRect();
    // Open to the left when the right edge cannot accommodate a separate submenu.
    const left =
      anchor.right + 4 + rect.width <= window.innerWidth - 8
        ? anchor.right + 4
        : anchor.left - rect.width - 4;
    element.style.left = `${Math.max(8, Math.min(left, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(anchor.top, window.innerHeight - rect.height - 8))}px`;
    if (focusColumns.current)
      element
        .querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus();
  }, [columnsExpanded]);

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
        !columnsMenu.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false);
    }
    // A changed viewport invalidates the menu's anchor position.
    function dismissOnMove(event: Event) {
      // Scrolling a long column list should not dismiss its own menu.
      if (
        event.target instanceof Node &&
        columnsMenu.current?.contains(event.target)
      )
        return;
      if (event.target instanceof Node && menu.current?.contains(event.target))
        setColumnsOpen(false);
      else setOpen(false);
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
    setColumnsOpen(false);
    setOpen(false);
    trigger.current?.focus();
  }

  /**
   * Show column choices with optional focus transfer for keyboard and click access.
   * @param focus Whether to focus the first enabled column choice.
   */
  function openColumns(focus: boolean) {
    focusColumns.current = focus;
    setColumnsOpen(true);
    if (columnsExpanded && focus)
      columnsMenu.current
        ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus();
  }

  // Return to the parent menu without dismissing View.
  function closeColumns() {
    setColumnsOpen(false);
    columnsTrigger.current?.focus();
  }

  /**
   * Navigate view options while allowing Tab to continue to the direct actions.
   * @param event The keyboard event from the View button or a dropdown action.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    const inColumns = columnsMenu.current?.contains(event.target as Node);
    const activeMenu = inColumns ? columnsMenu.current : menu.current;
    const inMenu = activeMenu?.contains(event.target as Node);
    const buttons = Array.from(
      activeMenu?.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ) ?? [],
    );
    if (event.key === "Tab" && expanded) {
      // Move focus out of the portal before the browser advances to the next control.
      close();
    } else if (event.key === "ArrowLeft" && inColumns) {
      event.preventDefault();
      event.stopPropagation();
      closeColumns();
    } else if (
      event.key === "ArrowRight" &&
      event.target === columnsTrigger.current
    ) {
      event.preventDefault();
      openColumns(true);
    } else if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      if (
        columnsExpanded &&
        (inColumns || event.target === columnsTrigger.current)
      )
        closeColumns();
      else close();
    } else if (inMenu && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
      if (!inColumns && document.activeElement !== columnsTrigger.current)
        setColumnsOpen(false);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (inMenu) {
        const index = buttons.findIndex(
          (button) => button === document.activeElement,
        );
        const direction = event.key === "ArrowDown" ? 1 : -1;
        buttons[(index + direction + buttons.length) % buttons.length]?.focus();
        if (!inColumns && document.activeElement !== columnsTrigger.current)
          setColumnsOpen(false);
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
          <>
            <div
              ref={menu}
              id={`${id}-menu`}
              role="menu"
              aria-label={t("table.menu.view")}
              className="fixed z-40 max-h-[calc(100dvh-1rem)] min-w-48 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-md border border-shell bg-surface p-1 text-sm text-foreground shadow-raised"
              onKeyDown={handleKeyDown}
            >
              {onWrapTextChange && (
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={wrapText}
                  tabIndex={-1}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-left outline-none hover:bg-control-hover focus:bg-control-hover"
                  onPointerEnter={(event) => {
                    if (event.pointerType === "mouse") setColumnsOpen(false);
                  }}
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
              )}
              {hasColumns && (
                <>
                  {onWrapTextChange && (
                    <div
                      role="separator"
                      className="my-1 border-t border-shell"
                    />
                  )}
                  <button
                    ref={columnsTrigger}
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={columnsExpanded}
                    aria-controls={
                      columnsExpanded ? `${id}-columns` : undefined
                    }
                    tabIndex={-1}
                    className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-sm px-3 py-2 text-left outline-none hover:bg-control-hover focus:bg-control-hover"
                    onPointerEnter={(event) => {
                      if (event.pointerType === "mouse") openColumns(false);
                    }}
                    onClick={() => openColumns(true)}
                  >
                    {t("table.menu.columns")}
                    <svg
                      aria-hidden="true"
                      className="size-3.5 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      viewBox="0 0 16 16"
                    >
                      <path d="m6 4 4 4-4 4" />
                    </svg>
                  </button>
                </>
              )}
              {onAutomaticWidths && (
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={allColumnsAutomatic}
                  tabIndex={-1}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-left outline-none enabled:hover:bg-control-hover focus:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50"
                  onPointerEnter={(event) => {
                    if (event.pointerType === "mouse") setColumnsOpen(false);
                  }}
                  onClick={() => {
                    onAutomaticWidths();
                    close();
                  }}
                >
                  <span aria-hidden="true" className="w-4 shrink-0 text-accent">
                    {allColumnsAutomatic ? "✓" : ""}
                  </span>
                  {t("table.menu.automaticWidths")}
                </button>
              )}
            </div>
            {columnsExpanded && (
              <div
                ref={columnsMenu}
                id={`${id}-columns`}
                role="menu"
                aria-label={t("table.menu.columns")}
                className="fixed z-40 max-h-[calc(100dvh-1rem)] min-w-48 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-md border border-shell bg-surface p-1 text-sm text-foreground shadow-raised"
                onKeyDown={handleKeyDown}
              >
                {columns.map((column) => (
                  <button
                    key={column.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={column.visible}
                    disabled={column.visible && visibleCount <= 1}
                    title={
                      column.visible && visibleCount <= 1
                        ? t("table.menu.keepColumn")
                        : undefined
                    }
                    tabIndex={-1}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-left outline-none enabled:hover:bg-control-hover focus:bg-control-hover disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={() => onToggleColumn?.(column.id)}
                  >
                    <span
                      aria-hidden="true"
                      className="w-4 shrink-0 text-accent"
                    >
                      {column.visible ? "✓" : ""}
                    </span>
                    <span className="min-w-0 wrap-break-word">
                      {column.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>,
          document.body,
        )}
    </div>
  );
}
