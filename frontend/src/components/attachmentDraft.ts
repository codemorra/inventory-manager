import { discardAttachment, uploadAttachment } from "../services/attachments";
import type {
  InventoryAttachment,
  InventoryItem,
} from "../types/inventoryItem";
import type { InventoryField } from "../types/inventoryField";

interface AttachmentDraftState {
  target: string | null;
  files: Record<string, InventoryAttachment>;
  busy: boolean;
  error: boolean;
}

/** Own staged uploads for one draft independently of component/field mounting and late network responses. */
export class AttachmentDraft {
  private generation = 0;
  private active = false;
  private stages = new Map<string, InventoryAttachment>();
  private listeners = new Set<() => void>();
  private state: AttachmentDraftState = {
    target: null,
    files: {},
    busy: false,
    error: false,
  };
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(next: AttachmentDraftState) {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
  // Failed cleanup is eventually retried by backend stage expiry; saved files reject cancellation safely.
  private discardStage(file: InventoryAttachment) {
    void discardAttachment(file).catch(() => {});
  }

  /**
   * Start a fresh session, discarding only stages from its predecessor.
   * @param files Metadata from the saved item or table baseline.
   */
  begin(files: InventoryAttachment[] = []) {
    this.discard();
    this.active = true;
    this.publish({
      target: null,
      files: Object.fromEntries(files.map((file) => [file.id, file])),
      busy: false,
      error: false,
    });
  }

  /** Discard known stages and make late upload responses cancel themselves instead of updating the draft. */
  discard() {
    this.generation++;
    this.active = false;
    for (const file of this.stages.values()) this.discardStage(file);
    this.stages.clear();
    this.publish({ target: null, files: {}, busy: false, error: false });
  }

  /**
   * Keep committed files and discard stages omitted from the accepted replacement.
   * @param saved The server's successful item response(s).
   */
  finish(saved: InventoryItem[]) {
    // Ordinary item drafts have no stages and need no attachment metadata processing.
    if (this.stages.size)
      for (const item of saved)
        for (const file of item.attachments ?? []) this.stages.delete(file.id);
    this.discard();
  }

  /**
   * Stream a batch sequentially, preserving earlier successes if a later file fails.
   * @param field The destination cell's field.
   * @param files The selected browser Files.
   * @param append Add a successful upload to the still-active local cell value.
   */
  async upload(
    field: InventoryField,
    files: File[],
    append: (file: InventoryAttachment) => void,
    target = field.id,
  ) {
    if (!this.active || this.state.busy) return;
    const generation = this.generation;
    this.publish({ ...this.state, target, busy: true, error: false });
    try {
      for (const file of files) {
        if (generation !== this.generation) return;
        const uploaded = await uploadAttachment(
          field.inventory_id,
          field.id,
          file,
        );
        if (generation !== this.generation) {
          this.discardStage(uploaded);
          return;
        }
        this.stages.set(uploaded.id, uploaded);
        this.publish({
          ...this.state,
          files: { ...this.state.files, [uploaded.id]: uploaded },
        });
        append(uploaded);
      }
    } catch {
      if (generation === this.generation)
        this.publish({ ...this.state, error: true });
    } finally {
      if (generation === this.generation)
        this.publish({ ...this.state, busy: false });
    }
  }
}
