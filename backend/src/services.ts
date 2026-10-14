import type { AppDatabase } from "./db/types.js";
import { createInventoryService } from "./inventories/service.js";
import { createFieldService } from "./fields/service.js";
import { createOptionService } from "./options/service.js";
import { createItemService } from "./items/service.js";
import { createGroupService } from "./groups/service.js";

/**
 * Compose the domain services once; they have no dependency on Express or HTTP.
 * @param db - The application database instance.
 * @returns An object containing the composed domain services.
 */
export function createServices(db: AppDatabase) {
  const groups = createGroupService(db);
  const inventories = createInventoryService(db, groups);
  const fields = createFieldService(db, inventories);
  const options = createOptionService(db, fields);
  const items = createItemService(db, inventories);
  return { inventories, fields, options, items, groups };
}

export type Services = ReturnType<typeof createServices>;
