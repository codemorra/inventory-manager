import { z } from "zod";
import { revisionSchema } from "../settings/validation.js";

// Keep bounds aligned with frontend appearance/inventoryColumns.ts. Width entries are manual bases only.
export const minimumColumnWidth = 48;
export const maximumColumnWidth = 32768;
export const viewPreferencesSchema = z.strictObject({
  version: z.literal(1),
  sort: z
    .strictObject({
      fieldId: z.string().min(1),
      direction: z.enum(["ascending", "descending"]),
    })
    .nullable(),
  hiddenFieldIds: z.array(z.string().min(1)),
  wrapText: z.boolean(),
  attachmentPreviews: z.boolean(),
  columnWidths: z.record(
    z.string().min(1),
    z.number().int().min(minimumColumnWidth).max(maximumColumnWidth),
  ),
});
export type ViewPreferences = z.output<typeof viewPreferencesSchema>;
export const viewUpdateSchema = z.strictObject({
  expected_revision: revisionSchema,
  preferences: viewPreferencesSchema,
});

/**
 * Normalize stored presentation against active fields, preserving the established Auto-width model.
 * @param input A stored presentation document or an empty initial state.
 * @param fields Active field identities, sorting capability and configured order.
 * @returns A complete, safe view; missing columnWidths entries remain the only definition of Auto.
 */
export function normalizeView(
  input: unknown,
  fields: { id: string; isSortable: boolean }[],
): ViewPreferences {
  const saved =
    input &&
    typeof input === "object" &&
    "version" in input &&
    input.version === 1
      ? (input as Partial<ViewPreferences>)
      : {};
  const ids = new Set(fields.map((field) => field.id));
  let hidden = Array.isArray(saved.hiddenFieldIds)
    ? [
        ...new Set(
          saved.hiddenFieldIds.filter(
            (id) => typeof id === "string" && ids.has(id),
          ),
        ),
      ]
    : [];
  if (fields.length && hidden.length === fields.length)
    hidden = hidden.filter((id) => id !== fields[0]!.id);
  const sort = saved.sort;
  const validSort =
    sort &&
    ["ascending", "descending"].includes(sort.direction) &&
    fields.some((field) => field.id === sort.fieldId && field.isSortable) &&
    !hidden.includes(sort.fieldId);
  return {
    version: 1,
    sort: validSort
      ? { fieldId: sort.fieldId, direction: sort.direction }
      : null,
    hiddenFieldIds: hidden,
    wrapText: typeof saved.wrapText === "boolean" ? saved.wrapText : true,
    attachmentPreviews: saved.attachmentPreviews === true,
    columnWidths:
      saved.columnWidths &&
      typeof saved.columnWidths === "object" &&
      !Array.isArray(saved.columnWidths)
        ? Object.fromEntries(
            Object.entries(saved.columnWidths).filter(
              ([id, width]) =>
                ids.has(id) &&
                typeof width === "number" &&
                Number.isInteger(width) &&
                width >= minimumColumnWidth &&
                width <= maximumColumnWidth,
            ),
          )
        : {},
  };
}
