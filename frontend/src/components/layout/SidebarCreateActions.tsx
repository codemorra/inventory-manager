import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { ContextMenu } from "../ContextMenu";
import { InventoryCreateForm } from "../InventoryCreateForm";
import { TableEditSessionContext } from "../tableEditSession";

interface SidebarCreateActionsProps {
  onCreated: (() => void) | undefined;
  onCreateGroup: (() => void) | undefined;
  onImport: (() => void) | undefined;
}

type Action = "inventory" | "group" | "import";

/**
 * Render matching document, group and import symbols for sidebar actions.
 * @param kind The action represented by the icon.
 * @returns A decorative icon using the surrounding accent color.
 */
function ActionIcon({ kind }: { kind: Action }) {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      viewBox="0 0 24 24"
    >
      {kind === "inventory" ? (
        <>
          <path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5" />
          <path d="M9 14h6m-3-3v6" />
        </>
      ) : kind === "group" ? (
        <>
          <path d="M3 7V4h7l2 3h9v13H3V7Z" />
          <path d="M9 13h6m-3-3v6" />
        </>
      ) : (
        <>
          <path d="M7 7V3h7l6 6v12H7v-4m7-14v6h6" />
          <path d="M3 12h10m-3-3 3 3-3 3" />
        </>
      )}
    </svg>
  );
}

/**
 * Render the sidebar menu for inventory creation, groups and imports.
 * @param onCreated Callback after an inventory has been created.
 * @param onCreateGroup Callback opening the group dialog.
 * @param onImport Callback opening the import dialog.
 * @returns The action menu and its inventory creation dialog.
 */
export function SidebarCreateActions({
  onCreated,
  onCreateGroup,
  onImport,
}: SidebarCreateActionsProps) {
  const { t } = useTranslation();
  const { inventoryId, configurationInventoryId } = useContext(
    TableEditSessionContext,
  );
  const importDisabled = Boolean(inventoryId || configurationInventoryId);
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    source: HTMLButtonElement;
  } | null>(null);
  const entries = [
    { kind: "inventory", label: t("inventories.actions.new") },
    { kind: "group", label: t("groups.new") },
    { kind: "import", label: t("archives.import") },
  ] as const;

  /** Close the action menu and restore focus to its trigger. */
  function closeMenu() {
    setMenu(null);
    menu?.source.focus();
  }

  /**
   * Open the action menu immediately below its trigger.
   * @param source The trigger used to position the menu and restore focus.
   */
  function openMenu(source: HTMLButtonElement) {
    const bounds = source.getBoundingClientRect();
    setMenu({ x: bounds.left, y: bounds.bottom + 4, source });
  }

  /**
   * Dispatch the selected menu action.
   * @param kind The action selected by the user.
   */
  function select(kind: Action) {
    if (kind === "import" && importDisabled) return;
    if (menu) closeMenu();
    if (kind === "inventory") setCreating(true);
    else if (kind === "group") onCreateGroup?.();
    else onImport?.();
  }

  return (
    <div className="shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu !== null}
        onPointerDown={(event) => {
          if (menu) event.stopPropagation();
        }}
        onClick={(event) =>
          menu ? closeMenu() : openMenu(event.currentTarget)
        }
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            openMenu(event.currentTarget);
          }
        }}
        className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-surface hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-accent"
      >
        <span aria-hidden="true" className="text-base leading-none">
          +
        </span>
        {t("navigation.new")}
        <svg
          aria-hidden="true"
          className="size-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          viewBox="0 0 16 16"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={t("navigation.new")}
          onClose={closeMenu}
          actions={entries.map((entry) => ({
            label: entry.label,
            icon: <ActionIcon kind={entry.kind} />,
            onSelect: () => select(entry.kind),
            disabled: entry.kind === "import" && importDisabled,
            title:
              entry.kind === "import" && importDisabled
                ? t("archives.saveFirst")
                : entry.label,
          }))}
        />
      )}
      {creating && (
        <InventoryCreateForm
          onClose={() => setCreating(false)}
          onCreated={onCreated}
        />
      )}
    </div>
  );
}
