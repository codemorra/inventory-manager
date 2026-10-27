import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAttachmentDraft } from "./useAttachmentDraft";
import { getInventoryConfiguration } from "../services/inventoryEditor";
import {
  getInventoryItems,
  updateInventoryItems,
} from "../services/inventoryItems";
import { ApiError } from "../services/api";
import type { InventoryField } from "../types/inventoryField";
import type { InventoryItem } from "../types/inventoryItem";
import type { InventoryItemFormValue } from "../components/inventoryItemForm";
import {
  createTableReplacement,
  unchangedTableCell,
  type TableCellChanges,
} from "../components/inventoryTableDraft";
import {
  captureTablePresentation,
  presentInventoryItems,
  type InventoryTablePresentation,
} from "../components/inventoryTablePresentation";

// An edit session owns its baseline independently of refreshed query data.
interface TableDraft {
  fields: InventoryField[];
  items: InventoryItem[];
  configurationRevision: number;
  changes: TableCellChanges;
  presentation: InventoryTablePresentation;
  displayedItems: InventoryItem[];
}

/**
 * Manage a local table draft and explicitly save all changed rows in one request.
 * @param inventoryId The inventory being edited.
 * @returns Snapshot, validation state, loading/saving state, and explicit draft actions.
 */
export function useInventoryTableEdit(inventoryId: string) {
  const client = useQueryClient();
  const attachments = useAttachmentDraft();
  const [draft, setDraft] = useState<TableDraft | null>(null);
  const submitting = useRef(false);
  const load = useMutation({
    retry: false,
    mutationFn: async (requestedPresentation: InventoryTablePresentation) => {
      // Capture fields with their configuration revision before loading row versions.
      const configuration = await getInventoryConfiguration(inventoryId);
      const items = await getInventoryItems(inventoryId);
      const presentation = captureTablePresentation(
        requestedPresentation,
        configuration.fields,
      );
      return {
        fields: configuration.fields,
        configurationRevision: configuration.inventory.configuration_revision,
        items,
        changes: {},
        presentation,
        displayedItems: presentInventoryItems(
          items,
          configuration.fields,
          presentation,
        ),
      } satisfies TableDraft;
    },
  });
  const save = useMutation({
    retry: false,
    mutationFn: (input: Parameters<typeof updateInventoryItems>[1]) =>
      updateInventoryItems(inventoryId, input),
    onSuccess: (saved) => {
      attachments.controller.finish(saved);
      // Merge only committed rows, leaving unrelated cached updates intact.
      client.setQueryData<InventoryItem[]>(
        ["inventories", inventoryId, "items"],
        (current) => {
          const rows = current ?? draft?.items ?? [];
          return rows.map((item) => {
            const updated = saved.find((row) => row.id === item.id);
            return updated && updated.revision >= item.revision
              ? updated
              : item;
          });
        },
      );
      setDraft(null);
      void client.invalidateQueries({
        queryKey: ["inventories", inventoryId, "items"],
      });
    },
    onSettled: () => {
      submitting.current = false;
    },
  });
  const replacement = draft
    ? createTableReplacement(
        draft.fields,
        draft.items,
        draft.changes,
        draft.configurationRevision,
      )
    : null;
  const conflict =
    save.error instanceof ApiError &&
    [
      "inventory_item_conflict",
      "inventory_configuration_conflict",
      "inventory_item_not_found",
      "inventory_not_found",
    ].includes(save.error.code ?? "");

  /**
   * Capture a fresh baseline only after an explicit start or discard/reload.
   * @param presentation The view and matching rules selected when the session starts.
   */
  function begin(presentation: InventoryTablePresentation) {
    if (load.isPending || save.isPending || submitting.current) return;
    load.reset();
    load.mutate(structuredClone(presentation), {
      onSuccess: (snapshot) => {
        attachments.controller.begin(
          snapshot.items.flatMap((item) => item.attachments ?? []),
        );
        client.setQueryData(
          ["inventories", inventoryId, "fields"],
          snapshot.fields,
        );
        client.setQueryData(
          ["inventories", inventoryId, "items"],
          snapshot.items,
        );
        setDraft(snapshot);
        save.reset();
      },
    });
  }

  /**
   * Temporarily reveal an invalid hidden column without overwriting external saved preferences.
   * @param fieldId The column whose required value needs correction in this draft.
   */
  function showField(fieldId: string) {
    setDraft((current) =>
      current
        ? {
            ...current,
            presentation: {
              ...current.presentation,
              view: {
                ...current.presentation.view,
                hiddenFieldIds: current.presentation.view.hiddenFieldIds.filter(
                  (id) => id !== fieldId,
                ),
              },
            },
          }
        : current,
    );
  }

  /**
   * Update one draft cell without converting or rewriting neighboring values.
   * @param itemId The row being edited.
   * @param fieldId The edited column.
   * @param value The typed form value.
   */
  function change(
    itemId: string,
    fieldId: string,
    value: InventoryItemFormValue,
  ) {
    if (save.isPending || load.isPending || submitting.current || conflict)
      return;
    setDraft((current) => {
      const item = current?.items.find((item) => item.id === itemId);
      const field = current?.fields.find((field) => field.id === fieldId);
      if (!current || !item || !field || field.field_type === "id")
        return current;
      const row = { ...current.changes[itemId] };
      if (
        unchangedTableCell(
          field,
          item.values.find((entry) => entry.field_id === fieldId)?.value,
          value,
        )
      )
        delete row[fieldId];
      else row[fieldId] = value;
      return { ...current, changes: { ...current.changes, [itemId]: row } };
    });
  }

  /** Save the entire valid change set once; empty/no-op drafts need no HTTP write. */
  function commit() {
    if (
      !replacement ||
      attachments.controller.getSnapshot().busy ||
      save.isPending ||
      submitting.current ||
      load.isPending ||
      conflict ||
      replacement.errors.length
    )
      return;
    if (!replacement.input.items.length) {
      attachments.controller.discard();
      setDraft(null);
      return;
    }
    submitting.current = true;
    save.mutate(replacement.input);
  }

  /** Discard without applying any cell changes or replacing the query cache. */
  function cancel() {
    if (save.isPending || load.isPending || submitting.current) return;
    attachments.controller.discard();
    setDraft(null);
    save.reset();
    load.reset();
  }

  return {
    draft,
    attachments: attachments.controller,
    uploading: attachments.busy,
    begin,
    change,
    commit,
    cancel,
    showField,
    conflict,
    error: load.error ?? save.error,
    loading: load.isPending,
    saving: save.isPending,
    active: draft !== null || load.isPending,
    dirty: (replacement?.input.items.length ?? 0) > 0 || attachments.busy,
    changedCount: replacement?.input.items.length ?? 0,
    errors: replacement?.errors ?? [],
  };
}
