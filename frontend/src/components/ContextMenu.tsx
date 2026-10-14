import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

// Define a context menu action.
export interface ContextMenuAction {
  label: string;
  onSelect: () => void;
  danger?: boolean;
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

  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    // Keep both menu edges visible when opened close to a viewport boundary.
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    element.querySelector<HTMLButtonElement>("button")?.focus();
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
    window.addEventListener("pointerdown", dismissOutside);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("pointerdown", dismissOutside);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      className="fixed z-60 min-w-44 max-w-[calc(100vw-1rem)] rounded-md border border-shell bg-surface p-1 text-sm text-foreground shadow-raised"
      style={{ left: x, top: y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const buttons = Array.from(
          menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [],
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
          role="menuitem"
          type="button"
          className={`block w-full rounded-md px-3 py-2 text-left outline-none ${action.danger ? "text-danger enabled:hover:bg-danger/25 focus:bg-danger-soft" : "enabled:hover:bg-control-hover enabled:hover:border-accent/50 focus:bg-surface-hover"}`}
          onClick={action.onSelect}
        >
          {action.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
