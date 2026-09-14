const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8000";

interface ApiErrorDetail {
  code?: string;
  message?: string;
}

interface ApiErrorResponse {
  detail?: ApiErrorDetail | string;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

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

  return response.json() as Promise<T>;
}
