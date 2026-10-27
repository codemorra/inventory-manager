import { ApiError } from "../services/api";

/** Select translated archive errors without showing decoder internals or untranslated backend messages. */
export function archiveErrorKey(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  const keys: Record<string, string> = {
    inventory_export_conflict: "archives.sourceChanged",
    inventory_export_unavailable: "archives.exportUnavailable",
    inventory_not_found: "archives.sourceMissing",
    inventory_attachment_not_found: "archives.exportUnavailable",
    inventory_export_not_found: "archives.exportExpired",
    inventory_import_not_found: "archives.importExpired",
    invalid_inventory_archive: "archives.invalidArchive",
    unsupported_inventory_archive_version: "archives.unsupportedVersion",
    inventory_group_not_found: "archives.groupMissing",
  };
  return (
    keys[error.code ?? ""] ??
    (error.status === 422 ? "archives.invalidMetadata" : fallback)
  );
}

/** Format binary archive sizes consistently with the interface language. */
export function archiveSize(bytes: number, locale: string) {
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  const index =
    bytes > 0
      ? Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
      : 0;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: index ? 1 : 0 }).format(bytes / 1024 ** index)} ${units[index]}`;
}
