import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { openDatabase } from "../db/connection.js";
import { readExportSnapshot } from "../exchange/snapshot.js";
import { invalidBackup } from "./manifest.js";
import * as schema from "../db/schema.js";
import { nameSchema } from "../validation/common.js";
import { templateCreateSchema } from "../templates/validation.js";
import { viewPreferencesSchema } from "../views/validation.js";

/**
 * Validate a restore snapshot against the installed schema and active inventory references.
 * @param path The private, fully extracted database file.
 * @returns Counts used to describe the checked restore before confirmation.
 * @throws {DomainError} When the schema, migrations or saved references are incompatible.
 * @throws {Error} When SQLite cannot read the snapshot.
 */
export function inspectRestoreDatabase(path: string) {
  const expected = openDatabase(":memory:");
  let candidate: Database.Database | undefined;
  try {
    candidate = new Database(path, { readonly: true, fileMustExist: true });
    candidate.pragma("trusted_schema = OFF");
    const schemaSql =
      "SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name";
    const migrationSql =
      "SELECT hash, created_at FROM __drizzle_migrations ORDER BY id";
    if (
      JSON.stringify(candidate.prepare(schemaSql).all()) !==
        JSON.stringify(expected.sqlite.prepare(schemaSql).all()) ||
      JSON.stringify(candidate.prepare(migrationSql).all()) !==
        JSON.stringify(expected.sqlite.prepare(migrationSql).all())
    )
      throw invalidBackup(
        "The backup database schema is incompatible with this application.",
      );
    if (
      candidate.pragma("integrity_check", { simple: true }) !== "ok" ||
      (candidate.pragma("foreign_key_check") as unknown[]).length
    )
      throw invalidBackup("The restore database failed its integrity checks.");
    const database = drizzle(candidate, { schema });
    const inventories = candidate
      .prepare("SELECT id FROM inventories WHERE deleted_at IS NULL")
      .all() as { id: string }[];
    const claimedFiles = new Set<string>();
    try {
      for (const inventory of inventories)
        for (const file of readExportSnapshot(database, inventory.id).sources)
          claimedFiles.add(file.id);
      for (const group of candidate
        .prepare("SELECT name FROM inventory_groups WHERE deleted_at IS NULL")
        .all() as { name: string }[])
        nameSchema.parse(group.name);
      for (const template of candidate
        .prepare(
          "SELECT name, description, fields FROM inventory_templates WHERE deleted_at IS NULL",
        )
        .all() as {
        name: string;
        description: string | null;
        fields: string;
      }[])
        templateCreateSchema.parse({
          name: template.name,
          description: template.description,
          fields: JSON.parse(template.fields) as unknown,
        });
      for (const view of candidate
        .prepare("SELECT preferences FROM inventory_views")
        .all() as { preferences: string }[])
        viewPreferencesSchema.parse(JSON.parse(view.preferences));
    } catch {
      throw invalidBackup(
        "The backup contains invalid saved values, templates or views.",
      );
    }
    const invalidRevision = candidate
      .prepare(
        `SELECT 1 FROM inventories WHERE deleted_at IS NULL AND (typeof(configuration_revision) != 'integer' OR configuration_revision < 1 OR configuration_revision > 9007199254740991)
      UNION ALL SELECT 1 FROM inventory_items WHERE deleted_at IS NULL AND (typeof(revision) != 'integer' OR revision < 1 OR revision > 9007199254740991)
      UNION ALL SELECT 1 FROM inventory_templates WHERE deleted_at IS NULL AND (typeof(revision) != 'integer' OR revision < 1 OR revision > 9007199254740991)
      UNION ALL SELECT 1 FROM inventory_views WHERE typeof(revision) != 'integer' OR revision < 1 OR revision > 9007199254740991 LIMIT 1`,
      )
      .get();
    const inactiveParent = candidate
      .prepare(
        `SELECT 1 FROM inventory_fields f JOIN inventories i ON i.id = f.inventory_id WHERE f.deleted_at IS NULL AND i.deleted_at IS NOT NULL
      UNION ALL SELECT 1 FROM inventory_items t JOIN inventories i ON i.id = t.inventory_id WHERE t.deleted_at IS NULL AND i.deleted_at IS NOT NULL
      UNION ALL SELECT 1 FROM inventory_field_options o JOIN inventory_fields f ON f.id = o.field_id WHERE o.deleted_at IS NULL AND f.deleted_at IS NOT NULL
      UNION ALL SELECT 1 FROM inventory_item_values v JOIN inventory_items t ON t.id = v.item_id JOIN inventory_fields f ON f.id = v.field_id WHERE v.deleted_at IS NULL AND (t.deleted_at IS NOT NULL OR f.deleted_at IS NOT NULL OR t.inventory_id != f.inventory_id)
      UNION ALL SELECT 1 FROM inventories i JOIN inventory_groups g ON g.id = i.group_id WHERE i.deleted_at IS NULL AND g.deleted_at IS NOT NULL LIMIT 1`,
      )
      .get();
    const claimedCount = (
      candidate
        .prepare(
          "SELECT count(*) AS count FROM inventory_attachments WHERE deleted_at IS NULL AND item_id IS NOT NULL",
        )
        .get() as { count: number }
    ).count;
    if (invalidRevision || inactiveParent || claimedCount !== claimedFiles.size)
      throw invalidBackup(
        "The backup contains inconsistent lifecycle or revision state.",
      );
    const orphan = candidate
      .prepare(
        `SELECT a.id FROM inventory_attachments a
      JOIN inventory_fields f ON f.id = a.field_id JOIN inventories i ON i.id = a.inventory_id
      LEFT JOIN inventory_items t ON t.id = a.item_id
      WHERE a.deleted_at IS NULL AND (a.storage_purged != 0 OR f.deleted_at IS NOT NULL OR i.deleted_at IS NOT NULL
        OR f.field_type != 'attachment' OR f.inventory_id != a.inventory_id
        OR (a.item_id IS NOT NULL AND (t.deleted_at IS NOT NULL OR t.inventory_id != a.inventory_id))) LIMIT 1`,
      )
      .get();
    if (orphan)
      throw invalidBackup("An active attachment has inconsistent ownership.");
    return {
      inventories: inventories.length,
      items: (
        candidate
          .prepare(
            "SELECT count(*) AS count FROM inventory_items WHERE deleted_at IS NULL",
          )
          .get() as { count: number }
      ).count,
      attachments: (
        candidate
          .prepare(
            "SELECT count(*) AS count FROM inventory_attachments WHERE deleted_at IS NULL",
          )
          .get() as { count: number }
      ).count,
    };
  } finally {
    candidate?.close();
    expected.close();
  }
}
