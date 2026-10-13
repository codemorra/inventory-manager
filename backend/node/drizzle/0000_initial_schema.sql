CREATE TABLE `inventories` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`name` text NOT NULL,
	`description` text
);
--> statement-breakpoint
CREATE INDEX `inventories_active_name_idx` ON `inventories` (`deleted_at`,`name`);--> statement-breakpoint
CREATE TABLE `inventory_field_options` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`field_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`field_id`) REFERENCES `inventory_fields`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_field_options_field_active_position_idx` ON `inventory_field_options` (`field_id`,`deleted_at`,`position`);--> statement-breakpoint
CREATE TABLE `inventory_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`inventory_id` text NOT NULL,
	`name` text NOT NULL,
	`field_type` text NOT NULL,
	`max_length` integer,
	`position` integer NOT NULL,
	FOREIGN KEY (`inventory_id`) REFERENCES `inventories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_fields_inventory_active_position_idx` ON `inventory_fields` (`inventory_id`,`deleted_at`,`position`);--> statement-breakpoint
CREATE TABLE `inventory_item_values` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`item_id` text NOT NULL,
	`field_id` text NOT NULL,
	`value` text,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`field_id`) REFERENCES `inventory_fields`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_item_values_item_active_idx` ON `inventory_item_values` (`item_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `inventory_item_values_field_idx` ON `inventory_item_values` (`field_id`);--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`inventory_id` text NOT NULL,
	FOREIGN KEY (`inventory_id`) REFERENCES `inventories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_items_inventory_active_created_idx` ON `inventory_items` (`inventory_id`,`deleted_at`,`created_at`);