import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { InventoryField } from "../types/inventoryField";
import type { ItemFilter, ItemFilterOperator } from "../types/itemFilter";
import { ChoiceSelect } from "./ChoiceSelect";
import { containsChoiceTarget } from "./choiceSelectTargets";
import { DurationFieldInput } from "./DurationFieldInput";
import {
  filterDurationInput,
  itemFilterError,
  itemFilterOperators,
} from "./inventoryItemFilters";

// Keep applied conditions outside the panel so dismissal discards only its local draft.
interface InventoryItemFiltersProps {
  fields: InventoryField[];
  filters: ItemFilter[];
  onApply: (filters: ItemFilter[]) => void;
  disabled?: boolean;
}

/**
 * Render a scrollable condition builder anchored below the compact filter action.
 * @param props Current field definitions, applied conditions, and their update action.
 * @returns The icon button, active-count badge, and dismissible draft panel.
 */
export function InventoryItemFilters({
  fields,
  filters,
  onApply,
  disabled = false,
}: InventoryItemFiltersProps) {
  const { t } = useTranslation();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ItemFilter[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const expanded = open && !disabled;
  if (open && disabled) setOpen(false);

  useLayoutEffect(() => {
    if (!expanded || !panel.current || !trigger.current) return;
    const element = panel.current;
    const anchor = trigger.current.getBoundingClientRect();
    const width = element.getBoundingClientRect().width;
    const top = Math.max(
      8,
      Math.min(anchor.bottom + 4, window.innerHeight - 200),
    );
    element.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`;
    element.style.top = `${top}px`;
    element.style.maxHeight = `${Math.max(0, window.innerHeight - top - 8)}px`;
    element.querySelector<HTMLElement>('[role="combobox"], button')?.focus();
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    /** Dismiss without stealing focus from a clicked control outside the panel. */
    function dismissOutside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !containsChoiceTarget(panel.current, event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false);
    }
    /** Ignore internal scrolling so long condition and option lists remain usable. */
    function dismissOnMove(event: Event) {
      if (containsChoiceTarget(panel.current, event.target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", dismissOutside);
    window.addEventListener("resize", dismissOnMove);
    window.addEventListener("scroll", dismissOnMove, true);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      window.removeEventListener("resize", dismissOnMove);
      window.removeEventListener("scroll", dismissOnMove, true);
    };
  }, [expanded]);

  /** Close a deliberate panel action and return keyboard focus to its trigger. */
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  /**
   * Update a single draft row without changing any applied table conditions.
   * @param filterId The stable draft identifier.
   * @param changes The selected field, operator, or operands.
   */
  function update(filterId: string, changes: Partial<ItemFilter>) {
    setDraft((current) =>
      current.map((filter) =>
        filter.id === filterId ? { ...filter, ...changes } : filter,
      ),
    );
  }

  const buttonClass =
    "cursor-pointer rounded-sm border border-shell px-3 py-1.5 text-sm font-medium transition enabled:hover:bg-control-hover focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50";
  const inputClass =
    "mt-1.5 w-full min-w-0 rounded-md border border-shell bg-surface px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={t("table.filters.label")}
        title={t("table.filters.label")}
        aria-haspopup="dialog"
        aria-expanded={expanded}
        aria-controls={expanded ? `${id}-panel` : undefined}
        aria-describedby={filters.length ? `${id}-count` : undefined}
        disabled={disabled || !fields.length}
        className={`flex h-8 cursor-pointer items-center gap-1 rounded-sm px-2 transition enabled:hover:bg-control-hover focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${expanded || filters.length ? "bg-accent-soft text-accent-text" : "text-muted"}`}
        onClick={() => {
          if (expanded) close();
          else {
            setDraft(
              filters.map((filter) => ({
                ...filter,
                optionIds: [...filter.optionIds],
              })),
            );
            setSubmitted(false);
            setOpen(true);
          }
        }}
      >
        <svg
          aria-hidden="true"
          className="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 5h16l-6 7v6l-4 2v-8Z" />
        </svg>
        {filters.length > 0 && (
          <span
            id={`${id}-count`}
            aria-label={t("table.filters.activeCount", {
              count: filters.length,
            })}
            className="min-w-4 text-center text-xs font-semibold tabular-nums"
          >
            {filters.length}
          </span>
        )}
      </button>
      {expanded &&
        createPortal(
          <div
            ref={panel}
            id={`${id}-panel`}
            role="dialog"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-help`}
            className="fixed z-40 flex max-h-[calc(100dvh-1rem)] w-[52rem] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-md border border-shell bg-surface text-foreground shadow-raised"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                close();
              }
            }}
            onBlur={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                !containsChoiceTarget(
                  event.currentTarget,
                  event.relatedTarget,
                ) &&
                !trigger.current?.contains(event.relatedTarget)
              )
                setOpen(false);
            }}
          >
            <header className="shrink-0 border-b border-shell px-4 py-3">
              <h2 id={`${id}-title`} className="font-semibold text-heading">
                {t("table.filters.label")}
              </h2>
              <p id={`${id}-help`} className="mt-1 text-xs text-muted">
                {t("table.filters.help")}
              </p>
            </header>
            <form
              noValidate
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                setSubmitted(true);
                if (draft.some((filter) => itemFilterError(filter, fields)))
                  return;
                onApply(draft);
                close();
              }}
            >
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4">
                {draft.length === 0 && (
                  <p className="text-sm text-muted">
                    {t("table.filters.empty")}
                  </p>
                )}
                {draft.map((filter, index) => {
                  const field = fields.find(
                    (field) => field.id === filter.fieldId,
                  );
                  const error = submitted
                    ? itemFilterError(filter, fields)
                    : null;
                  const rowId = `${id}-${filter.id}`;
                  const noValue = [
                    "isEmpty",
                    "isNotEmpty",
                    "isTrue",
                    "isFalse",
                  ].includes(filter.operator);
                  const choices =
                    filter.operator === "anyOf" || filter.operator === "noneOf";
                  const operatorLabel = (operator: ItemFilterOperator) =>
                    t(
                      `table.filters.operators.${operator === "equals" && field && ["date", "time", "datetime"].includes(field.field_type) ? field.field_type : operator}`,
                    );
                  /** Render a typed operand, retaining incomplete values in the draft. */
                  const renderValue = (upper: boolean) => {
                    const key = upper ? "valueTo" : "value";
                    const valueId = `${rowId}-${key}`;
                    const label = t(
                      upper ? "table.filters.valueTo" : "table.filters.value",
                    );
                    if (field?.field_type === "duration")
                      return (
                        <DurationFieldInput
                          key={`${filter.fieldId}-${key}`}
                          id={valueId}
                          label={label}
                          value={filterDurationInput(filter[key])}
                          required
                          disabled={false}
                          onChange={(value) =>
                            update(filter.id, {
                              [key]: [
                                value.hours,
                                value.minutes,
                                value.seconds,
                              ].join(":"),
                            })
                          }
                        />
                      );
                    const type =
                      field?.field_type === "date"
                        ? "date"
                        : field?.field_type === "time"
                          ? "time"
                          : field?.field_type === "datetime"
                            ? "datetime-local"
                            : field?.field_type === "number" ||
                                field?.field_type === "id"
                              ? "number"
                              : "text";
                    return (
                      <label
                        key={`${filter.fieldId}-${key}`}
                        className="block min-w-0 text-xs font-medium"
                        htmlFor={valueId}
                      >
                        {label}
                        <input
                          id={valueId}
                          type={type}
                          step={field?.field_type === "id" ? 1 : "any"}
                          min={field?.field_type === "id" ? 1 : undefined}
                          className={inputClass}
                          value={filter[key]}
                          required
                          aria-invalid={error ? true : undefined}
                          aria-describedby={
                            error ? `${rowId}-error` : undefined
                          }
                          onChange={(event) =>
                            update(filter.id, { [key]: event.target.value })
                          }
                        />
                      </label>
                    );
                  };
                  return (
                    <fieldset
                      key={filter.id}
                      className="min-w-0 rounded-sm border border-shell bg-surface-muted p-3"
                    >
                      <legend className="px-1 text-xs font-medium text-muted">
                        {t("table.filters.condition", { number: index + 1 })}
                      </legend>
                      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5">
                        {/* Keep field, condition, and operands together; reserve most space for values. */}
                        <div className="grid min-w-0 gap-2.5 sm:grid-cols-2 md:grid-cols-[fit-content(10rem)_fit-content(12rem)_minmax(0,1fr)]">
                          <ChoiceSelect
                            portal
                            compact
                            id={`${rowId}-field`}
                            label={t("table.filters.field")}
                            options={fields
                              .map((field) => ({
                                value: field.id,
                                label: field.name,
                              }))
                              .concat(
                                field
                                  ? []
                                  : [
                                      {
                                        value: filter.fieldId,
                                        label: t(
                                          "table.filters.unavailableField",
                                        ),
                                      },
                                    ],
                              )}
                            value={filter.fieldId}
                            onChange={(fieldId) => {
                              const next = fields.find(
                                (entry) => entry.id === fieldId,
                              );
                              if (next)
                                update(filter.id, {
                                  fieldId,
                                  fieldType: next.field_type,
                                  operator: itemFilterOperators(
                                    next.field_type,
                                  )[0],
                                  value: "",
                                  valueTo: "",
                                  optionIds: [],
                                });
                            }}
                          />
                          <ChoiceSelect
                            portal
                            compact
                            id={`${rowId}-operator`}
                            label={t("table.filters.operator")}
                            disabled={!field}
                            options={
                              field
                                ? itemFilterOperators(field.field_type).map(
                                    (operator) => ({
                                      value: operator,
                                      label: operatorLabel(operator),
                                    }),
                                  )
                                : []
                            }
                            value={filter.operator}
                            onChange={(operator) =>
                              update(filter.id, {
                                operator: operator as ItemFilterOperator,
                              })
                            }
                          />
                          {!noValue && choices && field && (
                            <div className="sm:col-span-2 md:col-span-1">
                              <ChoiceSelect
                                portal
                                compact
                                id={`${rowId}-options`}
                                label={t("table.filters.options")}
                                multiple
                                required
                                emptyLabel={t("table.filters.chooseOptions")}
                                describedBy={
                                  error ? `${rowId}-error` : undefined
                                }
                                options={field.options.map((option) => ({
                                  value: option.id,
                                  label: option.name,
                                }))}
                                value={filter.optionIds}
                                onChange={(optionIds) =>
                                  update(filter.id, { optionIds })
                                }
                              />
                            </div>
                          )}
                          {!noValue && !choices && (
                            <div
                              className={`grid gap-2.5 sm:col-span-2 md:col-span-1 ${filter.operator === "between" ? "sm:grid-cols-2" : ""}`}
                            >
                              {renderValue(false)}
                              {filter.operator === "between" &&
                                renderValue(true)}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className={`${buttonClass} mt-5`}
                          aria-label={t("table.filters.remove", {
                            number: index + 1,
                          })}
                          title={t("table.filters.remove", {
                            number: index + 1,
                          })}
                          onClick={() => {
                            setDraft((current) =>
                              current.filter((entry) => entry.id !== filter.id),
                            );
                            addButton.current?.focus();
                          }}
                        >
                          ×
                        </button>
                      </div>
                      {error && (
                        <p
                          id={`${rowId}-error`}
                          role="alert"
                          className="mt-2 text-xs text-danger"
                        >
                          {t(`table.filters.errors.${error}`)}
                        </p>
                      )}
                    </fieldset>
                  );
                })}
                <button
                  ref={addButton}
                  type="button"
                  disabled={!fields.length}
                  className={buttonClass}
                  onClick={() => {
                    const field = fields[0];
                    if (!field) return;
                    setDraft((current) => [
                      ...current,
                      {
                        id: crypto.randomUUID(),
                        fieldId: field.id,
                        fieldType: field.field_type,
                        operator: itemFilterOperators(field.field_type)[0],
                        value: "",
                        valueTo: "",
                        optionIds: [],
                      },
                    ]);
                  }}
                >
                  {t("table.filters.add")}
                </button>
              </div>
              <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-shell p-3">
                <button
                  type="button"
                  className={`${buttonClass} mr-auto`}
                  disabled={!draft.length && !filters.length}
                  onClick={() => {
                    onApply([]);
                    close();
                  }}
                >
                  {t("table.filters.reset")}
                </button>
                <button type="button" className={buttonClass} onClick={close}>
                  {t("common.actions.cancel")}
                </button>
                <button
                  type="submit"
                  className={`${buttonClass} border-accent bg-accent text-surface enabled:hover:bg-accent-hover`}
                >
                  {t("table.filters.apply")}
                </button>
              </footer>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}
