ALTER TABLE `inventories` ADD `configuration_revision` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
-- Track every configuration write, including legacy endpoints and group membership changes.
CREATE TRIGGER inventory_metadata_revision AFTER UPDATE OF name, description, group_id, deleted_at ON inventories
WHEN NEW.name IS NOT OLD.name OR NEW.description IS NOT OLD.description
  OR NEW.group_id IS NOT OLD.group_id OR NEW.deleted_at IS NOT OLD.deleted_at
BEGIN
  UPDATE inventories SET configuration_revision = configuration_revision + 1,
    updated_at = CASE WHEN NEW.deleted_at IS NOT NULL THEN NEW.updated_at
      ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now') END WHERE id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER field_insert_revision AFTER INSERT ON inventory_fields
BEGIN
  UPDATE inventories SET configuration_revision = configuration_revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id IN (NEW.inventory_id);
END;
--> statement-breakpoint
-- Counter advancement is item data, not a field definition change; exclude last_assigned_id.
CREATE TRIGGER field_update_revision AFTER UPDATE OF name, field_type, max_length, is_required, is_sortable, reuse_deleted_ids, position, inventory_id, deleted_at ON inventory_fields
WHEN NEW.name IS NOT OLD.name
  OR NEW.field_type IS NOT OLD.field_type
  OR NEW.max_length IS NOT OLD.max_length
  OR NEW.is_required IS NOT OLD.is_required
  OR NEW.is_sortable IS NOT OLD.is_sortable
  OR NEW.reuse_deleted_ids IS NOT OLD.reuse_deleted_ids
  OR NEW.position IS NOT OLD.position
  OR NEW.inventory_id IS NOT OLD.inventory_id
  OR NEW.deleted_at IS NOT OLD.deleted_at
BEGIN
  UPDATE inventories SET configuration_revision = configuration_revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id IN (NEW.inventory_id, OLD.inventory_id);
END;
--> statement-breakpoint
CREATE TRIGGER field_delete_revision AFTER DELETE ON inventory_fields
BEGIN
  UPDATE inventories SET configuration_revision = configuration_revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id IN (OLD.inventory_id);
END;
--> statement-breakpoint
CREATE TRIGGER option_insert_revision AFTER INSERT ON inventory_field_options
BEGIN
  UPDATE inventories SET configuration_revision = configuration_revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id IN (SELECT inventory_id FROM inventory_fields WHERE id = NEW.field_id);
END;
--> statement-breakpoint
CREATE TRIGGER option_update_revision AFTER UPDATE OF name, position, field_id, deleted_at ON inventory_field_options
WHEN NEW.name IS NOT OLD.name
  OR NEW.position IS NOT OLD.position
  OR NEW.field_id IS NOT OLD.field_id
  OR NEW.deleted_at IS NOT OLD.deleted_at
BEGIN
  UPDATE inventories SET configuration_revision = configuration_revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id IN (SELECT inventory_id FROM inventory_fields WHERE id IN (NEW.field_id, OLD.field_id));
END;
--> statement-breakpoint
CREATE TRIGGER option_delete_revision AFTER DELETE ON inventory_field_options
BEGIN
  UPDATE inventories SET configuration_revision = configuration_revision + 1,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id IN (SELECT inventory_id FROM inventory_fields WHERE id = OLD.field_id);
END;
