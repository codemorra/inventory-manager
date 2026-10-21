import { DomainError } from "../../src/errors.js";
import type { Services } from "../../src/services.js";

/**
 * Read the current revision for ordinary HTTP CRUD tests without nesting Supertest requests.
 * @param services The isolated test fixture services.
 * @param path The item route whose current revision is needed.
 * @returns The current revision, or a valid placeholder for deliberate not-found requests.
 */
export function itemRevision(services: Services, path: string): number {
  const [, , inventoryId, , itemId] = path.split("/");
  try {
    return services.items.get(inventoryId!, itemId!).revision;
  } catch (error) {
    if (
      error instanceof DomainError &&
      ["inventory_not_found", "inventory_item_not_found"].includes(error.code)
    )
      return 1;
    throw error;
  }
}
