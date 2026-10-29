import { type SyntheticEvent, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useCreateInventory } from "../hooks/useInventories";
import { useInventoryGroups } from "../hooks/useInventoryGroups";
import {
  useInventoryTemplates,
  useInstantiateInventoryTemplate,
} from "../hooks/useInventoryTemplates";
import type { InventoryTemplate } from "../types/inventoryTemplate";
import type { Inventory } from "../types/inventory";
import { ChoiceSelect } from "./ChoiceSelect";
import { ApiError } from "../services/api";
import { Modal } from "./Modal";

/**
 * Keep creation inputs and selected template revisions isolated until the dialog closes.
 * @param props Dismissal and navigation callbacks.
 * @returns The empty-inventory or template-based creation form.
 */
export function InventoryCreateForm(props: {
  onClose: () => void;
  onCreated: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const id = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  // Retain the selected object; background list refreshes must never adopt a new revision.
  const [template, setTemplate] = useState<InventoryTemplate | null>(null);
  const [excludedFields, setExcludedFields] = useState<number[]>([]);
  const [groupId, setGroupId] = useState("");
  const templates = useInventoryTemplates();
  const groups = useInventoryGroups();
  const createInventory = useCreateInventory();
  const instantiate = useInstantiateInventoryTemplate();
  const submitting = useRef(false);
  const busy = createInventory.isPending || instantiate.isPending;
  const error = template ? instantiate.error : createInventory.error;
  const conflict =
    error instanceof ApiError &&
    ["inventory_template_conflict", "inventory_template_not_found"].includes(
      error.code ?? "",
    );
  const [reloading, setReloading] = useState(false);
  const choices = templates.data ?? [];
  const templateOptions = [
    { value: "", label: t("templates.emptyInventory") },
    ...choices.map((entry) => ({
      value: entry.id,
      label: entry.id === template?.id ? template.name : entry.name,
    })),
    ...(template && !choices.some((entry) => entry.id === template.id)
      ? [{ value: template.id, label: template.name }]
      : []),
  ];

  // Cancel and Escape cannot dismiss a pending creation request.
  function closeModal() {
    if (!submitting.current) props.onClose();
  }

  /**
   * Refresh a stale selection only after the user explicitly requests its latest revision.
   * Missing templates remain selected and blocked until another choice is made.
   */
  async function reloadTemplate() {
    if (submitting.current || reloading) return;
    setReloading(true);
    try {
      const result = await templates.refetch();
      if (!result.isError) {
        const latest = result.data?.find((entry) => entry.id === template?.id);
        if (latest) {
          setTemplate(latest);
          // A reloaded revision can reorder fields; begin its selection with all fields again.
          setExcludedFields([]);
          instantiate.reset();
        }
      }
    } finally {
      setReloading(false);
    }
  }

  /**
   * Create an inventory from the chosen baseline and navigate only after persistence succeeds.
   * @param event The form submission event.
   */
  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || reloading || conflict || !name.trim()) return;
    submitting.current = true;
    const data = {
      name: name.trim(),
      description: description.trim() || null,
      ...(groupId ? { group_id: groupId } : {}),
    };
    const onSuccess = (inventory: Inventory) => {
      navigate(`/inventories/${inventory.id}/items`);
      props.onClose();
      props.onCreated?.();
    };
    const onSettled = () => {
      submitting.current = false;
    };
    if (template)
      instantiate.mutate(
        {
          id: template.id,
          data: {
            ...data,
            expected_revision: template.revision,
            ...(excludedFields.length
              ? {
                  field_indexes: template.fields.flatMap((_, index) =>
                    excludedFields.includes(index) ? [] : [index],
                  ),
                }
              : {}),
          },
        },
        { onSuccess: (result) => onSuccess(result.inventory), onSettled },
      );
    else createInventory.mutate(data, { onSuccess, onSettled });
  }

  return (
    <Modal
      onClose={closeModal}
      title={t("inventories.titles.create")}
      size="medium"
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <ChoiceSelect
          id={`${id}-template`}
          portal
          label={t("templates.template")}
          options={templateOptions}
          value={template?.id ?? ""}
          disabled={busy || reloading}
          onChange={(value) => {
            // A removed selection must never silently become an empty-inventory request.
            if (value === template?.id) return;
            const selected = choices.find((entry) => entry.id === value);
            if (value && !selected) return;
            setTemplate(selected ?? null);
            setExcludedFields([]);
            instantiate.reset();
            createInventory.reset();
          }}
        />
        {templates.isPending && (
          <p role="status" className="text-sm text-muted">
            {t("templates.loading")}
          </p>
        )}
        {templates.isError && (
          <div role="alert" className="text-sm text-danger">
            {t("templates.loadFailed")}{" "}
            <button
              type="button"
              onClick={() => void templates.refetch()}
              disabled={templates.isFetching || busy}
              className="underline disabled:opacity-50"
            >
              {t("common.actions.retry")}
            </button>
          </div>
        )}
        {template && (
          <div className="space-y-1 text-sm text-muted">
            {template.description && (
              <p className="whitespace-pre-wrap wrap-break-word">
                {template.description}
              </p>
            )}
            <p id={`${id}-fields`}>
              {t("templates.fieldCount", { count: template.fields.length })}:
            </p>
            <ul
              aria-labelledby={`${id}-fields`}
              className="flex flex-wrap gap-2"
            >
              {template.fields.map((field, index) => (
                <li key={index} className="max-w-full">
                  <button
                    type="button"
                    aria-pressed={!excludedFields.includes(index)}
                    disabled={busy || reloading}
                    className={`flex max-w-full cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-left transition focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${excludedFields.includes(index) ? "border-danger/40 bg-danger-soft text-danger enabled:hover:bg-danger/15" : "border-success/40 bg-success-soft text-success enabled:hover:bg-success/15"}`}
                    onClick={() =>
                      setExcludedFields((current) =>
                        current.includes(index)
                          ? current.filter((entry) => entry !== index)
                          : [...current, index],
                      )
                    }
                  >
                    <span className="min-w-0 wrap-anywhere">
                      <span className="font-medium">{field.name}</span>{" "}
                      <span className="text-xs opacity-80">
                        ({t(`fields.types.${field.field_type}`)})
                      </span>
                    </span>
                    <svg
                      aria-hidden="true"
                      className={`size-4 shrink-0 ${excludedFields.includes(index) ? "text-danger" : "text-success"}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d={
                          excludedFields.includes(index)
                            ? "m6 6 12 12M6 18 18 6"
                            : "m5 12 4 4L19 6"
                        }
                      />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <label
            className="block text-sm font-medium text-foreground"
            htmlFor={`${id}-name`}
          >
            {t("common.fields.name")}
          </label>
          <input
            autoFocus
            className="mt-1.5 w-full rounded-lg border border-shell bg-surface px-3 py-2.5 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            id={`${id}-name`}
            maxLength={255}
            onChange={(event) => setName(event.target.value)}
            required
            disabled={busy}
            value={name}
          />
        </div>

        <div>
          <label
            className="block text-sm font-medium text-foreground"
            htmlFor={`${id}-description`}
          >
            {t("common.fields.description")}
          </label>
          <textarea
            className="mt-1.5 min-h-28 w-full resize-y rounded-lg border border-shell bg-surface px-3 py-2.5 text-foreground outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
            id={`${id}-description`}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
            value={description}
          />
        </div>

        <ChoiceSelect
          id={`${id}-group`}
          portal
          label={t("templates.destinationGroup")}
          options={[
            { value: "", label: t("templates.ungrouped") },
            ...(groups.data ?? []).map((group) => ({
              value: group.id,
              label: group.name,
            })),
          ]}
          value={groupId}
          onChange={setGroupId}
          disabled={busy || groups.isPending}
        />
        {groups.isError && (
          <div role="alert" className="text-sm text-danger">
            {t("templates.groupsFailed")}{" "}
            <button
              type="button"
              onClick={() => void groups.refetch()}
              disabled={groups.isFetching || busy}
              className="underline disabled:opacity-50"
            >
              {t("common.actions.retry")}
            </button>
          </div>
        )}
        {error && (
          <p
            className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
            role="alert"
          >
            {conflict
              ? t("templates.selectionConflict")
              : error instanceof ApiError
                ? error.message
                : t("inventories.errors.create")}
          </p>
        )}

        {conflict && (
          <button
            type="button"
            className="rounded-md border border-shell px-3 py-2 text-sm font-medium enabled:hover:bg-control-hover disabled:opacity-50"
            disabled={busy || reloading}
            onClick={() => void reloadTemplate()}
          >
            {t("templates.reloadSelection")}
          </button>
        )}
        <div className="flex flex-wrap justify-end gap-3 pt-1">
          <button
            className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-surface transition enabled:hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || reloading || conflict || !name.trim()}
            type="submit"
          >
            {busy
              ? t("inventories.actions.creating")
              : t("inventories.actions.create")}
          </button>
          <button
            className="rounded-lg border border-shell px-4 py-2.5 text-sm font-semibold transition enabled:hover:bg-control-hover enabled:hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={closeModal}
            type="button"
          >
            {t("common.actions.cancel")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
