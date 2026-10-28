import { request } from "./api";
import type {
  StorageDirectories,
  StorageLocationState,
} from "../types/storage";

/** Read the active backend paths and any storage operation status. */
export function getStorageLocations(): Promise<StorageLocationState> {
  return request("/storage-locations");
}
/** Move data/backup storage while the runtime pauses and drains active operations. */
export function changeStorageLocations(
  revision: number,
  paths: StorageDirectories,
): Promise<StorageLocationState> {
  return request("/storage-locations", {
    method: "PUT",
    body: JSON.stringify({ expected_revision: revision, ...paths }),
  });
}
/** Cancel a plan while the backend still uses its original storage. */
export function cancelStorageMove(
  revision: number,
): Promise<StorageLocationState> {
  return request("/storage-locations", {
    method: "DELETE",
    body: JSON.stringify({ expected_revision: revision }),
  });
}
