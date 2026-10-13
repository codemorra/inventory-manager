// Stable domain errors shared by HTTP and future direct service callers.
export class DomainError extends Error {
  constructor(
    public readonly code:
      | "inventory_not_found"
      | "inventory_field_not_found"
      | "inventory_field_option_not_found"
      | "inventory_field_options_not_supported",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
