import {
  useCallback,
  useId,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  useInventoryTemplate,
  useUpdateInventoryTemplate,
} from "../hooks/useInventoryTemplates";
import { getInventoryTemplate } from "../services/inventoryTemplates";
import { ApiError } from "../services/api";
import type { InventoryTemplate } from "../types/inventoryTemplate";
import {
  InventoryDraftContext,
  type InventoryDraftActions,
} from "./InventoryDraftContext";
import {
  createDraftField,
  isValidFieldDraft,
  moveDraftField,
} from "./inventoryEditorDraft";
import {
  createTemplateDraft,
  serializeTemplateDraft,
} from "./inventoryTemplateDraft";
import { InventoryFieldsPanel } from "./InventoryFieldsPanel";
import { Modal } from "./Modal";

/**
 * Fetch a complete template before opening its isolated local editor session.
 * @param props The selected template identity and dismissal callback.
 * @returns The loading state or complete structure editor.
 */
export function InventoryTemplateEditDialog(props: {
  id: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const query = useInventoryTemplate(props.id);
  if (!query.data)
    return (
      <Modal title={t("templates.editTitle")} onClose={props.onClose}>
        <p
          role={query.isError ? "alert" : "status"}
          className={
            query.isError ? "text-sm text-danger" : "text-sm text-muted"
          }
        >
          {t(query.isError ? "templates.detailFailed" : "templates.loading")}
        </p>
        {query.isError && (
          <button
            type="button"
            className="mt-4 rounded-md border border-shell px-3 py-2 hover:bg-control-hover"
            onClick={() => void query.refetch()}
          >
            {t("common.actions.retry")}
          </button>
        )}
      </Modal>
    );
  return (
    <TemplateEditorSession
      key={props.id}
      initial={query.data}
      onClose={props.onClose}
    />
  );
}

/**
 * Edit metadata and fields together, retaining the original revision through background updates.
 * @param props The saved snapshot and dismissal callback.
 * @returns A draft-backed editor with atomic save, cancel, and explicit conflict reload.
 */
function TemplateEditorSession({
  initial,
  onClose,
}: {
  initial: InventoryTemplate;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const formId = useId();
  const [baseline, setBaseline] = useState(() => ({
    template: initial,
    fields: createTemplateDraft(initial),
  }));
  const [fields, setFields] = useState(baseline.fields);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description ?? "");
  const [section, setSection] = useState<"general" | "fields">("general");
  const [pendingEditors, setPendingEditors] = useState<string[]>([]);
  const submitting = useRef(false);
  const update = useUpdateInventoryTemplate(initial.id);
  const reload = useMutation({
    mutationFn: () => getInventoryTemplate(initial.id),
    retry: false,
  });
  const busy = update.isPending || reload.isPending;
  const conflict =
    update.error instanceof ApiError &&
    ["inventory_template_conflict", "inventory_template_not_found"].includes(
      update.error.code ?? "",
    );
  const valid = isValidFieldDraft(baseline.fields, fields);
  const setPendingEditor = useCallback((id: string, active: boolean) => {
    setPendingEditors((current) =>
      active
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((entry) => entry !== id),
    );
  }, []);
  const draft: InventoryDraftActions = {
    fields,
    disabled: busy,
    canReorder: !busy && !pendingEditors.length,
    setPendingEditor,
    addField: (data) =>
      setFields((current) => [...current, createDraftField(initial.id, data)]),
    updateField: (id, changes) =>
      setFields((current) =>
        current.map((field) =>
          field.id === id ? { ...field, ...changes } : field,
        ),
      ),
    removeField: (id) =>
      setFields((current) => current.filter((field) => field.id !== id)),
    moveField: (source, target, side) => {
      if (!busy && !pendingEditors.length)
        setFields((current) => moveDraftField(current, source, target, side));
    },
  };
  const inputClass =
    "mt-1.5 w-full rounded-md border border-shell bg-surface px-3 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-50";

  // Modal dismissal discards local changes, but a pending write/reload keeps the session mounted.
  function close() {
    if (!submitting.current) onClose();
  }

  /**
   * Save the whole structure with its original revision, omitting every local draft identifier.
   * @param event The parent form submission event.
   */
  function save(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      submitting.current ||
      conflict ||
      pendingEditors.length ||
      !valid ||
      !name.trim()
    )
      return;
    submitting.current = true;
    update.mutate(
      {
        expected_revision: baseline.template.revision,
        name: name.trim(),
        description: description.trim() || null,
        fields: serializeTemplateDraft(fields),
      },
      {
        onSuccess: onClose,
        onSettled: () => {
          submitting.current = false;
        },
      },
    );
  }

  // Only an explicit successful reload replaces the draft; failed reads preserve every input.
  function reloadDraft() {
    if (submitting.current || pendingEditors.length) return;
    submitting.current = true;
    reload.mutate(undefined, {
      onSuccess: (template) => {
        const next = createTemplateDraft(template);
        setBaseline({ template, fields: next });
        setFields(next);
        setName(template.name);
        setDescription(template.description ?? "");
        update.reset();
      },
      onSettled: () => {
        submitting.current = false;
      },
    });
  }

  return (
    <InventoryDraftContext.Provider value={draft}>
      <Modal
        title={t("templates.editTitle")}
        onClose={close}
        contentClassName="flex min-h-0 flex-col"
      >
        <nav
          aria-label={t("templates.sections")}
          className="mb-5 flex shrink-0 gap-1 border-b border-shell"
        >
          {(["general", "fields"] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              aria-current={section === entry ? "page" : undefined}
              disabled={busy || pendingEditors.length > 0}
              onClick={() => setSection(entry)}
              className={`border-b-2 px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${section === entry ? "border-accent bg-accent-soft text-accent-text" : "border-transparent text-muted enabled:hover:bg-control-hover"}`}
            >
              {t(
                entry === "general"
                  ? "inventories.general"
                  : "templates.fields",
              )}
            </button>
          ))}
        </nav>
        {section === "fields" ? (
          <>
            <InventoryFieldsPanel title={t("templates.fields")} />
            <form id={formId} onSubmit={save} />
          </>
        ) : (
          <form id={formId} onSubmit={save} className="shrink-0 space-y-4">
            <label className="block text-sm font-medium">
              {t("common.fields.name")}
              <input
                autoFocus
                required
                maxLength={255}
                disabled={busy}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm font-medium">
              {t("common.fields.description")}
              <textarea
                value={description}
                disabled={busy}
                onChange={(event) => setDescription(event.target.value)}
                className={`${inputClass} min-h-24 resize-y`}
              />
            </label>
          </form>
        )}
        {pendingEditors.length > 0 && (
          <p role="status" className="mt-3 text-sm text-muted">
            {t("inventories.editor.finishForm")}
          </p>
        )}
        {!valid && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {t("inventories.editor.invalidDraft")}
          </p>
        )}
        {update.error && (
          <p
            role="alert"
            className="mt-3 rounded-md bg-danger-soft p-3 text-sm text-danger"
          >
            {t(conflict ? "templates.editConflict" : "templates.updateFailed")}
          </p>
        )}
        {conflict && (
          <button
            type="button"
            disabled={busy || pendingEditors.length > 0}
            onClick={reloadDraft}
            className="mt-3 self-start rounded-md border border-shell px-3 py-2 text-sm enabled:hover:bg-control-hover disabled:opacity-50"
          >
            {t("inventories.editor.discardAndReload")}
          </button>
        )}
        {reload.error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {t("templates.detailFailed")}
          </p>
        )}
        <div className="mt-5 flex shrink-0 flex-wrap justify-end gap-2 border-t border-shell pt-4">
          <button
            type="button"
            onClick={close}
            disabled={busy}
            className="rounded-md border border-shell px-3 py-2 text-sm font-medium enabled:hover:bg-control-hover disabled:opacity-50"
          >
            {t("common.actions.cancel")}
          </button>
          <button
            type="submit"
            form={formId}
            disabled={
              busy ||
              conflict ||
              !name.trim() ||
              !valid ||
              pendingEditors.length > 0
            }
            className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-surface enabled:hover:bg-accent-hover disabled:opacity-50"
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
