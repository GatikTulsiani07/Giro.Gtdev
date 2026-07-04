import { beforeEach, describe, it } from "vitest";
import assert from "node:assert/strict";
import { createApp } from "../app.js";
import { signAccessToken } from "../services/auth/jwt.js";
import {
  clearRepositoryIndexRegistry,
  setRepositoryIndexed,
  type IndexedCounts,
} from "../services/repository/indexingService.js";
import {
  clearRepositoryOwners,
  setRepositoryOwner,
} from "../services/repository/ownershipStore.js";

const USER_A = { userId: "user-a", email: "a@example.com" };
const USER_B = { userId: "user-b", email: "b@example.com" };

const INDEX_COUNTS: IndexedCounts = {
  chunkCount: 11,
  fileCount: 7,
  symbolCount: 19,
  graphNodeCount: 23,
  graphEdgeCount: 29,
  summaryAvailable: true,
};

type ApiResponse = {
  success?: boolean;
  data?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
};

async function authHeader(user: typeof USER_A): Promise<string> {
  return `Bearer ${await signAccessToken(user)}`;
}

async function requestDashboard(
  token?: string,
): Promise<{ status: number; body: ApiResponse }> {
  const app = createApp();
  const headers: Record<string, string> = {};
  if (token) headers.authorization = token;

  const res = await app.request("/repos/acme/demo/dashboard", {
    method: "GET",
    headers,
  });
  const body = (await res.json().catch(() => ({}))) as ApiResponse;

  return { status: res.status, body };
}

function asRecord(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object", "expected object");
  return value as Record<string, unknown>;
}

beforeEach(() => {
  clearRepositoryOwners();
  clearRepositoryIndexRegistry();
});

describe("repository dashboard route", () => {
  it("returns 401 without auth", async () => {
    const result = await requestDashboard();

    assert.equal(result.status, 401);
    assert.equal(result.body.error?.code, "unauthorized");
  });

  it("returns 404 when repo is not connected or owned", async () => {
    const token = await authHeader(USER_A);
    const result = await requestDashboard(token);

    assert.equal(result.status, 404);
    assert.equal(result.body.error?.code, "repo_not_connected");
  });

  it("returns 403 when repo belongs to another user", async () => {
    setRepositoryOwner("acme/demo", USER_A.userId);

    const token = await authHeader(USER_B);
    const result = await requestDashboard(token);

    assert.equal(result.status, 403);
    assert.equal(result.body.error?.code, "repo_not_owned");
  });

  it("returns dashboard summary for a valid owner with indexed metadata", async () => {
    setRepositoryOwner("acme/demo", USER_A.userId);
    setRepositoryIndexed("acme", "demo", INDEX_COUNTS);

    const token = await authHeader(USER_A);
    const result = await requestDashboard(token);

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);

    const data = asRecord(result.body.data);
    assert.equal(data.repository, "acme/demo");

    const metrics = asRecord(data.metrics);
    assert.equal(metrics.files, INDEX_COUNTS.fileCount);
    assert.equal(metrics.chunks, INDEX_COUNTS.chunkCount);
    assert.equal(metrics.symbols, INDEX_COUNTS.symbolCount);
    assert.equal(metrics.graphNodes, INDEX_COUNTS.graphNodeCount);
    assert.equal(metrics.graphEdges, INDEX_COUNTS.graphEdgeCount);

    const status = asRecord(data.status);
    assert.equal(status.repository, "acme/demo");

    const health = asRecord(status.health);
    assert.equal(health.repository, "acme/demo");
    assert.equal(health.indexed, true);
    assert.equal(health.healthy, true);
    assert.equal(health.stale, false);
    assert.equal(health.status, "indexed");
    assert.equal(typeof health.lastIndexedAt, "string");

    const readiness = asRecord(status.readiness);
    assert.equal(readiness.repository, "acme/demo");
    assert.equal(readiness.ready, true);
    assert.equal(readiness.status, "indexed");
    assert.equal(readiness.indexedFiles, INDEX_COUNTS.fileCount);
    assert.equal(readiness.indexedChunks, INDEX_COUNTS.chunkCount);
    assert.equal(typeof readiness.lastIndexedAt, "string");
  });
});
