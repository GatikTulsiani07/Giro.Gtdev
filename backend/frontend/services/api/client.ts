import type { ApiResponse } from "@/types/api";

const API_URL = (process.env.NEXT_PUBLIC_GIRO_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;
  readonly retryable: boolean;

  constructor(input: { message: string; code: string; status: number; requestId?: string; retryable?: boolean }) {
    super(input.message);
    this.name = "ApiClientError";
    this.code = input.code;
    this.status = input.status;
    this.requestId = input.requestId;
    this.retryable = input.retryable ?? input.status >= 500;
  }
}

function unauthorized(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("giro:unauthorized"));
}

export function apiUrl(path: string): string {
  return `${API_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & { token: string },
): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${options.token}`,
      ...options.headers,
    },
  });

  let envelope: ApiResponse<T> | null = null;
  try {
    envelope = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError({
      code: "invalid_response",
      message: "The server returned an unreadable response.",
      status: response.status,
    });
  }

  if (!response.ok || !envelope.success) {
    if (response.status === 401) unauthorized();
    const error = envelope.success
      ? { code: "request_failed", message: response.statusText, retryable: response.status >= 500 }
      : envelope.error;
    throw new ApiClientError({
      code: error.code,
      message: error.message,
      status: response.status,
      requestId: envelope.requestId,
      retryable: error.retryable,
    });
  }

  return envelope.data;
}

export function getApiErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) return "Your session has expired. Sign in again.";
    if (error.code === "repo_not_connected" || error.code === "repo_not_found") return "Repository not found.";
    if (error.code === "indexing_job_not_found") return "No indexing job was found for this repository.";
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
