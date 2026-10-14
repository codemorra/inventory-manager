import type { ReactNode } from "react";

// Define the summary and actions displayed above inventory content.
interface InventoryToolbarProps {
  children: ReactNode;
  actions?: ReactNode;
}

/**
 * Render a shared toolbar separate from the inventory table or field list.
 * @param children The section summary and optional secondary controls.
 * @param actions The primary creation action.
 * @returns The responsive inventory toolbar.
 */
export function InventoryToolbar({ children, actions }: InventoryToolbarProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-shell pb-4">
      <div className="flex flex-wrap items-center gap-3">{children}</div>
      {actions}
    </div>
  );
}
