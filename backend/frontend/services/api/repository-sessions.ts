import { ApiClientError, apiUrl, notifyUnauthorized } from "./client";
import type {
  JsonValue,
  RepositorySessionDetail,
  RepositorySessionEnvelope,
  RepositorySessionOperationResult,
  RepositorySessionSummary,
} from "@/types/api";

function isSessionEnvelope<T>(value: unknown): value is RepositorySessionEnvelope<T> {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.success === "boolean" &&
    typeof item.requestId === "string" &&
    typeof item.status === "number" &&
    typeof item.code === "string" &&
    typeof item.message === "string" &&
    typeof item.retryable === "boolean" &&
    Array.isArray(item.diagnostics) &&
    "data" in item;
}

async function repositorySessionRequest<T>(
  path: string,
  options: RequestInit & { token: string },
): Promise<RepositorySessionEnvelope<T>> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
        Authorization: `Bearer ${options.token}`,
      },
    });
  } catch {
    throw new ApiClientError({
      code: "network_error",
      message: "Unable to reach the Giro API.",
      status: 0,
      retryable: true,
    });
  }

  if (response.status === 204) {
    return {
      success: true,
      requestId: response.headers.get("X-Request-ID") ?? "unknown",
      status: 204,
      code: "repository_session_archived",
      message: "The repository session was archived.",
      retryable: false,
      diagnostics: [],
      data: undefined as T,
    };
  }

  const raw = await response.json().catch(() => null);
  if (!isSessionEnvelope<T>(raw)) {
    throw new ApiClientError({
      code: "invalid_session_response",
      message: "The repository session API returned an unexpected response.",
      status: response.status,
      requestId: response.headers.get("X-Request-ID") ?? undefined,
      retryable: response.status === 429 || response.status >= 500,
    });
  }
  if (response.status === 401) notifyUnauthorized();
  if (!response.ok || raw.success === false) {
    throw new ApiClientError({
      code: raw.code,
      message: raw.message,
      status: response.status,
      requestId: raw.requestId,
      retryable: raw.retryable,
    });
  }
  return raw;
}

export const repositorySessionsApi = {
  list(token: string, signal?: AbortSignal) {
    return repositorySessionRequest<{ sessions: RepositorySessionSummary[]; count: number }>(
      "/api/v1/sessions",
      { method: "GET", token, signal },
    );
  },
  get(token: string, sessionId: string, signal?: AbortSignal) {
    return repositorySessionRequest<RepositorySessionDetail>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
      { method: "GET", token, signal },
    );
  },
  create(token: string, input: { owner: string; repo: string; revision: string; workflowId?: string }, signal?: AbortSignal) {
    return repositorySessionRequest<RepositorySessionDetail>(
      "/api/v1/sessions",
      { method: "POST", token, signal, body: JSON.stringify(input) },
    );
  },
  archive(token: string, sessionId: string, signal?: AbortSignal) {
    return repositorySessionRequest<RepositorySessionDetail>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/archive`,
      { method: "POST", token, signal, body: JSON.stringify({}) },
    );
  },
  remove(token: string, sessionId: string, signal?: AbortSignal) {
    return repositorySessionRequest<void>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
      { method: "DELETE", token, signal },
    );
  },
  query(token: string, sessionId: string, query: string, signal?: AbortSignal) {
    return repositorySessionRequest<RepositorySessionOperationResult>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/query`,
      { method: "POST", token, signal, body: JSON.stringify({ query }) },
    );
  },
  plan(token: string, sessionId: string, objective: string, signal?: AbortSignal) {
    return repositorySessionRequest<RepositorySessionOperationResult>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/plan`,
      { method: "POST", token, signal, body: JSON.stringify({ objective }) },
    );
  },
  specification(token: string, sessionId: string, objective: string, signal?: AbortSignal) {
    return repositorySessionRequest<RepositorySessionOperationResult>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/specification`,
      { method: "POST", token, signal, body: JSON.stringify({ objective }) },
    );
  },
  insights(token: string, sessionId: string, signal?: AbortSignal) {
    return repositorySessionRequest<RepositorySessionOperationResult>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/insights`,
      { method: "POST", token, signal, body: JSON.stringify({}) },
    );
  },
  execution(token: string, sessionId: string, objective: string, signal?: AbortSignal) {
    return repositorySessionRequest<RepositorySessionOperationResult>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/execution`,
      { method: "POST", token, signal, body: JSON.stringify({ objective }) },
    );
  },
  workflow(token: string, sessionId: string, workflowId: string, signal?: AbortSignal) {
    return repositorySessionRequest<RepositorySessionDetail>(
      `/api/v1/sessions/${encodeURIComponent(sessionId)}/workflow`,
      { method: "POST", token, signal, body: JSON.stringify({ workflowId }) },
    );
  },
};

export function sessionResultSummary(result: JsonValue): string {
  if (!result || typeof result !== "object") return String(result ?? "");
  if (Array.isArray(result)) return `${result.length} items`;
  const record = result as Record<string, JsonValue>;
  for (const key of ["answer", "summary", "title", "objective", "message"]) {
    if (typeof record[key] === "string") return record[key];
  }
  return Object.keys(record).join(", ");
}
