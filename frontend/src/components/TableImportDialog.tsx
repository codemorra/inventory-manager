import { type SyntheticEvent, useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useInventoryGroups } from "../hooks/useInventoryGroups";
import { ApiError } from "../services/api";
import {
  confirmTableImport,
  discardTableImport,
  prepareTableImport,
  readTableImport,
  readTableImportRows,
  validateTableImport,
} from "../services/tableImports";
import type {
  CsvDelimiter,
  InventoryImportFormat,
  TableColumnMapping,
  TableImportFormat,
  TableImportInput,
  TableImportPreview as Preview,
  TableImportRows,
  TableImportValidation,
  TableValidationIssue,
} from "../types/tableImport";
import { ChoiceSelect } from "./ChoiceSelect";
import { Modal } from "./Modal";
import { ImportFileInput } from "./ImportFileInput";
import { ImportSourceSelect } from "./ImportSourceSelect";
import { TableImportPreview } from "./TableImportPreview";
import {
  mappedTableColumns,
  tableImportErrorKey,
  tableImportColumnWidth,
  tableImportPageSize,
  tableIssueId,
  validTableColumns,
  type TableColumnDraft,
} from "./tableImportDraft";

interface Props {
  open: boolean;
  format: TableImportFormat;
  onClose: (retain?: boolean) => void;
  onFormatChange: (format: InventoryImportFormat) => void;
}

/** Interpret foreign tables explicitly while retaining uncertain confirmation receipts across dismissal. */
export function TableImportDialog({
  open,
  format,
  onClose,
  onFormatChange,
}: Props) {
  const { t } = useTranslation();
  const id = useId();
  const client = useQueryClient();
  const navigate = useNavigate();
  const groups = useInventoryGroups();
  const [delimiter, setDelimiter] = useState<CsvDelimiter>(",");
  const [filename, setFilename] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [page, setPage] = useState<TableImportRows | null>(null);
  const [columns, setColumns] = useState<TableColumnDraft[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [groupId, setGroupId] = useState("");
  const [checking, setChecking] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<
    (TableImportValidation & { signature: string }) | null
  >(null);
  const [validationRetry, setValidationRetry] = useState(0);
  const [validationError, setValidationError] = useState("");
  const [pageError, setPageError] = useState("");
  const [error, setError] = useState("");
  const [expired, setExpired] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [issueIndex, setIssueIndex] = useState(-1);
  const mounted = useRef(true);
  const generation = useRef(0);
  const validationVersion = useRef(0);
  const uploadController = useRef<AbortController | null>(null);
  const pageController = useRef<AbortController | null>(null);
  const validationController = useRef<AbortController | null>(null);
  const current = useRef<Preview | null>(null);
  const file = useRef<File | null>(null);
  const pageOffset = useRef(0);
  const focusTarget = useRef<TableValidationIssue | null>(null);
  const submitting = useRef(false);
  const resolving = useRef(false);
  const attempt = useRef<{ id: string; data: TableImportInput } | null>(null);
  const locked = confirming || recovering || uncertain;
  const settingsValid = validTableColumns(columns);
  const signature = preview
    ? JSON.stringify({ id: preview.id, columns: mappedTableColumns(columns) })
    : "";
  const checked = validation?.signature === signature ? validation : null;
  const issues = checked?.issues ?? [];

  useEffect(() => {
    const counter = generation;
    mounted.current = true;
    return () => {
      mounted.current = false;
      counter.current++;
      uploadController.current?.abort();
      pageController.current?.abort();
      validationController.current?.abort();
      if (current.current && !attempt.current)
        void discardTableImport(current.current.id).catch(() => {});
      current.current = null;
    };
  }, []);

  useEffect(() => {
    if (!signature || !settingsValid || locked || expired) return;
    const payload = JSON.parse(signature) as {
      id: string;
      columns: TableColumnMapping[];
    };
    const counter = validationVersion;
    const version = ++counter.current;
    const abort = new AbortController();
    validationController.current = abort;
    const timer = window.setTimeout(async () => {
      setValidating(true);
      setValidationError("");
      try {
        const result = await validateTableImport(
          payload.id,
          payload.columns,
          abort.signal,
        );
        if (
          !mounted.current ||
          version !== counter.current ||
          abort.signal.aborted
        )
          return;
        setValidation({ ...result, signature });
        setIssueIndex(-1);
      } catch (failure) {
        if (
          !mounted.current ||
          version !== counter.current ||
          abort.signal.aborted
        )
          return;
        if (
          failure instanceof ApiError &&
          failure.code === "inventory_import_not_found"
        )
          markExpired("tableImports.expired");
        else
          setValidationError(
            tableImportErrorKey(failure, "tableImports.validationFailed"),
          );
      } finally {
        if (
          mounted.current &&
          version === counter.current &&
          !abort.signal.aborted
        )
          setValidating(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      counter.current++;
      abort.abort();
    };
    // The serialized source token and mapping capture exactly the interpretation being checked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, settingsValid, locked, expired, validationRetry]);

  useEffect(() => {
    if (focusTarget.current && page) focusIssue(focusTarget.current);
    // Focus follows a fetched source page; the queued target is cleared once its cell is present.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  function invalidateValidation(valid: boolean) {
    validationVersion.current++;
    validationController.current?.abort();
    setValidation(null);
    setValidationError("");
    setValidating(valid);
    setIssueIndex(-1);
    focusTarget.current = null;
  }
  function clearStage() {
    generation.current++;
    uploadController.current?.abort();
    pageController.current?.abort();
    invalidateValidation(false);
    if (current.current && !attempt.current)
      void discardTableImport(current.current.id).catch(() => {});
    current.current = null;
    file.current = null;
    setPreview(null);
    setPage(null);
    setColumns([]);
    setFilename("");
    setChecking(false);
    setPageLoading(false);
    setPageError("");
    setError("");
    setExpired(false);
  }
  function close() {
    if (submitting.current || resolving.current) return;
    const retain = !!attempt.current;
    if (!retain) clearStage();
    onClose(retain);
  }
  function markExpired(message: string) {
    generation.current++;
    uploadController.current?.abort();
    pageController.current?.abort();
    invalidateValidation(false);
    current.current = null;
    attempt.current = null;
    setExpired(true);
    setUncertain(false);
    setChecking(false);
    setPageLoading(false);
    setError(message);
    void client.invalidateQueries({ queryKey: ["inventories"], exact: true });
  }
  function focusIssue(issue: TableValidationIssue) {
    const element = document.getElementById(tableIssueId(id, issue));
    if (!element) return;
    element.focus();
    element.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    focusTarget.current = null;
  }
  async function loadPage(token: string, offset: number, initialize = false) {
    const version = generation.current;
    const abort = new AbortController();
    pageController.current?.abort();
    pageController.current = abort;
    pageOffset.current = offset;
    setPageLoading(true);
    setPageError("");
    try {
      const result = await readTableImportRows(
        token,
        offset,
        tableImportPageSize,
        abort.signal,
      );
      if (
        !mounted.current ||
        version !== generation.current ||
        abort.signal.aborted ||
        current.current?.id !== token
      )
        return;
      setPage(result);
      if (initialize) {
        const drafts: TableColumnDraft[] = result.headers.map(
          (header, column) => ({
            column,
            name:
              header.trim() ||
              t("tableImports.defaultColumnName", { column: column + 1 }),
            field_type: "text",
            separator: ";",
          }),
        );
        setColumns(drafts);
        invalidateValidation(validTableColumns(drafts));
      }
    } catch (failure) {
      if (
        !mounted.current ||
        version !== generation.current ||
        abort.signal.aborted
      )
        return;
      if (
        failure instanceof ApiError &&
        failure.code === "inventory_import_not_found"
      )
        markExpired("tableImports.expired");
      else
        setPageError(tableImportErrorKey(failure, "tableImports.pageFailed"));
    } finally {
      if (
        mounted.current &&
        version === generation.current &&
        !abort.signal.aborted
      )
        setPageLoading(false);
    }
  }
  async function selectFile(
    selected: File,
    separator = delimiter,
    keepMetadata = false,
  ) {
    if (submitting.current || resolving.current || attempt.current) return;
    clearStage();
    const version = generation.current;
    const abort = new AbortController();
    uploadController.current = abort;
    file.current = selected;
    setFilename(selected.name);
    setChecking(true);
    if (!keepMetadata) {
      setName(selected.name.replace(/\.[^.]+$/, ""));
      setDescription("");
      setGroupId("");
    }
    try {
      const result = await prepareTableImport(
        selected,
        format,
        separator,
        abort.signal,
      );
      if (
        !mounted.current ||
        version !== generation.current ||
        abort.signal.aborted
      ) {
        void discardTableImport(result.id).catch(() => {});
        return;
      }
      current.current = result;
      setPreview(result);
      await loadPage(result.id, 0, true);
    } catch (failure) {
      if (
        mounted.current &&
        version === generation.current &&
        !abort.signal.aborted
      )
        setError(tableImportErrorKey(failure, "tableImports.checkFailed"));
    } finally {
      if (mounted.current && version === generation.current) setChecking(false);
    }
  }
  function changeColumn(column: number, change: Partial<TableColumnDraft>) {
    const updated = columns.map((entry) =>
      entry.column === column ? { ...entry, ...change } : entry,
    );
    setColumns(updated);
    // Whitespace-only name edits can leave the submitted interpretation unchanged.
    if (
      JSON.stringify(mappedTableColumns(updated)) !==
      JSON.stringify(mappedTableColumns(columns))
    )
      invalidateValidation(validTableColumns(updated));
  }
  function nextIssue() {
    if (!issues.length || pageLoading) return;
    const next = (issueIndex + 1) % issues.length;
    const issue = issues[next]!;
    setIssueIndex(next);
    focusTarget.current = issue;
    if (
      issue.row !== undefined &&
      page &&
      (issue.row < page.offset || issue.row >= page.offset + page.rows.length)
    ) {
      if (current.current)
        void loadPage(
          current.current.id,
          Math.floor(issue.row / tableImportPageSize) * tableImportPageSize,
        );
    } else focusIssue(issue);
  }
  async function finish(inventoryId: string) {
    const token = attempt.current?.id ?? current.current?.id;
    attempt.current = null;
    current.current = null;
    if (token) void discardTableImport(token).catch(() => {});
    void client.invalidateQueries({ queryKey: ["inventories"], exact: true });
    if (!mounted.current) return;
    clearStage();
    setUncertain(false);
    navigate(`/inventories/${inventoryId}/items`);
    onClose();
  }
  const canImport =
    !!preview &&
    !!page &&
    !!checked?.valid &&
    settingsValid &&
    !checking &&
    !pageLoading &&
    !validating &&
    !locked &&
    !expired &&
    !!name.trim() &&
    Array.from(name.trim()).length <= 255;
  async function confirm(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !canImport ||
      !current.current ||
      attempt.current ||
      submitting.current ||
      resolving.current
    )
      return;
    if (Date.parse(current.current.expires_at) <= Date.now()) {
      void discardTableImport(current.current.id).catch(() => {});
      markExpired("tableImports.expired");
      return;
    }
    const captured = {
      id: current.current.id,
      data: {
        name: name.trim(),
        description: description.trim() || null,
        group_id: groupId || null,
        columns: mappedTableColumns(columns),
      },
    };
    attempt.current = captured;
    submitting.current = true;
    setConfirming(true);
    setError("");
    try {
      const result = await confirmTableImport(captured.id, captured.data);
      await finish(result.id);
    } catch (failure) {
      if (!mounted.current) return;
      if (
        failure instanceof ApiError &&
        (failure.status === 422 || failure.code === "inventory_group_not_found")
      ) {
        attempt.current = null;
        setError(tableImportErrorKey(failure, "tableImports.importFailed"));
        if (failure.code === "invalid_inventory_table_values") {
          invalidateValidation(true);
          setValidationRetry((value) => value + 1);
        }
      } else if (
        failure instanceof ApiError &&
        failure.code === "inventory_import_not_found"
      )
        markExpired("tableImports.resultUnavailable");
      else {
        setUncertain(true);
        setError("tableImports.uncertain");
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setConfirming(false);
    }
  }
  async function recover() {
    if (!attempt.current || resolving.current || submitting.current) return;
    resolving.current = true;
    setRecovering(true);
    try {
      const status = await readTableImport(attempt.current.id);
      if (!mounted.current) return;
      if (status.status === "completed" && status.inventory_id)
        await finish(status.inventory_id);
      else if (status.status === "importing")
        setError("archives.stillImporting");
      else if (status.status === "ready") {
        attempt.current = null;
        current.current = status;
        setPreview(status);
        setUncertain(false);
        setError("archives.retryImport");
      } else setError("archives.statusFailed");
    } catch (failure) {
      if (!mounted.current) return;
      if (
        failure instanceof ApiError &&
        failure.code === "inventory_import_not_found"
      )
        markExpired("tableImports.resultUnavailable");
      else setError("archives.statusFailed");
    } finally {
      resolving.current = false;
      if (mounted.current) setRecovering(false);
    }
  }
  if (!open) return null;
  const inputClass =
    "mt-1.5 w-full rounded-md border border-shell bg-surface px-3 py-2.5 text-foreground outline-none focus:border-accent disabled:opacity-50";
  const buttonClass =
    "rounded-md border border-shell px-3 py-2 text-sm font-medium enabled:hover:bg-control-hover disabled:opacity-50";
  const controlsDisabled = locked || expired;
  return (
    <Modal
      title={t("archives.import")}
      onClose={close}
      closeDisabled={confirming || recovering}
      size="medium"
      dialogClassName={
        preview
          ? "[--import-dialog-margin:16px] sm:[--import-dialog-margin:48px]"
          : undefined
      }
      dialogStyle={{
        overflow: "hidden",
        ...(preview
          ? {
              // Include the inventory sidebar, row numbers, spacing and dialog padding.
              width: 416 + preview.column_count * tableImportColumnWidth,
              maxWidth: "calc(100vw - 2 * var(--import-dialog-margin))",
              maxHeight: "calc(100dvh - 2 * var(--import-dialog-margin))",
            }
          : {}),
      }}
      contentClassName="flex min-h-0 flex-col overflow-hidden"
    >
      <form
        onSubmit={(event) => void confirm(event)}
        className="flex min-h-0 flex-col"
      >
        <div
          className={`min-h-0 overflow-y-auto scrollbar-gutter-stable ${preview ? "" : "max-h-[70dvh]"}`}
        >
          <div className="space-y-4 pr-4">
            {!preview && (
              <>
                <ImportSourceSelect
                  format={format}
                  disabled={locked}
                  onChange={(value) => {
                    if (value === format) return;
                    clearStage();
                    onFormatChange(value);
                  }}
                />
                <p className="max-w-xl text-sm text-muted">
                  {t("tableImports.help")}
                </p>
                <div className="grid max-w-xl items-start gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <ImportFileInput
                    label={t(
                      format === "csv"
                        ? "tableImports.csvFile"
                        : "tableImports.markdownFile",
                    )}
                    accept={
                      format === "csv"
                        ? ".csv,text/csv"
                        : ".md,.markdown,text/markdown,text/plain"
                    }
                    disabled={locked}
                    onSelect={(file) => void selectFile(file)}
                  />
                  {format === "csv" && (
                    <ChoiceSelect
                      id={`${id}-delimiter`}
                      portal
                      fitContent
                      label={t("tableImports.fileSeparator")}
                      options={[
                        { value: ",", label: t("tableImports.comma") },
                        { value: ";", label: t("tableImports.semicolon") },
                        { value: "\t", label: t("tableImports.tab") },
                      ]}
                      value={delimiter}
                      disabled={locked}
                      onChange={(value) => {
                        if (value === delimiter) return;
                        const selected = file.current;
                        setDelimiter(value as CsvDelimiter);
                        if (selected)
                          void selectFile(
                            selected,
                            value as CsvDelimiter,
                            true,
                          );
                      }}
                    />
                  )}
                </div>
                {filename && (
                  <p className="wrap-break-word text-sm text-muted">
                    {filename}
                  </p>
                )}
              </>
            )}
            {checking && (
              <p role="status" className="text-sm text-muted">
                {t("tableImports.checking")}
              </p>
            )}
            {preview && (
              <>
                <div className="flex items-center justify-between gap-4 border-b border-shell pb-4">
                  <div className="min-w-0">
                    <p className="wrap-break-word text-sm font-medium text-heading">
                      {filename}
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      {t("tableImports.summary", {
                        columns: preview.column_count,
                        rows: preview.row_count,
                      })}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`${buttonClass} shrink-0`}
                    disabled={locked}
                    onClick={clearStage}
                  >
                    {t("tableImports.changeFile")}
                  </button>
                </div>
                <div className="grid min-w-0 gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
                  <section
                    aria-labelledby={`${id}-details`}
                    className="min-w-0 space-y-4 border-b border-shell pb-5 lg:border-r lg:border-b-0 lg:pr-5 lg:pb-0"
                  >
                    <h3
                      id={`${id}-details`}
                      className="text-sm font-semibold text-heading"
                    >
                      {t("tableImports.inventoryDetails")}
                    </h3>
                    <div className="space-y-4">
                      <div className="space-y-4">
                        <label className="block min-w-0 text-sm font-medium">
                          {t("common.fields.name")}
                          <input
                            value={name}
                            maxLength={255}
                            required
                            disabled={controlsDisabled}
                            className={inputClass}
                            onChange={(event) => setName(event.target.value)}
                          />
                        </label>
                        <div className="min-w-0">
                          <ChoiceSelect
                            id={`${id}-group`}
                            portal
                            fitContent
                            label={t("templates.destinationGroup")}
                            options={[
                              { value: "", label: t("templates.ungrouped") },
                              ...(groups.data ?? []).map((group) => ({
                                value: group.id,
                                label: group.name,
                              })),
                            ]}
                            value={groupId}
                            disabled={controlsDisabled || groups.isPending}
                            onChange={setGroupId}
                          />
                        </div>
                      </div>
                      <label className="block text-sm font-medium">
                        {t("common.fields.description")}
                        <textarea
                          rows={4}
                          value={description}
                          disabled={controlsDisabled}
                          className={`${inputClass} min-h-32 resize-y`}
                          onChange={(event) =>
                            setDescription(event.target.value)
                          }
                        />
                      </label>
                    </div>
                    {groups.isError && (
                      <p role="alert" className="text-sm text-danger">
                        {t("templates.groupsFailed")}{" "}
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={locked}
                          onClick={() => void groups.refetch()}
                        >
                          {t("common.actions.retry")}
                        </button>
                      </p>
                    )}
                  </section>
                  <section
                    aria-labelledby={`${id}-mapping`}
                    className="min-w-0 space-y-3"
                  >
                    <h3
                      id={`${id}-mapping`}
                      className="text-sm font-semibold text-heading"
                    >
                      {t("tableImports.mappingTitle")}
                    </h3>
                    <div className="space-y-2 text-sm text-muted">
                      <p>{t("tableImports.mappingHelp")}</p>
                      <details className="max-w-xl">
                        <summary className="w-fit cursor-pointer rounded-sm outline-none hover:text-heading focus-visible:outline-2 focus-visible:outline-accent">
                          {t("tableImports.formatHelp")}
                        </summary>
                        <div className="mt-2 space-y-2">
                          <p>{t("tableImports.defaultTypeHelp")}</p>
                          <ul className="list-disc space-y-1 pl-5">
                            {[
                              "numberFormatHelp",
                              "booleanFormatHelp",
                              "durationFormatHelp",
                              "dateFormatHelp",
                              "timeFormatHelp",
                              "dateTimeFormatHelp",
                            ].map((key) => (
                              <li key={key}>{t(`tableImports.${key}`)}</li>
                            ))}
                          </ul>
                          <p>{t("tableImports.sourceEditHelp")}</p>
                        </div>
                      </details>
                    </div>
                    {columns.length > 0 && !settingsValid && (
                      <p role="alert" className="text-sm text-danger">
                        {t("tableImports.invalidSettings")}
                      </p>
                    )}
                    {validating && (
                      <p role="status" className="text-sm text-muted">
                        {t("tableImports.validating")}
                      </p>
                    )}
                    {validationError && (
                      <p role="alert" className="text-sm text-danger">
                        {t(validationError)}{" "}
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={controlsDisabled}
                          onClick={() => {
                            invalidateValidation(settingsValid);
                            setValidationRetry((value) => value + 1);
                          }}
                        >
                          {t("common.actions.retry")}
                        </button>
                      </p>
                    )}
                    {issues.length > 0 && (
                      <div
                        role="alert"
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-danger-soft p-3 text-sm text-danger"
                      >
                        <p>
                          {t("tableImports.invalidValues")}{" "}
                          {t("tableImports.issueCount", {
                            count: issues.length,
                          })}
                        </p>
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={controlsDisabled || pageLoading}
                          onClick={nextIssue}
                        >
                          {t("tableImports.nextIssue")}
                        </button>
                      </div>
                    )}
                    {checked?.valid && !validating && (
                      <p role="status" className="text-sm text-success">
                        {t("tableImports.valid")}
                      </p>
                    )}
                    {pageError && (
                      <p role="alert" className="text-sm text-danger">
                        {t(pageError)}{" "}
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={controlsDisabled || pageLoading}
                          onClick={() => {
                            if (current.current)
                              void loadPage(
                                current.current.id,
                                pageOffset.current,
                                !page,
                              );
                          }}
                        >
                          {t("common.actions.retry")}
                        </button>
                      </p>
                    )}
                    {page && (
                      <>
                        <div aria-busy={pageLoading} className="min-w-0">
                          <TableImportPreview
                            id={id}
                            page={page}
                            columns={columns}
                            issues={issues}
                            disabled={controlsDisabled}
                            onChange={changeColumn}
                          />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <p>
                            {t("tableImports.page", {
                              start: page.total_rows ? page.offset + 1 : 0,
                              end: page.offset + page.rows.length,
                              total: page.total_rows,
                            })}
                          </p>
                          {page.total_rows > page.limit && (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className={buttonClass}
                                disabled={
                                  controlsDisabled ||
                                  pageLoading ||
                                  page.offset === 0
                                }
                                onClick={() => {
                                  if (current.current)
                                    void loadPage(
                                      current.current.id,
                                      Math.max(
                                        0,
                                        page.offset - tableImportPageSize,
                                      ),
                                    );
                                }}
                              >
                                {t("tableImports.previous")}
                              </button>
                              <button
                                type="button"
                                className={buttonClass}
                                disabled={
                                  controlsDisabled ||
                                  pageLoading ||
                                  page.offset + tableImportPageSize >=
                                    page.total_rows
                                }
                                onClick={() => {
                                  if (current.current)
                                    void loadPage(
                                      current.current.id,
                                      page.offset + tableImportPageSize,
                                    );
                                }}
                              >
                                {t("tableImports.next")}
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </section>
                </div>
              </>
            )}
            {error && (
              <p
                role="alert"
                className="rounded-md bg-danger-soft p-3 text-sm text-danger"
              >
                {t(error)}
              </p>
            )}
          </div>
        </div>
        <div className="mt-5 flex shrink-0 flex-wrap justify-end gap-2 border-t border-shell pt-4">
          <button
            type="button"
            className={buttonClass}
            disabled={confirming || recovering}
            onClick={close}
          >
            {t(uncertain ? "archives.close" : "common.actions.cancel")}
          </button>
          {uncertain ? (
            <button
              type="button"
              className={buttonClass}
              disabled={recovering}
              onClick={() => void recover()}
            >
              {t(
                recovering ? "archives.checkingStatus" : "archives.checkStatus",
              )}
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canImport}
              className="rounded-md bg-accent px-3 py-2 text-sm font-semibold text-surface disabled:opacity-50"
            >
              {t(confirming ? "archives.importing" : "archives.importAction")}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
