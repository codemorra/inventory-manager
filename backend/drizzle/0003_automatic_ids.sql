ALTER TABLE `inventory_fields` ADD `reuse_deleted_ids` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `inventory_fields` ADD `last_assigned_id` integer DEFAULT 0 NOT NULL;
