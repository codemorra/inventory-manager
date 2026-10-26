CREATE TABLE `inventory_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`revision` integer DEFAULT 1 NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`fields` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `inventory_templates_active_name_idx` ON `inventory_templates` (`deleted_at`,`name`);