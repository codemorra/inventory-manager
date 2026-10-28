export const apiBaseUrl =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

export const dataChangedEvent = "inventory-data-changed";
let dataGeneration: string | undefined;

/** Define structured API error details. */
interface ApiErrorDetail {
  code?: string;
  message?: string;
  item_id?: string;
}

/** Define an API error response body. */
interface ApiErrorResponse {
  detail?: ApiErrorDetail | string;
}

/** Represent a failed API request. */
export class ApiError extends Error {
  status: number;
  code?: string;
  itemId?: string;

  /**
   * Create an API error.
   *
   * @param status - HTTP response status.
   * @param message - User-facing error message.
   * @param code - Optional stable API error code.
   * @param itemId - Optional failed row identifier for atomic table saves.
   */
  constructor(status: number, message: string, code?: string, itemId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.itemId = itemId;
  }
}

/**
 * Send a request to the local backend API.
 *
 * @param path - API path relative to the configured backend URL.
 * @param options - Fetch request options.
 * @returns Parsed API response data.
 */
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(dataGeneration ? { "X-Inventory-Generation": dataGeneration } : {}),
      ...options.headers,
    },
  });

  const generation = response.headers?.get("X-Inventory-Generation");
  if (generation) {
    if (dataGeneration && generation !== dataGeneration) {
      if (typeof window !== "undefined")
        window.dispatchEvent(new Event(dataChangedEvent));
      throw new ApiError(
        409,
        "The application data has changed. Reload before editing.",
        "application_data_changed",
      );
    }
    dataGeneration = generation;
  }

  if (!response.ok) {
    const errorResponse = (await response.json()) as ApiErrorResponse;
    const detail = errorResponse.detail;

    if (typeof detail === "object" && detail !== null) {
      throw new ApiError(
        response.status,
        detail.message ?? "An unexpected error occurred.",
        detail.code,
        detail.item_id,
      );
    }

    throw new ApiError(
      response.status,
      typeof detail === "string" ? detail : "An unexpected error occurred.",
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
