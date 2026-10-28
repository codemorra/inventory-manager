import { eq, isNull } from "drizzle-orm";
import { inventories, inventoryViews } from "../db/schema.js";
import type { AppDatabase } from "../db/types.js";
import { createInventoryService } from "../inventories/service.js";
import { createFieldRepository } from "../fields/repository.js";
import { DomainError } from "../errors.js";
import {
  normalizeView,
  viewMigrationSchema,
  viewUpdateSchema,
} from "./validation.js";

/**
 * Store inventory presentation independently of configuration/item revisions and archive exchange.
 * @param db The inventory database; reads and writes use consistent transactions.
 * @returns Active views, revision-checked replacement and one-time per-inventory browser migration.
 */
export function createViewService(db: AppDatabase) {
  function read(transaction: AppDatabase, inventoryId: string) {
    createInventoryService(transaction).get(inventoryId);
    const stored = transaction
      .select()
      .from(inventoryViews)
      .where(eq(inventoryViews.inventoryId, inventoryId))
      .get();
    return {
      inventory_id: inventoryId,
      revision: stored?.revision ?? 0,
      preferences: normalizeView(
        stored?.preferences,
        createFieldRepository(transaction).list(inventoryId),
      ),
    };
  }
  const conflict = () =>
    new DomainError(
      "inventory_view_conflict",
      "The inventory view has changed. Reload it before saving again.",
    );
  return {
    read(inventoryId: string) {
      return db.transaction((transaction) => read(transaction, inventoryId));
    },
    list() {
      return db.transaction((transaction) =>
        transaction
          .select({ id: inventoryViews.inventoryId })
          .from(inventoryViews)
          .innerJoin(
            inventories,
            eq(inventories.id, inventoryViews.inventoryId),
          )
          .where(isNull(inventories.deletedAt))
          .all()
          .map((row) => read(transaction, row.id)),
      );
    },
    update(inventoryId: string, input: unknown) {
      const data = viewUpdateSchema.parse(input);
      return db.transaction((transaction) => {
        const current = read(transaction, inventoryId);
        if (
          current.revision !== data.expected_revision ||
          current.revision >= Number.MAX_SAFE_INTEGER
        )
          throw conflict();
        const preferences = normalizeView(
          data.preferences,
          createFieldRepository(transaction).list(inventoryId),
        );
        if (current.revision === 0) {
          const created = transaction
            .insert(inventoryViews)
            .values({ inventoryId, revision: 1, preferences })
            .onConflictDoNothing()
            .returning()
            .get();
          if (!created) throw conflict();
        } else {
          transaction
            .update(inventoryViews)
            .set({ revision: current.revision + 1, preferences })
            .where(eq(inventoryViews.inventoryId, inventoryId))
            .run();
        }
        return read(transaction, inventoryId);
      });
    },
    migrate(inventoryId: string, input: unknown) {
      const data = viewMigrationSchema.parse(input);
      return db.transaction((transaction) => {
        const current = read(transaction, inventoryId);
        if (current.revision !== 0) return current;
        const preferences = normalizeView(
          data.preferences,
          createFieldRepository(transaction).list(inventoryId),
        );
        transaction
          .insert(inventoryViews)
          .values({ inventoryId, preferences })
          .onConflictDoNothing()
          .run();
        return read(transaction, inventoryId);
      });
    },
  };
}
