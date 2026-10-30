import type { PointerEvent } from "react";

/**
 * Follow the hovered action so pointer and keyboard navigation share one active menu item.
 * @param event A pointer entering or moving inside a menu.
 */
export function focusHoveredMenuItem(event: PointerEvent<HTMLElement>) {
  if (event.pointerType === "touch" || !(event.target instanceof Element))
    return;
  const button = event.target.closest<HTMLButtonElement>(
    'button[role="menuitem"], button[role="menuitemcheckbox"]',
  );
  if (
    button &&
    !button.disabled &&
    event.currentTarget.contains(button) &&
    document.activeElement !== button
  )
    button.focus({ preventScroll: true });
}
