import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type {
  TableImportRows,
  TableValidationIssue,
} from "../types/tableImport";
import { ChoiceSelect } from "./ChoiceSelect";
import {
  tableFieldTypes,
  tableImportColumnWidth,
  tableIssueId,
  type TableColumnDraft,
} from "./tableImportDraft";

interface Props {
  id: string;
  page: TableImportRows;
  columns: TableColumnDraft[];
  issues: TableValidationIssue[];
  disabled: boolean;
  onChange: (column: number, change: Partial<TableColumnDraft>) => void;
}

/** Show source cells with editable field mappings and focusable, described validation failures. */
export function TableImportPreview({
  id,
  page,
  columns,
  issues,
  disabled,
  onChange,
}: Props) {
  const { t } = useTranslation();
  const visibleIssues = useMemo(
    () =>
      new Map(
        issues
          .filter(
            (issue) =>
              issue.row === undefined ||
              (issue.row >= page.offset &&
                issue.row < page.offset + page.rows.length),
          )
          .map((issue) => [`${issue.row ?? "column"}:${issue.column}`, issue]),
      ),
    [issues, page],
  );
  function explanation(issue: TableValidationIssue) {
    return issue.code === "invalid_value"
      ? t("tableImports.invalidValue", {
          type: t(`fields.types.${columns[issue.column]!.field_type}`),
        })
      : t(`tableImports.issues.${issue.code}`);
  }
  return (
    <div className="min-w-0">
      <div className="w-fit max-w-full overflow-hidden rounded-md border border-shell">
        <div
          className={`overflow-auto ${page.total_rows > page.limit ? "h-[45dvh]" : "max-h-[45dvh]"}`}
          aria-label={t("tableImports.preview")}
          tabIndex={0}
        >
          <table
            className="table-fixed border-collapse text-left text-sm"
            style={{ width: 64 + columns.length * tableImportColumnWidth }}
          >
            <caption className="sr-only">{t("tableImports.preview")}</caption>
            <colgroup>
              <col style={{ width: 64 }} />
              {columns.map((column) => (
                <col
                  key={column.column}
                  style={{ width: tableImportColumnWidth }}
                />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-surface-muted align-top">
              <tr>
                <th
                  scope="col"
                  className="border border-shell p-2 align-bottom"
                >
                  {t("tableImports.row")}
                </th>
                {columns.map((column) => {
                  const issue = visibleIssues.get(`column:${column.column}`);
                  const active = column.field_type !== "skip";
                  const validName =
                    !!column.name.trim() &&
                    Array.from(column.name.trim()).length <= 255;
                  return (
                    <th
                      scope="col"
                      key={column.column}
                      className={`border p-2 font-normal wrap-anywhere ${issue ? "border-danger" : "border-shell"} ${active ? "" : "bg-surface-muted text-muted"}`}
                    >
                      <p
                        className="mb-2 max-w-64 truncate text-xs font-medium text-muted"
                        title={page.headers[column.column]}
                      >
                        {t("tableImports.sourceColumn", {
                          column: column.column + 1,
                          name: page.headers[column.column],
                        })}
                      </p>
                      <label
                        className="block text-xs font-medium"
                        htmlFor={`${id}-name-${column.column}`}
                      >
                        {t("tableImports.fieldNameLabel")}
                      </label>
                      <input
                        id={`${id}-name-${column.column}`}
                        aria-label={t("tableImports.fieldName", {
                          column: column.column + 1,
                        })}
                        value={column.name}
                        maxLength={255}
                        disabled={disabled || !active}
                        aria-invalid={(active && !validName) || undefined}
                        className={`mt-1 mb-2 w-full rounded-md border bg-surface px-2 py-1.5 text-foreground outline-none focus:border-accent disabled:opacity-50 ${active && !validName ? "border-danger" : "border-shell"}`}
                        onChange={(event) =>
                          onChange(column.column, { name: event.target.value })
                        }
                      />
                      {active && !validName && (
                        <p className="mb-2 text-xs text-danger">
                          {t("tableImports.invalidName")}
                        </p>
                      )}
                      <ChoiceSelect
                        id={`${id}-type-${column.column}`}
                        compact
                        portal
                        fitContent
                        label={t("tableImports.fieldTypeLabel")}
                        accessibleLabel={t("tableImports.fieldType", {
                          column: column.column + 1,
                        })}
                        options={[
                          { value: "skip", label: t("tableImports.skip") },
                          ...tableFieldTypes.map((type) => ({
                            value: type,
                            label: t(`fields.types.${type}`),
                          })),
                        ]}
                        value={column.field_type}
                        disabled={disabled}
                        onChange={(value) =>
                          onChange(column.column, {
                            field_type: value as TableColumnDraft["field_type"],
                          })
                        }
                      />
                      {column.field_type === "multiselect" && (
                        <label className="mt-2 block text-xs font-medium">
                          {t("tableImports.separatorLabel")}
                          <input
                            aria-label={t("tableImports.cellSeparator", {
                              column: column.column + 1,
                            })}
                            value={column.separator}
                            disabled={disabled}
                            maxLength={16}
                            aria-invalid={!column.separator || undefined}
                            className={`mt-1 w-full rounded-md border bg-surface px-2 py-1.5 text-foreground outline-none focus:border-accent ${column.separator ? "border-shell" : "border-danger"}`}
                            onChange={(event) =>
                              onChange(column.column, {
                                separator: event.target.value,
                              })
                            }
                          />
                        </label>
                      )}
                      {issue && (
                        <p className="mt-2 text-xs text-danger">
                          {explanation(issue)}
                        </p>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {page.rows.map((cells, index) => (
                <tr key={page.offset + index}>
                  <th
                    scope="row"
                    className="border border-shell bg-surface-muted p-2 align-top font-normal text-muted"
                  >
                    {page.offset + index + 1}
                  </th>
                  {cells.map((value, column) => {
                    const row = page.offset + index;
                    const issue = visibleIssues.get(`${row}:${column}`);
                    const target = tableIssueId(id, { row, column });
                    return (
                      <td
                        key={column}
                        id={target}
                        tabIndex={issue ? 0 : undefined}
                        aria-invalid={!!issue || undefined}
                        aria-label={t("tableImports.cell", {
                          row: row + 1,
                          column: column + 1,
                        })}
                        aria-describedby={issue ? `${target}-error` : undefined}
                        title={issue ? explanation(issue) : undefined}
                        className={`border p-2 align-top whitespace-pre-wrap wrap-anywhere -outline-offset-2 focus:outline-2 focus:outline-danger ${issue ? "border-danger bg-danger-soft ring-1 ring-danger ring-inset" : "border-shell"} ${columns[column]?.field_type === "skip" ? "text-muted" : ""}`}
                      >
                        {value}
                        {issue && (
                          <span
                            id={`${target}-error`}
                            className="mt-1 block text-xs text-danger"
                          >
                            {explanation(issue)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
