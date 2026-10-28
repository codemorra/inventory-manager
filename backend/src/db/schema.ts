import type { ViewPreferences } from "../views/validation.js";
import { randomUUID } from "node:crypto";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { TemplateField } from "../templates/validation.js";

const now = () => new Date().toISOString();

// Common lifecycle columns for all tables (id, createdAt, updatedAt, deletedAt)
function lifecycleColumns() {
  return {
    id: text("id").primaryKey().$defaultFn(randomUUID),
    createdAt: text("created_at").notNull().$defaultFn(now),
    updatedAt: text("updated_at").notNull().$defaultFn(now).$onUpdateFn(now),
    deletedAt: text("deleted_at"),
  };
}

// Supported field types for inventory fields
export const fieldTypes = [
  "text",
  "number",
  "boolean",
  "checkbox",
  "date",
  "time",
  "datetime",
  "duration",
  "select",
  "multiselect",
  "url",
  "attachment",
  "id",
] as const;

// Single-level inventory groups with deletion tombstones.
export const inventoryGroups = sqliteTable("inventory_groups", {
  ...lifecycleColumns(),
  name: text("name").notNull(),
});

// Independent structure snapshots: array order replaces source field/option IDs and positions.
export const inventoryTemplates = sqliteTable(
  "inventory_templates",
  {
    ...lifecycleColumns(),
    revision: integer("revision").notNull().default(1),
    name: text("name").notNull(),
    description: text("description"),
    fields: text("fields", { mode: "json" }).$type<TemplateField[]>().notNull(),
  },
  (table) => [
    index("inventory_templates_active_name_idx").on(
      table.deletedAt,
      table.name,
    ),
  ],
);

// Inventories table
export const inventories = sqliteTable(
  "inventories",
  {
    ...lifecycleColumns(),
    configurationRevision: integer("configuration_revision")
      .notNull()
      .default(1),
    name: text("name").notNull(),
    description: text("description"),
    groupId: text("group_id").references(() => inventoryGroups.id),
  },
  (table) => [
    index("inventories_active_name_idx").on(table.deletedAt, table.name),
  ],
);

// Inventory fields table
export const inventoryFields = sqliteTable(
  "inventory_fields",
  {
    ...lifecycleColumns(),
    inventoryId: text("inventory_id")
      .notNull()
      .references(() => inventories.id),
    name: text("name").notNull(),
    fieldType: text("field_type", { enum: fieldTypes }).notNull(),
    maxLength: integer("max_length"),
    reuseDeletedIds: integer("reuse_deleted_ids", { mode: "boolean" })
      .notNull()
      .default(false),
    lastAssignedId: integer("last_assigned_id").notNull().default(0),
    isRequired: integer("is_required", { mode: "boolean" })
      .notNull()
      .default(false),
    isSortable: integer("is_sortable", { mode: "boolean" })
      .notNull()
      .default(true),
    position: integer("position").notNull(),
  },
  (table) => [
    index("inventory_fields_inventory_active_position_idx").on(
      table.inventoryId,
      table.deletedAt,
      table.position,
    ),
  ],
);

// Inventory field options table
export const inventoryFieldOptions = sqliteTable(
  "inventory_field_options",
  {
    ...lifecycleColumns(),
    fieldId: text("field_id")
      .notNull()
      .references(() => inventoryFields.id),
    name: text("name").notNull(),
    position: integer("position").notNull(),
  },
  (table) => [
    index("inventory_field_options_field_active_position_idx").on(
      table.fieldId,
      table.deletedAt,
      table.position,
    ),
  ],
);

// Inventory items table
export const inventoryItems = sqliteTable(
  "inventory_items",
  {
    ...lifecycleColumns(),
    revision: integer("revision").notNull().default(1),
    inventoryId: text("inventory_id")
      .notNull()
      .references(() => inventories.id),
  },
  (table) => [
    index("inventory_items_inventory_active_created_idx").on(
      table.inventoryId,
      table.deletedAt,
      table.createdAt,
    ),
  ],
);

// Inventory item values table
export const inventoryItemValues = sqliteTable(
  "inventory_item_values",
  {
    ...lifecycleColumns(),
    itemId: text("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    fieldId: text("field_id")
      .notNull()
      .references(() => inventoryFields.id),
    value: text("value", { mode: "json" }).$type<unknown>(),
  },
  (table) => [
    index("inventory_item_values_item_active_idx").on(
      table.itemId,
      table.deletedAt,
    ),
    index("inventory_item_values_field_idx").on(table.fieldId),
  ],
);

// Managed files are staged for a field, then bound to an item inside its save transaction.
export const inventoryAttachments = sqliteTable(
  "inventory_attachments",
  {
    ...lifecycleColumns(),
    inventoryId: text("inventory_id")
      .notNull()
      .references(() => inventories.id),
    fieldId: text("field_id")
      .notNull()
      .references(() => inventoryFields.id),
    itemId: text("item_id").references(() => inventoryItems.id),
    filename: text("filename").notNull(),
    mediaType: text("media_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    sha256: text("sha256"),
    storagePurged: integer("storage_purged", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (table) => [
    index("inventory_attachments_item_active_idx").on(
      table.itemId,
      table.deletedAt,
    ),
    index("inventory_attachments_field_active_idx").on(
      table.fieldId,
      table.deletedAt,
    ),
    index("inventory_attachments_cleanup_idx").on(
      table.deletedAt,
      table.storagePurged,
    ),
  ],
);

// Presentation belongs to its inventory; it never changes configuration or item revisions.
export const inventoryViews = sqliteTable("inventory_views", {
  inventoryId: text("inventory_id")
    .primaryKey()
    .references(() => inventories.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(1),
  preferences: text("preferences", { mode: "json" })
    .$type<ViewPreferences>()
    .notNull(),
});
