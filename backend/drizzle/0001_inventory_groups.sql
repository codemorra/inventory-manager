CREATE TABLE `inventory_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `inventories` ADD `group_id` text REFERENCES inventory_groups(id);