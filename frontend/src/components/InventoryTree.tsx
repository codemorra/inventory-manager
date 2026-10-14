import { type DragEvent, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { Inventory } from "../types/inventory";
import type { InventoryGroup } from "../services/inventoryGroups";

// Identify application inventory drags without accepting arbitrary external data.
const inventoryDragType = "application/x-inventory-manager-inventory";

// Define the filtered inventory navigation tree properties.
interface InventoryTreeProps {
  inventories: Inventory[];
  groups: InventoryGroup[];
  searching: boolean;
  onNavigate?: (() => void) | undefined;
  onMove?: (inventoryId: string, groupId: string | null) => void;
  disabled?: boolean;
}

/**
 * Render inventory groups with directly draggable inventory links.
 * @param inventories The inventories matching the current title filter.
 * @param groups The available destination groups.
 * @param searching Whether the title filter is active.
 * @param onNavigate Callback invoked after following an inventory link.
 * @param onMove Callback used to persist a membership change.
 * @param disabled Whether membership changes are temporarily unavailable.
 * @returns The grouped inventory navigation list.
 */
export function InventoryTree({
  inventories,
  groups,
  searching,
  onNavigate,
  onMove,
  disabled = false,
}: InventoryTreeProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overTarget, setOverTarget] = useState<string | null>(null);

  // Clear the current drag and its highlighted destination.
  function cancelMove() {
    setDraggedId(null);
    setOverTarget(null);
  }

  /**
   * Move an inventory into a group, opening its destination when necessary.
   * @param inventoryId The inventory identifier.
   * @param groupId The destination group, or null for ungrouped inventories.
   */
  function move(inventoryId: string, groupId: string | null) {
    const inventory = inventories.find((entry) => entry.id === inventoryId);
    if (
      !disabled &&
      inventory &&
      onMove &&
      (inventory.group_id ?? null) !== groupId
    ) {
      onMove(inventoryId, groupId);
      if (groupId)
        setCollapsed((current) => {
          const next = new Set(current);
          next.delete(groupId);
          return next;
        });
    }
    cancelMove();
  }

  /**
   * Start dragging an inventory directly from its navigation link.
   * @param event The native drag event.
   * @param inventoryId The inventory to move.
   */
  function startDrag(event: DragEvent, inventoryId: string) {
    if (disabled || !onMove) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(inventoryDragType, inventoryId);
    event.dataTransfer.effectAllowed = "move";
    setDraggedId(inventoryId);
  }

  /**
   * Accept a drag over a destination from this application.
   * @param event The drag-over event.
   * @param target The destination key used for highlighting.
   */
  function dragOver(event: DragEvent, target: string) {
    if (
      disabled ||
      !draggedId ||
      !event.dataTransfer.types.includes(inventoryDragType)
    )
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setOverTarget(target);
  }

  /**
   * Persist a dropped inventory after validating its application drag payload.
   * @param event The drop event.
   * @param groupId The destination group, or null for ungrouped inventories.
   */
  function drop(event: DragEvent, groupId: string | null) {
    event.preventDefault();
    const inventoryId = event.dataTransfer.getData(inventoryDragType);
    if (inventoryId && inventoryId === draggedId) move(inventoryId, groupId);
    else cancelMove();
  }

  /**
   * Render inventory links that also act as drag sources.
   * @param entries The inventories in a group.
   * @returns The inventory navigation rows.
   */
  function links(entries: Inventory[]) {
    return entries.map((inventory) => {
      const active = location.pathname.startsWith(
        `/inventories/${inventory.id}/`,
      );
      return (
        <li
          key={inventory.id}
          className={`rounded-md ${draggedId === inventory.id ? "ring-1 ring-accent opacity-60" : ""}`}
        >
          <Link
            aria-current={active ? "page" : undefined}
            className={`block truncate rounded-md px-3 py-2 text-sm transition-colors ${active ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-surface-hover hover:text-foreground"}`}
            draggable={Boolean(onMove) && !disabled}
            onDragStart={(event) => startDrag(event, inventory.id)}
            onDragEnd={cancelMove}
            onClick={onNavigate}
            title={inventory.name}
            to={`/inventories/${inventory.id}/items`}
          >
            {inventory.name}
          </Link>
        </li>
      );
    });
  }

  const ungrouped = inventories.filter(
    (inventory) => !groups.some((group) => group.id === inventory.group_id),
  );

  return (
    <div className="mt-2 min-h-0 overflow-y-auto overscroll-contain">
      <ul className="space-y-1">
        {groups.map((group) => {
          const entries = inventories.filter(
            (inventory) => inventory.group_id === group.id,
          );
          if (searching && entries.length === 0 && !draggedId) return null;
          const open = searching || !collapsed.has(group.id);
          return (
            <li
              key={group.id}
              onDragOver={(event) => dragOver(event, group.id)}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  setOverTarget(null);
              }}
              onDrop={(event) => drop(event, group.id)}
              className={
                overTarget === group.id
                  ? "rounded-md bg-accent-soft ring-1 ring-accent"
                  : ""
              }
            >
              <button
                aria-expanded={open}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm font-semibold text-heading hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-accent"
                onClick={() => {
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(group.id)) next.delete(group.id);
                    else next.add(group.id);
                    return next;
                  });
                }}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className={`size-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  viewBox="0 0 16 16"
                >
                  <path d="m6 3 5 5-5 5" />
                </svg>
                <span className="min-w-0 flex-1 truncate" title={group.name}>
                  {group.name}
                </span>
                <span
                  aria-hidden="true"
                  className="text-xs font-normal text-muted"
                >
                  {entries.length}
                </span>
              </button>
              {open && (
                <ul className="ml-3 border-l border-shell pl-1">
                  {entries.length ? (
                    links(entries)
                  ) : (
                    <li className="px-3 py-2 text-xs text-muted">
                      {t("groups.empty")}
                    </li>
                  )}
                </ul>
              )}
            </li>
          );
        })}
        {(ungrouped.length > 0 || groups.length > 0) && (
          <li
            className={
              overTarget === "ungrouped"
                ? "rounded-md bg-accent-soft ring-1 ring-accent"
                : ""
            }
            onDragOver={(event) => dragOver(event, "ungrouped")}
            onDragLeave={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              )
                setOverTarget(null);
            }}
            onDrop={(event) => drop(event, null)}
          >
            {groups.length > 0 && (
              <p className="px-3 py-2 text-xs font-semibold text-muted">
                {t("groups.ungrouped")}
              </p>
            )}
            <ul>{links(ungrouped)}</ul>
          </li>
        )}
      </ul>
    </div>
  );
}
