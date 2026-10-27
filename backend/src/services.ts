import { join } from "node:path";
import { createExportService } from "./exchange/export-service.js";
import type { AppDatabase } from "./db/types.js";
import { createInventoryService } from "./inventories/service.js";
import { createFieldService } from "./fields/service.js";
import { createOptionService } from "./options/service.js";
import { createItemService } from "./items/service.js";
import { createGroupService } from "./groups/service.js";
import { createInventoryEditorService } from "./inventories/editor-service.js";
import { createTemplateService } from "./templates/service.js";
import {
  createAttachmentService,
  type AttachmentStorageOptions,
} from "./attachments/service.js";

/**
 * Compose the domain services once; they have no dependency on Express or HTTP.
 * @param db - The application database instance.
 * @param attachmentStorage Explicit managed storage; omitted for database-only callers and tests.
 * @returns An object containing the composed domain services.
 */
export function createServices(
  db: AppDatabase,
  attachmentStorage?: AttachmentStorageOptions,
) {
  const groups = createGroupService(db);
  const inventories = createInventoryService(db, groups);
  const fields = createFieldService(db, inventories);
  const options = createOptionService(db, fields);
  const items = createItemService(db, inventories);
  const inventoryEditor = createInventoryEditorService(db);
  const templates = createTemplateService(db);
  const attachments = attachmentStorage
    ? createAttachmentService(db, attachmentStorage)
    : null;
  return {
    inventories,
    fields,
    options,
    items,
    groups,
    inventoryEditor,
    templates,
    attachments,
    exports:
      attachments && attachmentStorage
        ? createExportService(
            db,
            attachments,
            join(attachmentStorage.directory, ".exchange"),
          )
        : null,
  };
}

export type Services = ReturnType<typeof createServices>;
