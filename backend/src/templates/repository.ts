import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { inventoryTemplates } from "../db/schema.js";
import type { AppDatabase } from "../db/types.js";
import type { TemplateField } from "./validation.js";

/**
 * Store independent blueprints and claim revisions before mutating their content.
 * @param db The database or enclosing transaction.
 * @returns Active-template queries and persistence operations.
 */
export function createTemplateRepository(db: AppDatabase) {
  const active = (id: string) =>
    and(eq(inventoryTemplates.id, id), isNull(inventoryTemplates.deletedAt));
  return {
    list: () =>
      db
        .select()
        .from(inventoryTemplates)
        .where(isNull(inventoryTemplates.deletedAt))
        .orderBy(asc(inventoryTemplates.name), asc(inventoryTemplates.id))
        .all(),
    find: (id: string) =>
      db.select().from(inventoryTemplates).where(active(id)).get(),
    create: (data: {
      name: string;
      description: string | null;
      fields: TemplateField[];
    }) => db.insert(inventoryTemplates).values(data).returning().get(),
    claim: (id: string, expectedRevision: number) =>
      db
        .update(inventoryTemplates)
        .set({ revision: sql`${inventoryTemplates.revision} + 1` })
        .where(
          and(
            active(id),
            eq(inventoryTemplates.revision, expectedRevision),
            sql`${inventoryTemplates.revision} < ${Number.MAX_SAFE_INTEGER}`,
          ),
        )
        .returning()
        .get(),
    update: (
      id: string,
      changes: Partial<
        Pick<
          typeof inventoryTemplates.$inferInsert,
          "name" | "description" | "fields" | "deletedAt"
        >
      >,
    ) =>
      db
        .update(inventoryTemplates)
        .set(changes)
        .where(active(id))
        .returning()
        .get(),
  };
}
