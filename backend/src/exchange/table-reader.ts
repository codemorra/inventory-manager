import type { TableExportFormat } from "./table.js";

export type CsvDelimiter = "," | ";" | "\t";
export interface InventoryTable {
  headers: string[];
  rows: string[][];
}

// Bound file decoding and preview work before any column mapping or database publication.
export const maxTableBytes = 64 * 1024 * 1024;
export const maxTableColumns = 1_000;
const maxTableRows = 100_000;
const maxTableCells = 1_000_000;

type ParseErrorCode =
  | "table_too_large"
  | "invalid_table_encoding"
  | "empty_table"
  | "invalid_csv"
  | "invalid_markdown_table"
  | "inconsistent_table_columns";

/** Describe file structure failures separately from errors in mapped field values. */
export class TableParseError extends Error {
  constructor(readonly code: ParseErrorCode) {
    super(code);
    this.name = "TableParseError";
  }
}

/** Collect bounded rectangular records and separate the first record as the header. */
function tableRows() {
  const rows: string[][] = [];
  let cells = 0;
  return {
    add(row: string[]) {
      cells += row.length;
      if (
        row.length > maxTableColumns ||
        rows.length > maxTableRows ||
        cells > maxTableCells
      )
        throw new TableParseError("table_too_large");
      if (rows.length && row.length !== rows[0]!.length)
        throw new TableParseError("inconsistent_table_columns");
      rows.push(row);
    },
    finish(): InventoryTable {
      const [headers, ...items] = rows;
      if (!headers || headers.every((header) => !header.trim()))
        throw new TableParseError("empty_table");
      return { headers, rows: items };
    },
  };
}

/**
 * Read CSV records while retaining quoted newlines, empty cells and literal whitespace.
 * @param source Strictly decoded UTF-8 text.
 * @param delimiter The explicitly chosen file separator, independent of multiselect separators.
 * @returns A rectangular table, ignoring blank physical records but retaining quoted empty records.
 */
function readCsv(source: string, delimiter: CsvDelimiter): InventoryTable {
  const table = tableRows();
  let row: string[] = [];
  let cell = "";
  let state: "start" | "unquoted" | "quoted" | "closed" = "start";
  const endCell = () => {
    row.push(cell);
    if (row.length > maxTableColumns)
      throw new TableParseError("table_too_large");
    cell = "";
    state = "start";
  };
  for (let index = 0; index < source.length; index++) {
    const character = source[index]!;
    if (state === "quoted") {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index++;
        } else state = "closed";
      } else cell += character;
    } else if (character === delimiter) {
      endCell();
    } else if (character === "\r" || character === "\n") {
      if (row.length || cell || state !== "start") {
        endCell();
        table.add(row);
      }
      row = [];
      if (character === "\r" && source[index + 1] === "\n") index++;
    } else if (character === '"' && state === "start") {
      state = "quoted";
    } else if (character === '"' || state === "closed") {
      throw new TableParseError("invalid_csv");
    } else {
      cell += character;
      state = "unquoted";
    }
  }
  if (state === "quoted") throw new TableParseError("invalid_csv");
  if (row.length || cell || state !== "start") {
    endCell();
    table.add(row);
  }
  return table.finish();
}

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/**
 * Decode textual Markdown escapes, common entities and explicit line breaks once, without rendering.
 * @param source Trimmed table cell; encoded HTML stays literal text after decoding.
 * @returns Plain cell content, retaining other inline Markdown notation for explicit field mapping.
 */
function markdownText(source: string): string {
  return source.replace(
    /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])|<br\s*\/?>|&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/giu,
    (token: string, escaped: string | undefined) => {
      if (escaped !== undefined) return escaped;
      if (token.startsWith("<")) return "\n";
      const entity = token.slice(1, -1);
      if (!entity.startsWith("#")) return entities[entity.toLowerCase()]!;
      const code =
        entity[1]?.toLowerCase() === "x"
          ? Number.parseInt(entity.slice(2), 16)
          : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : "\ufffd";
    },
  );
}

/**
 * Split unescaped pipes without confusing escaped backslashes with escaped delimiters.
 * @param source One physical table line with optional outer pipes.
 * @returns Raw trimmed cells for later text decoding.
 */
function markdownRow(source: string): string[] {
  const cells: string[] = [];
  const line = source.trim();
  let cell = "";
  let pipes = 0;
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!;
    if (character === "\\" && index + 1 < line.length)
      cell += character + line[++index]!;
    else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
      pipes++;
      if (cells.length > maxTableColumns + 1)
        throw new TableParseError("table_too_large");
    } else cell += character;
  }
  if (!pipes) throw new TableParseError("invalid_markdown_table");
  cells.push(cell.trim());
  if (line.startsWith("|")) cells.shift();
  if (cells.at(-1) === "" && cell === "") cells.pop();
  return cells;
}

/**
 * Read one standalone pipe table, accepting surrounding blank lines and alignment markers.
 * @param source Strictly decoded UTF-8 text.
 * @returns Headers and rectangular data rows; additional prose or separated tables are rejected.
 */
function readMarkdown(source: string): InventoryTable {
  function* lines(): Generator<string> {
    let start = 0;
    for (const ending of source.matchAll(/\r\n|\r|\n/g)) {
      yield source.slice(start, ending.index);
      start = ending.index + ending[0].length;
    }
    yield source.slice(start);
  }
  const table = tableRows();
  let headers: string[] | undefined;
  let separator = false;
  let trailingBlank = false;
  for (const line of lines()) {
    if (!line.trim()) {
      if (headers) trailingBlank = true;
      continue;
    }
    if (trailingBlank) throw new TableParseError("invalid_markdown_table");
    const row = markdownRow(line);
    if (!headers) {
      headers = row;
      table.add(row.map(markdownText));
    } else if (!separator) {
      if (
        row.length !== headers.length ||
        !row.every((cell) => /^:?-{3,}:?$/.test(cell))
      )
        throw new TableParseError("invalid_markdown_table");
      separator = true;
    } else table.add(row.map(markdownText));
  }
  if (!headers || !separator)
    throw new TableParseError("invalid_markdown_table");
  return table.finish();
}

/**
 * Decode a bounded table file for preview, without assuming any inventory field types.
 * @param content Original UTF-8 file bytes, optionally starting with a BOM.
 * @param format CSV or one standalone Markdown pipe table.
 * @param delimiter Explicit CSV file separator, defaulting to comma.
 * @returns Raw cell strings for subsequent field mapping and validation.
 */
export function parseInventoryTable(
  content: Uint8Array,
  format: TableExportFormat,
  delimiter: CsvDelimiter = ",",
): InventoryTable {
  if (content.byteLength > maxTableBytes)
    throw new TableParseError("table_too_large");
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new TableParseError("invalid_table_encoding");
  }
  if (format === "markdown") return readMarkdown(source);
  if (format !== "csv" || ![",", ";", "\t"].includes(delimiter))
    throw new TableParseError("invalid_csv");
  return readCsv(source, delimiter);
}
