CREATE TABLE `inventory_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`inventory_id` text NOT NULL,
	`field_id` text NOT NULL,
	`item_id` text,
	`filename` text NOT NULL,
	`media_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text,
	`storage_purged` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`inventory_id`) REFERENCES `inventories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`field_id`) REFERENCES `inventory_fields`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `inventory_attachments_item_active_idx` ON `inventory_attachments` (`item_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `inventory_attachments_field_active_idx` ON `inventory_attachments` (`field_id`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `inventory_attachments_cleanup_idx` ON `inventory_attachments` (`deleted_at`,`storage_purged`);