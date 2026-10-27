import { TableEditSessionContext } from "./tableEditSession";
import {
  type SyntheticEvent,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  useInventoryEditor,
  useInventoryConfiguration,
  useReloadInventoryConfiguration,
} from "../hooks/useInventoryEditor";
import type { InventoryField } from "../types/inventoryField";
import {
  InventoryDraftContext,
  type InventoryDraftActions,
} from "./InventoryDraftContext";
import {
  buildInventoryEditorInput,
  createDraftField,
  isValidFieldDraft,
  moveDraftField,
} from "./inventoryEditorDraft";
import { ApiError } from "../services/api";
import type { Inventory } from "../types/inventory";
import { InventoryFieldsPanel } from "./InventoryFieldsPanel";
import { Modal } from "./Modal";
import { SaveInventoryTemplateDialog } from "./SaveInventoryTemplateDialog";

// Define the shared inventory editor and its initially visible section.
interface InventoryEditDialogProps {
  inventory: Inventory;
  onClose: () => void;
  initialSection?: "general" | "fields";
}

/**
 * Edit inventory metadata and field definitions in one dialog.
 * @param props The inventory, dismissal callback, and initial section.
 * @returns The inventory editor with general and field settings.
 */
export function InventoryEditDialog(props: InventoryEditDialogProps) {
  const { t } = useTranslation();
  const query = useInventoryConfiguration(props.inventory.id);
  if (!query.data) {
    return (
      <Modal title={t("inventories.titles.edit")} onClose={props.onClose}>
        {query.isError ? (
          <>
            <p role="alert" className="text-sm text-danger">
              {query.error instanceof ApiError
                ? query.error.message
                : t("fields.errors.load")}
            </p>
            <button
              type="button"
              className="mt-4 rounded-md border border-shell px-3 py-2 enabled:hover:bg-control-hover"
              onClick={() => void query.refetch()}
            >
              {t("common.actions.retry")}
            </button>
          </>
        ) : (
          <p role="status" className="text-sm text-muted">
            {t("fields.loading")}
          </p>
        )}
        <button
          type="button"
          className="mt-4 ml-2 rounded-md border border-shell px-3 py-2 enabled:hover:bg-control-hover"
          onClick={props.onClose}
        >
          {t("common.actions.cancel")}
        </button>
      </Modal>
    );
  }
  return (
    <InventoryEditorSession
      key={props.inventory.id}
      {...props}
      inventory={query.data.inventory}
      initialFields={query.data.fields}
    />
  );
}

// Supply the immutable session snapshot independently of later query refreshes.
interface InventoryEditorSessionProps extends InventoryEditDialogProps {
  initialFields: InventoryField[];
}

/**
 * Keep an inventory configuration draft isolated until explicitly saved.
 * @param inventory The inventory metadata captured on opening.
 * @param initialFields The saved fields used as the draft baseline.
 * @param onClose Callback used to discard or finish the session.
 * @param initialSection The initially visible editor section.
 * @returns The draft-backed editor and its shared save action.
 */
function InventoryEditorSession({
  inventory,
  initialFields,
  onClose,
  initialSection = "general",
}: InventoryEditorSessionProps) {
  const { t } = useTranslation();
  const formId = useId();
  const [section, setSection] = useState(initialSection);
  const [name, setName] = useState(inventory.name);
  const [description, setDescription] = useState(inventory.description ?? "");
  // Capture one snapshot per session; background refetches must not overwrite user edits.
  const [original, setOriginal] = useState(initialFields);
  const [revision, setRevision] = useState(inventory.configuration_revision);
  const [savedMetadata, setSavedMetadata] = useState({
    name: inventory.name,
    description: inventory.description,
  });
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);
  const [templateSourceConflict, setTemplateSourceConflict] = useState(false);
  const [fields, setFields] = useState(initialFields);
  const [pendingEditors, setPendingEditors] = useState<string[]>([]);
  const update = useInventoryEditor(inventory.id);
  const reload = useReloadInventoryConfiguration(inventory.id);
  const busy = update.isPending || reload.isPending;
  const conflict =
    templateSourceConflict ||
    (update.error instanceof ApiError &&
      ["inventory_configuration_conflict", "inventory_not_found"].includes(
        update.error.code ?? "",
      ));
  const validDraft = isValidFieldDraft(original, fields);
  const editorInput = buildInventoryEditorInput(
    original,
    fields,
    { name: name.trim(), description: description.trim() || null },
    revision,
  );
  const dirty =
    editorInput.inventory.name !== savedMetadata.name ||
    editorInput.inventory.description !== savedMetadata.description ||
    editorInput.fields.length > 0 ||
    editorInput.options.length > 0 ||
    editorInput.field_order !== undefined;
  const { setConfigurationInventoryId } = useContext(TableEditSessionContext);
  const configurationLocked = dirty || busy || pendingEditors.length > 0;
  useEffect(() => {
    setConfigurationInventoryId?.(configurationLocked ? inventory.id : null);
    return () => setConfigurationInventoryId?.(null);
  }, [configurationLocked, inventory.id, setConfigurationInventoryId]);
  const setPendingEditor = useCallback((id: string, active: boolean) => {
    setPendingEditors((current) =>
      active
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.includes(id)
          ? current.filter((entry) => entry !== id)
          : current,
    );
  }, []);
  const draft: InventoryDraftActions = {
    fields,
    disabled: busy,
    canReorder: !busy && pendingEditors.length === 0,
    moveField: (sourceId, targetId, side) => {
      if (!busy && pendingEditors.length === 0)
        setFields((current) =>
          moveDraftField(current, sourceId, targetId, side),
        );
    },
    setPendingEditor,
    addField: (data) => {
      const field = createDraftField(inventory.id, data);
      setFields((current) => [...current, field]);
    },
    updateField: (id, changes) =>
      setFields((current) =>
        current.map((field) =>
          field.id === id ? { ...field, ...changes } : field,
        ),
      ),
    removeField: (id) =>
      setFields((current) => current.filter((field) => field.id !== id)),
  };
  const inputClass =
    "mt-1.5 w-full rounded-md border border-shell bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

  // Discard this session on dismissal unless an atomic save is still pending.
  function close() {
    if (!busy) onClose();
  }

  /**
   * Persist all session changes without changing group membership.
   * @param event The form submission event.
   */
  function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      busy ||
      conflict ||
      pendingEditors.length ||
      !validDraft ||
      !name.trim()
    )
      return;
    update.mutate(
      buildInventoryEditorInput(
        original,
        fields,
        {
          name: name.trim(),
          description: description.trim() || null,
        },
        revision,
      ),
      { onSuccess: onClose },
    );
  }

  // Discard the draft only after an explicit refresh succeeds; failed reads leave all inputs intact.
  function reloadConfiguration() {
    if (busy || pendingEditors.length) return;
    reload.mutate(undefined, {
      onSuccess: (result) => {
        setOriginal(result.fields);
        setFields(result.fields);
        setName(result.inventory.name);
        setDescription(result.inventory.description ?? "");
        setRevision(result.inventory.configuration_revision);
        setSavedMetadata({
          name: result.inventory.name,
          description: result.inventory.description,
        });
        setTemplateSourceConflict(false);
        update.reset();
      },
    });
  }

  // Replace the visible editor while retaining its session; no unsaved draft is used as a source.
  if (templateOpen)
    return (
      <SaveInventoryTemplateDialog
        inventoryId={inventory.id}
        revision={revision}
        onClose={() => setTemplateOpen(false)}
        onSaved={() => {
          setTemplateOpen(false);
          setTemplateSaved(true);
        }}
        onConflict={() => setTemplateSourceConflict(true)}
      />
    );

  return (
    <InventoryDraftContext.Provider value={draft}>
      <Modal
        title={t("inventories.titles.edit")}
        onClose={close}
        contentClassName="flex min-h-0 flex-col"
      >
        <nav
          aria-label={t("navigation.inventorySections")}
          className="mb-5 flex shrink-0 gap-1 border-b border-shell"
        >
          {(["general", "fields"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              aria-current={section === entry ? "page" : undefined}
              disabled={busy || pendingEditors.length > 0}
              className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${section === entry ? "border-accent bg-accent-soft text-accent" : "border-transparent text-muted enabled:hover:bg-control-hover enabled:hover:border-accent/50 hover:text-foreground"}`}
              onClick={() => setSection(entry)}
            >
              {t(
                entry === "general"
                  ? "inventories.general"
                  : "inventories.actions.fields",
              )}
            </button>
          ))}
        </nav>
        {section === "fields" ? (
          <>
            <InventoryFieldsPanel />
            <form id={formId} onSubmit={save} />
          </>
        ) : (
          <form className="shrink-0 space-y-4" id={formId} onSubmit={save}>
            <label className="block text-sm font-medium">
              {t("common.fields.name")}
              <input
                autoFocus
                className={inputClass}
                maxLength={255}
                required
                disabled={busy}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              {t("common.fields.description")}
              <textarea
                className={`${inputClass} min-h-28 resize-y`}
                disabled={busy}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <div className="border-t border-shell pt-4">
              <button
                type="button"
                className="rounded-md border border-shell px-3 py-2 text-sm font-medium enabled:hover:bg-control-hover enabled:hover:border-accent/50 disabled:opacity-50"
                disabled={
                  busy || conflict || dirty || pendingEditors.length > 0
                }
                title={dirty ? t("templates.saveChangesFirst") : undefined}
                onClick={() => {
                  setTemplateSaved(false);
                  setTemplateOpen(true);
                }}
              >
                {t("templates.saveAs")}
              </button>
              {dirty && (
                <p className="mt-2 text-sm text-muted">
                  {t("templates.saveChangesFirst")}
                </p>
              )}
              {templateSaved && (
                <p role="status" className="mt-2 text-sm text-muted">
                  {t("templates.saved")}
                </p>
              )}
            </div>
          </form>
        )}
        {pendingEditors.length > 0 && (
          <p className="mt-3 shrink-0 text-sm text-muted" role="status">
            {t("inventories.editor.finishForm")}
          </p>
        )}
        {!validDraft && (
          <p className="mt-3 shrink-0 text-sm text-danger" role="alert">
            {t("inventories.editor.invalidDraft")}
          </p>
        )}
        {(update.error || templateSourceConflict) && (
          <p
            className="shrink-0 rounded-md bg-danger-soft p-3 text-sm text-danger"
            role="alert"
          >
            {conflict
              ? t("inventories.editor.conflict")
              : update.error instanceof ApiError
                ? update.error.message
                : t("inventories.errors.update")}
          </p>
        )}
        {conflict && (
          <button
            className="mt-3 shrink-0 self-start rounded-md border border-shell px-3 py-2 text-sm font-medium enabled:hover:bg-control-hover disabled:opacity-50"
            disabled={busy || pendingEditors.length > 0}
            type="button"
            onClick={reloadConfiguration}
          >
            {t("inventories.editor.discardAndReload")}
          </button>
        )}
        {reload.error && (
          <p className="mt-3 shrink-0 text-sm text-danger" role="alert">
            {t("inventories.editor.reloadFailed")}
          </p>
        )}
        <div className="mt-5 flex shrink-0 flex-wrap justify-end gap-2 border-t border-shell pt-4">
          <button
            className="rounded-md border border-shell px-3 py-2 text-sm font-medium enabled:hover:bg-control-hover enabled:hover:border-accent/50 disabled:opacity-50"
            disabled={busy}
            onClick={close}
            type="button"
          >
            {t("common.actions.cancel")}
          </button>
          <button
            className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-surface enabled:hover:bg-accent-hover disabled:opacity-50"
            disabled={
              busy ||
              conflict ||
              !name.trim() ||
              !validDraft ||
              pendingEditors.length > 0
            }
            form={formId}
            type="submit"
          >
            {t(
              update.isPending
                ? "common.actions.saving"
                : "common.actions.saveChanges",
            )}
          </button>
        </div>
      </Modal>
    </InventoryDraftContext.Provider>
  );
}
