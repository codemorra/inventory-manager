import { DomainError } from "../../src/errors.js";
import type { Services } from "../../src/services.js";

/**
 * Read a current configuration revision for normal CRUD tests without nested HTTP requests.
 * @param services The domain services belonging to the isolated test fixture.
 * @param path The inventory configuration route.
 * @returns The saved revision, or a valid placeholder for deliberate not-found requests.
 */
export function configurationRevision(
  services: Services,
  path: string,
): number {
  const inventoryId = path.split("/")[2]!;
  try {
    return services.inventories.get(inventoryId).configurationRevision;
  } catch (error) {
    if (error instanceof DomainError && error.code === "inventory_not_found")
      return 1;
    throw error;
  }
}
