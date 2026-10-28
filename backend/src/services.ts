import { createSettingsService } from "./settings/service.js";
import { createBackupCatalog } from "./backups/catalog.js";
import { createStorageLocationService } from "./storage-relocation.js";
import type { AppConfig } from "./config.js";
import { createViewService } from "./views/service.js";
import { join } from "node:path";
import { createImportService } from "./exchange/import-service.js";
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

export interface ServiceStorageOptions extends AttachmentStorageOptions {
  // Production always supplies the root-level temp directory; isolated storage-only callers may omit it.
  tempDirectory?: string;
  settingsPath?: string;
  storageConfig?: AppConfig;
}

/**
 * Compose the domain services once; they have no dependency on Express or HTTP.
 * @param db - The application database instance.
 * @param attachmentStorage Explicit managed storage; omitted for database-only callers and tests.
 * @returns An object containing the composed domain services.
 */
export function createServices(
  db: AppDatabase,
  attachmentStorage?: ServiceStorageOptions,
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
    backups: attachmentStorage?.storageConfig
      ? createBackupCatalog(attachmentStorage.storageConfig)
      : null,
    inventories,
    views: createViewService(db),
    storageLocations: attachmentStorage?.storageConfig
      ? createStorageLocationService(attachmentStorage.storageConfig)
      : null,
    settings: attachmentStorage?.settingsPath
      ? createSettingsService(attachmentStorage.settingsPath)
      : null,
    fields,
    options,
    items,
    groups,
    inventoryEditor,
    templates,
    attachments,
    imports:
      attachments && attachmentStorage
        ? createImportService(
            db,
            attachments,
            () => attachmentStorage.directory,
            attachmentStorage.tempDirectory ??
              join(attachmentStorage.directory, ".exchange"),
          )
        : null,
    exports:
      attachments && attachmentStorage
        ? createExportService(
            db,
            attachments,
            attachmentStorage.tempDirectory ??
              join(attachmentStorage.directory, ".exchange"),
          )
        : null,
  };
}

export type Services = ReturnType<typeof createServices>;
