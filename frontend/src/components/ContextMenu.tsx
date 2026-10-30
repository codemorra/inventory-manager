import { focusHoveredMenuItem } from "./menuPointerFocus";
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

// Define a context menu action.
export interface ContextMenuAction {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  checked?: boolean;
  disabled?: boolean;
  title?: string | undefined;
}

// Define the position, accessible name, and actions of a context menu.
interface ContextMenuProps {
  x: number;
  y: number;
  label: string;
  actions: ContextMenuAction[];
  onClose: () => void;
}

/**
 * Render a viewport-constrained menu above application surfaces.
 * @param x The requested horizontal position.
 * @param y The requested vertical position.
 * @param label The accessible menu name.
 * @param actions The available menu actions.
 * @param onClose Callback used to dismiss the menu.
 * @returns The portal containing the context menu.
 */
export function ContextMenu({
  x,
  y,
  label,
  actions,
  onClose,
}: ContextMenuProps) {
  const menu = useRef<HTMLDivElement>(null);
  const hasIndicators = actions.some((action) => action.checked !== undefined);

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    // Keep both menu edges visible when opened close to a viewport boundary.
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    /**
     * Dismiss a menu when the pointer is pressed outside it.
     * @param event The pointer event to inspect.
     */
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Node && !menu.current?.contains(event.target))
        onClose();
    }
    /**
     * Keep scrolling inside the menu available while dismissing displaced anchors.
     * @param event The scroll event whose target may be inside the menu.
     */
    function dismissOnScroll(event: Event) {
      if (!(
        event.target instanceof Node && menu.current?.contains(event.target)
      ))
        onClose();
    }
    window.addEventListener("pointerdown", dismissOutside);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", dismissOnScroll, true);
    return () => {
      window.removeEventListener("pointerdown", dismissOutside);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", dismissOnScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menu}
      role="menu"
      onPointerOver={focusHoveredMenuItem}
      onPointerMove={focusHoveredMenuItem}
      aria-label={label}
      className="fixed z-60 max-h-[calc(100dvh-1rem)] min-w-44 max-w-[calc(100vw-1rem)] overflow-y-auto overscroll-contain rounded-md border border-shell bg-surface p-1 text-sm text-foreground shadow-raised"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const buttons = Array.from(
          menu.current?.querySelectorAll<HTMLButtonElement>(
            "button:not(:disabled)",
          ) ?? [],
        );
        const index = buttons.findIndex(
          (button) => button === document.activeElement,
        );
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? buttons.length - 1
                : (index +
                    (event.key === "ArrowUp" ? -1 : 1) +
                    buttons.length) %
                  buttons.length;
          buttons[next]?.focus();
        } else if (event.key === "Escape" || event.key === "Tab") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          role={action.checked === undefined ? "menuitem" : "menuitemcheckbox"}
          aria-checked={action.checked}
          disabled={action.disabled}
          title={action.title}
          tabIndex={-1}
          type="button"
          className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-left outline-none disabled:cursor-not-allowed disabled:opacity-50 ${action.danger ? "text-danger enabled:hover:bg-danger/25 focus-visible:bg-danger-soft" : "enabled:hover:bg-control-hover enabled:hover:border-accent/50 focus-visible:bg-surface-hover"}`}
          onClick={action.onSelect}
        >
          {hasIndicators && (
            <span aria-hidden="true" className="w-4 shrink-0 text-accent-text">
              {action.checked ? "✓" : ""}
            </span>
          )}
          {action.icon && (
            <span
              aria-hidden="true"
              className={`shrink-0 ${action.danger ? "text-danger" : "text-accent-text"}`}
            >
              {action.icon}
            </span>
          )}
          <span className="min-w-0 wrap-break-word">{action.label}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
}
