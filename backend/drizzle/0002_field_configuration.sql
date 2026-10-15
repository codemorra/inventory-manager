ALTER TABLE `inventory_fields` ADD `is_required` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `inventory_fields` ADD `is_sortable` integer DEFAULT true NOT NULL;