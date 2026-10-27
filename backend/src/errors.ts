// Stable domain errors shared by HTTP and future direct service callers.
export class DomainError extends Error {
  constructor(
    public readonly code:
      | "inventory_not_found"
      | "inventory_attachment_not_found"
      | "attachment_preview_unavailable"
      | "attachment_already_attached"
      | "inventory_template_not_found"
      | "inventory_template_conflict"
      | "inventory_group_not_found"
      | "inventory_field_not_found"
      | "inventory_field_option_not_found"
      | "inventory_field_options_not_supported"
      | "inventory_item_not_found"
      | "inventory_item_conflict"
      | "inventory_configuration_conflict"
      | "automatic_id_exhausted"
      | "invalid_inventory_field_configuration"
      | "invalid_inventory_item_value",
    message: string,
    public readonly itemId?: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
