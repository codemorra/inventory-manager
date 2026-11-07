ALTER TABLE `inventory_items` ADD `position` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY inventory_id ORDER BY created_at DESC, id ASC) - 1 AS position
  FROM inventory_items
)
UPDATE inventory_items SET position = (SELECT position FROM ranked WHERE ranked.id = inventory_items.id);
