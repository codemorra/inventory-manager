const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

/** Define structured API error details. */
interface ApiErrorDetail {
  code?: string;
  message?: string;
}

/** Define an API error response body. */
interface ApiErrorResponse {
  detail?: ApiErrorDetail | string;
}

/** Represent a failed API request. */
export class ApiError extends Error {
  status: number;
  code?: string;

  /**
   * Create an API error.
   *
   * @param status - HTTP response status.
   * @param message - User-facing error message.
   * @param code - Optional stable API error code.
   */
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
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
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorResponse = (await response.json()) as ApiErrorResponse;
    const detail = errorResponse.detail;

    if (typeof detail === "object" && detail !== null) {
      throw new ApiError(
        response.status,
        detail.message ?? "An unexpected error occurred.",
        detail.code,
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
