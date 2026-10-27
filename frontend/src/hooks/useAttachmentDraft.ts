import { useEffect, useState, useSyncExternalStore } from "react";
import { AttachmentDraft } from "../components/attachmentDraft";

/**
 * Keep stage ownership across field mounts and clean it up when the parent session unmounts.
 * @returns The stable controller and its current upload state.
 */
export function useAttachmentDraft() {
  const [controller] = useState(() => new AttachmentDraft());
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  useEffect(() => () => controller.discard(), [controller]);
  return { controller, ...state };
}
