import {
  ApiClientError,
  apiUrl,
  notifyUnauthorized,
} from "./client";
import type {
  NormalizedDiagnostic,
  RepositoryGatewayEnvelope,
} from "@/types/api";

export interface GatewayResult<T> {
  data: T;
  partial: boolean;
  diagnostics: NormalizedDiagnostic[];
  requestId: string;
  repositoryId: string;
  revision: string;
}

function isGatewayEnvelope<T>(value: unknown): value is RepositoryGatewayEnvelope<T> {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.requestId === "string" &&
    typeof item.repositoryId === "string" &&
    typeof item.revision === "string" &&
    typeof item.service === "string" &&
    ["ok", "partial", "error"].includes(String(item.status)) &&
    Array.isArray(item.diagnostics) &&
    "payload" in item;
}

export async function gatewayRequest<T>(
  path: string,
  options: RequestInit & { token: string },
): Promise<GatewayResult<T>> {
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
      status: 0,
      code: "network_error",
      message: "Unable to reach the Giro API.",
      retryable: true,
    });
  }

  const raw = await response.json().catch(() => null);
  if (!isGatewayEnvelope<T>(raw)) {
    throw new ApiClientError({
      status: response.status,
      code: "invalid_gateway_response",
      message: "The repository gateway returned an unexpected response.",
      requestId: response.headers.get("X-Request-ID") ?? undefined,
      retryable: response.status === 429 || response.status >= 500,
    });
  }
  if (response.status === 401) notifyUnauthorized();
  if (!response.ok || raw.status === "error" || raw.payload === null) {
    const diagnostic = raw.diagnostics.find((item) => item.severity === "error") ??
      raw.diagnostics[0];
    throw new ApiClientError({
      status: response.status,
      code: diagnostic?.code ?? "gateway_request_failed",
      message: diagnostic?.message ?? "The repository gateway request failed.",
      requestId: raw.requestId,
      retryable: response.status === 429 || response.status === 503,
    });
  }
  return {
    data: raw.payload,
    partial: response.status === 207 || raw.status === "partial",
    diagnostics: raw.diagnostics,
    requestId: raw.requestId,
    repositoryId: raw.repositoryId,
    revision: raw.revision,
  };
}

export const repositoryGatewayClient = {
  get<T>(path: string, token: string, signal?: AbortSignal) {
    return gatewayRequest<T>(path, { method: "GET", token, signal });
  },
  post<T>(path: string, token: string, input: unknown, signal?: AbortSignal) {
    return gatewayRequest<T>(path, {
      method: "POST",
      token,
      signal,
      body: JSON.stringify(input),
    });
  },
};
