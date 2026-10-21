import { randomUUID } from "node:crypto";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  "id",
] as const;

// Single-level inventory groups with deletion tombstones.
export const inventoryGroups = sqliteTable("inventory_groups", {
  ...lifecycleColumns(),
  name: text("name").notNull(),
});

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
