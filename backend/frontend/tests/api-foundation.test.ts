import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, standardApiClient } from "@/services/api/client";
import { repositoryGatewayClient } from "@/services/api/gateway";

describe("typed API foundation", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("uses the standard success envelope and forwards AbortSignal", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true, data: { count: 2 }, requestId: "request-1",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(standardApiClient.get<{ count: number }>(
      "/api/v1/repositories", "token", signal)).resolves.toEqual({ count: 2 });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal });
  });

  it("normalizes standard errors into the shared UI error model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      error: { code: "repository_metadata_unavailable", message: "Unavailable" },
      requestId: "request-error",
    }), { status: 503, headers: { "Content-Type": "application/json" } })));
    await expect(standardApiClient.get("/api/v1/repositories", "token"))
      .rejects.toMatchObject({
        status: 503, code: "repository_metadata_unavailable",
        requestId: "request-error", retryable: true,
      });
  });

  it("returns payload and diagnostics for a 207 Gateway response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: "gateway-1", repositoryId: "acme/platform",
      revision: "a".repeat(40), service: "repository-query",
      status: "partial", payload: { answer: "usable" },
      diagnostics: [{ code: "partial_source", message: "One source failed", severity: "warning" }],
      timestamps: { receivedAt: "2026-07-31T10:00:00.000Z", completedAt: "2026-07-31T10:00:01.000Z" },
    }), { status: 207, headers: { "Content-Type": "application/json" } })));
    const result = await repositoryGatewayClient.post<{ answer: string }>(
      "/api/v1/repository-gateway/acme/platform/query",
      "token", { revision: "a".repeat(40), query: "Where is auth?" },
    );
    expect(result.data.answer).toBe("usable");
    expect(result.partial).toBe(true);
    expect(result.diagnostics[0]?.code).toBe("partial_source");
    expect(result.requestId).toBe("gateway-1");
  });

  it("normalizes Gateway error envelopes into ApiClientError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      requestId: "gateway-error", repositoryId: "acme/platform",
      revision: "a".repeat(40), service: "repository-query",
      status: "error", payload: null,
      diagnostics: [{ code: "gateway_stale_revision", message: "Revision conflict", severity: "error" }],
      timestamps: { receivedAt: "2026-07-31T10:00:00.000Z", completedAt: "2026-07-31T10:00:01.000Z" },
    }), { status: 409, headers: { "Content-Type": "application/json" } })));
    const request = repositoryGatewayClient.post(
      "/api/v1/repository-gateway/acme/platform/query", "token", {});
    await expect(request).rejects.toBeInstanceOf(ApiClientError);
    await expect(request).rejects.toMatchObject({
        status: 409, code: "gateway_stale_revision", requestId: "gateway-error",
      });
  });
});
