import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, apiRequest } from "@/services/api/client";
import { normalizeApiBaseUrl } from "@/services/api/config";
import { repositoryGatewayClient } from "@/services/api/gateway";
import { encodeRepositoryId, repositoriesApi } from "@/services/api/repositories";
import { repositorySessionsApi } from "@/services/api/repository-sessions";
import { repositoryWorkspaceApi } from "@/services/api/repository-workspace";
import { sessionsApi } from "@/services/api/sessions";

function jsonResponse(body: unknown, status = 200, requestId = "req-1") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-ID": requestId },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("API contract client", () => {
  it("normalizes the API base URL and rejects malformed values", () => {
    expect(normalizeApiBaseUrl(undefined)).toBe("http://localhost:8000");
    expect(normalizeApiBaseUrl("https://api.giro.dev///")).toBe("https://api.giro.dev");
    expect(() => normalizeApiBaseUrl("not a url")).toThrow(/NEXT_PUBLIC_GIRO_API_URL/);
    expect(() => normalizeApiBaseUrl("https://token@example.com")).toThrow(/without credentials/);
  });

  it("injects the bearer token without putting it in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { ok: true }, requestId: "req-1" }));
    vi.stubGlobal("fetch", fetchMock);
    await apiRequest<{ ok: boolean }>("/sessions", { method: "GET", token: "secret-token" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("secret-token");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer secret-token");
  });

  it("encodes repository IDs as one owner/repo route parameter", async () => {
    expect(encodeRepositoryId("acme", "platform")).toBe("acme%2Fplatform");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { summary: null }, requestId: "req-1" }));
    vi.stubGlobal("fetch", fetchMock);
    await repositoriesApi.summary("token", "acme", "platform");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/repositories/acme%2Fplatform/summary");
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain("/repositories/acme/platform/");
  });

  it.each([
    [429, "rate_limit_exceeded"],
    [503, "dependency_unavailable"],
    [504, "request_timeout"],
  ])("normalizes retryable %i errors and preserves request IDs", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      success: false,
      error: { code, message: "Try later", retryable: true },
      requestId: `req-${status}`,
    }, status)));
    await expect(apiRequest("/sessions/id/ask", { method: "POST", token: "token" }))
      .rejects.toMatchObject({ status, code, retryable: true, requestId: `req-${status}` });
  });

  it("preserves validation field errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      success: false,
      error: { code: "validation_failed", message: "Validation failed", details: { fieldErrors: { question: ["question is required"] } } },
      requestId: "req-validation",
    }, 400)));
    const error = await apiRequest("/sessions/id/ask", { method: "POST", token: "token" }).catch((cause) => cause);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({ fieldErrors: { question: ["question is required"] }, requestId: "req-validation" });
  });

  it("rejects malformed success envelopes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }, 200, "req-malformed")));
    await expect(apiRequest("/sessions", { method: "GET", token: "token" })).rejects.toMatchObject({
      code: "invalid_response",
      requestId: "req-malformed",
    });
  });

  it("uses the verified session creation, deletion, and ask DTOs", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { id: "s1" }, requestId: "r1" }, 201))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { id: "s1", deleted: true }, requestId: "r2" }))
      .mockResolvedValueOnce(jsonResponse({ success: true, data: { answer: "Grounded" }, requestId: "r3" }));
    vi.stubGlobal("fetch", fetchMock);
    await sessionsApi.create("token", { owner: "acme", repo: "platform", title: "Architecture" });
    await sessionsApi.remove("token", "s1");
    await sessionsApi.ask("token", "s1", "Where does it start?");
    expect(fetchMock.mock.calls.map(([, init]) => (init as RequestInit).method)).toEqual(["POST", "DELETE", "POST"]);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).body).toBe(JSON.stringify({ owner: "acme", repo: "platform", title: "Architecture" }));
    expect(fetchMock.mock.calls[1]?.[0]).toContain("/sessions/s1");
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).body).toBe(JSON.stringify({ question: "Where does it start?" }));
  });

  it("treats HTTP 207 gateway responses as usable partial data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      requestId: "gateway-207",
      repositoryId: "acme/platform",
      revision: "1111111111111111111111111111111111111111",
      service: "repository-overview",
      status: "partial",
      payload: { metrics: { filesAnalyzed: 1 } },
      diagnostics: [{ code: "partial", message: "Partial result", severity: "warning" }],
      timestamps: { receivedAt: "2026-07-31T00:00:00.000Z", completedAt: "2026-07-31T00:00:00.000Z" },
    }, 207)));
    await expect(repositoryGatewayClient.get("/api/v1/repository-gateway/acme/platform/overview?revision=1111111111111111111111111111111111111111", "token"))
      .resolves.toMatchObject({ partial: true, requestId: "gateway-207", data: { metrics: { filesAnalyzed: 1 } } });
  });

  it.each([
    [409, "gateway_stale_revision"],
    [424, "gateway_intelligence_unavailable"],
  ])("normalizes gateway %i errors with diagnostics", async (status, code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      requestId: `gateway-${status}`,
      repositoryId: "acme/platform",
      revision: "1111111111111111111111111111111111111111",
      service: "repository-overview",
      status: "error",
      payload: null,
      diagnostics: [{ code, message: "Gateway cannot serve this revision.", severity: "error" }],
      timestamps: { receivedAt: "2026-07-31T00:00:00.000Z", completedAt: "2026-07-31T00:00:00.000Z" },
    }, status)));
    await expect(repositoryGatewayClient.get("/api/v1/repository-gateway/acme/platform/overview?revision=1111111111111111111111111111111111111111", "token"))
      .rejects.toMatchObject({ status, code, requestId: `gateway-${status}` });
  });

  it("passes AbortSignal through workspace gateway and tool requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      requestId: "gateway-signal",
      repositoryId: "acme/platform",
      revision: "1111111111111111111111111111111111111111",
      service: "semantic-navigation",
      status: "ok",
      payload: { symbols: [] },
      diagnostics: [],
      timestamps: { receivedAt: "2026-07-31T00:00:00.000Z", completedAt: "2026-07-31T00:00:00.000Z" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await repositoryWorkspaceApi.semantic("token", "acme", "platform", "1111111111111111111111111111111111111111", "definition", "RepositoryWorkspace", controller.signal);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBe(controller.signal);
  });

  it("uses published repository session create and reuse envelopes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        requestId: "session-create",
        status: 201,
        code: "repository_session_created",
        message: "The repository session was created.",
        retryable: false,
        diagnostics: [],
        data: { session: { sessionId: "session-1", revision: "1111111111111111111111111111111111111111" }, events: [], context: {}, diagnostics: [] },
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        requestId: "session-reuse",
        status: 200,
        code: "repository_session_reused",
        message: "The existing repository session was resumed.",
        retryable: false,
        diagnostics: [],
        data: { session: { sessionId: "session-1", revision: "1111111111111111111111111111111111111111" }, events: [], context: {}, diagnostics: [] },
      }));
    vi.stubGlobal("fetch", fetchMock);
    await repositorySessionsApi.create("token", { owner: "acme", repo: "platform", revision: "1111111111111111111111111111111111111111" });
    await repositorySessionsApi.create("token", { owner: "acme", repo: "platform", revision: "1111111111111111111111111111111111111111" });
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/api/v1/sessions");
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).body).toBe(JSON.stringify({ owner: "acme", repo: "platform", revision: "1111111111111111111111111111111111111111" }));
  });

  it("uses published repository session actions and workflow attachment", async () => {
    const sessionEnvelope = (code: string, data: unknown = { session: { sessionId: "session-1", revision: "1111111111111111111111111111111111111111" }, result: {} }) => jsonResponse({
      success: true,
      requestId: code,
      status: 200,
      code,
      message: code,
      retryable: false,
      diagnostics: [],
      data,
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(sessionEnvelope("repository_session_query_completed"))
      .mockResolvedValueOnce(sessionEnvelope("repository_session_plan_completed"))
      .mockResolvedValueOnce(sessionEnvelope("repository_session_specification_completed"))
      .mockResolvedValueOnce(sessionEnvelope("repository_session_insights_completed"))
      .mockResolvedValueOnce(sessionEnvelope("repository_session_execution_completed"))
      .mockResolvedValueOnce(sessionEnvelope("repository_session_workflow_attached", { session: { sessionId: "session-1", attachedWorkflowId: "workflow-1" }, events: [], context: {}, diagnostics: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 204, headers: { "X-Request-ID": "delete-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    await repositorySessionsApi.query("token", "session-1", "How?");
    await repositorySessionsApi.plan("token", "session-1", "Plan");
    await repositorySessionsApi.specification("token", "session-1", "Spec");
    await repositorySessionsApi.insights("token", "session-1");
    await repositorySessionsApi.execution("token", "session-1", "Ready?");
    await repositorySessionsApi.workflow("token", "session-1", "workflow-1");
    await expect(repositorySessionsApi.remove("token", "session-1")).resolves.toMatchObject({ status: 204 });
    expect(fetchMock.mock.calls.map(([url]) => String(url).replace(/^.*\/api\/v1\/sessions/, "/api/v1/sessions"))).toEqual([
      "/api/v1/sessions/session-1/query",
      "/api/v1/sessions/session-1/plan",
      "/api/v1/sessions/session-1/specification",
      "/api/v1/sessions/session-1/insights",
      "/api/v1/sessions/session-1/execution",
      "/api/v1/sessions/session-1/workflow",
      "/api/v1/sessions/session-1",
    ]);
  });

  it("passes AbortSignal through repository session requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      requestId: "session-signal",
      status: 200,
      code: "repository_session_retrieved",
      message: "The repository session was retrieved.",
      retryable: false,
      diagnostics: [],
      data: { session: { sessionId: "session-1" }, events: [], context: {}, diagnostics: [] },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    await repositorySessionsApi.get("token", "session-1", controller.signal);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBe(controller.signal);
  });
});
