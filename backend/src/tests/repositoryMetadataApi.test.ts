import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../app.js";
import { MetricsRegistry } from "../observability/metrics.js";
import { signAccessToken } from "../services/auth/jwt.js";
import {
  publicRepositoryMetadata,
  REPOSITORY_METADATA_API_ROUTES,
  verifyRepositoryMetadataApiContracts,
} from "../services/repositoryMetadataApi/contracts.js";
import {
  RepositoryMetadataApiService,
} from "../services/repositoryMetadataApi/service.js";
import {
  MemoryRateLimitStore,
} from "../services/rateLimit/memoryRateLimitStore.js";
import {
  repositoryRecordToRow,
  repositoryRowToRecord,
} from "../services/repository/store/repositoryPersistenceMapper.js";
import {
  MemoryRepositoryStore,
} from "../services/repository/store/memoryRepositoryStore.js";

const USER = { userId: "metadata-api-user", email: "metadata@example.com" };
const OTHER = { userId: "metadata-api-other", email: "other@example.com" };
const REVISION = "a".repeat(40);
const NEXT_REVISION = "b".repeat(40);
const COUNTS = {
  chunkCount: 2,
  fileCount: 3,
  symbolCount: 4,
  graphNodeCount: 5,
  graphEdgeCount: 6,
  summaryAvailable: true,
};

async function fixture() {
  const store = new MemoryRepositoryStore();
  const metrics = new MetricsRegistry();
  const service = new RepositoryMetadataApiService(store, metrics);
  const app = createApp({
    metrics,
    repositoryMetadataApiService: service,
    rateLimitStore: new MemoryRateLimitStore(),
  });
  const token = await signAccessToken(USER);
  const otherToken = await signAccessToken(OTHER);
  return {
    app,
    store,
    service,
    metrics,
    headers: { Authorization: `Bearer ${token}` },
    otherHeaders: { Authorization: `Bearer ${otherToken}` },
  };
}

function connect(
  store: MemoryRepositoryStore,
  owner: string,
  repository: string,
  ownerUserId = USER.userId,
) {
  return store.connectRepository({ owner, repo: repository, ownerUserId });
}

test("versioned listing returns every owned lifecycle with gateway metadata",
  async () => {
    const f = await fixture();
    connect(f.store, "acme", "queued");
    connect(f.store, "acme", "indexing");
    f.store.markIndexing("acme/indexing");
    connect(f.store, "acme", "indexed");
    f.store.markIndexed("acme/indexed", {
      counts: COUNTS,
      indexedRevision: REVISION,
    });
    f.store.touchAccess("acme/indexed");
    connect(f.store, "acme", "stale");
    f.store.markIndexed("acme/stale", {
      counts: COUNTS,
      indexedRevision: REVISION,
    });
    f.store.updateRepository("acme/stale", { status: "stale" });
    connect(f.store, "acme", "failed");
    f.store.markFailed("acme/failed", { reason: "clone_failed" });
    connect(f.store, "private", "hidden", OTHER.userId);

    const response = await f.app.request("/api/v1/repositories", {
      headers: f.headers,
    });
    const body = await response.json() as any;
    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.count, 5);
    assert.deepEqual(
      body.data.repositories.map((item: any) => item.status),
      ["failed", "indexed", "indexing", "queued", "stale"],
    );
    const indexed = body.data.repositories.find(
      (item: any) => item.repository === "indexed",
    );
    assert.equal(indexed.repositoryId, "acme/indexed");
    assert.equal(indexed.repo, "indexed");
    assert.equal(indexed.displayName, "indexed");
    assert.equal(indexed.currentRevision, REVISION);
    assert.equal(indexed.indexedRevision, REVISION);
    assert.equal(indexed.publishedRevision, REVISION);
    assert.equal(indexed.revisionConsistent, true);
    assert.equal(indexed.gatewayCompatible, true);
    assert.equal(indexed.isStale, false);
    assert.equal(typeof indexed.createdAt, "string");
    assert.equal(typeof indexed.updatedAt, "string");
    assert.equal(typeof indexed.lastIndexedAt, "string");
    assert.equal(typeof indexed.lastAccessedAt, "string");
    for (const blocked of [
      "ownerUserId", "persistenceVersion", "deletionState",
      "publishingRevision", "previousRevision", "failureReason",
    ]) assert.equal(blocked in indexed, false, blocked);
  });

test("metadata detail is authenticated, validated, and ownership fenced",
  async () => {
    const f = await fixture();
    connect(f.store, "acme", "widgets");
    f.store.markIndexed("acme/widgets", {
      counts: COUNTS,
      indexedRevision: REVISION,
    });

    const detail = await f.app.request(
      "/api/v1/repositories/acme/widgets",
      { headers: f.headers },
    );
    const detailBody = await detail.json() as any;
    assert.equal(detail.status, 200);
    assert.equal(detailBody.data.repository.repositoryId, "acme/widgets");
    assert.equal(detailBody.data.repository.publishedRevision, REVISION);

    const forbidden = await f.app.request(
      "/api/v1/repositories/acme/widgets",
      { headers: f.otherHeaders },
    );
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json() as any).data, undefined);

    const missing = await f.app.request(
      "/api/v1/repositories/acme/missing",
      { headers: f.headers },
    );
    assert.equal(missing.status, 404);

    const invalid = await f.app.request(
      "/api/v1/repositories/-invalid/widgets",
      { headers: f.headers },
    );
    assert.equal(invalid.status, 400);

    const unauthenticated = await f.app.request(
      "/api/v1/repositories/acme/widgets",
    );
    assert.equal(unauthenticated.status, 401);
  });

test("revision consistency exposes stale detection without changing lifecycle",
  async () => {
    const f = await fixture();
    connect(f.store, "acme", "widgets");
    f.store.markIndexed("acme/widgets", {
      counts: COUNTS,
      indexedRevision: REVISION,
    });
    f.store.updateRepository("acme/widgets", {
      currentRevision: NEXT_REVISION,
    });
    const response = await f.app.request(
      "/api/v1/repositories/acme/widgets",
      { headers: f.headers },
    );
    const metadata = (await response.json() as any).data.repository;
    assert.equal(response.status, 200);
    assert.equal(metadata.status, "indexed");
    assert.equal(metadata.currentRevision, NEXT_REVISION);
    assert.equal(metadata.indexedRevision, REVISION);
    assert.equal(metadata.publishedRevision, null);
    assert.equal(metadata.revisionConsistent, false);
    assert.equal(metadata.gatewayCompatible, false);
    assert.equal(metadata.isStale, true);
  });

test("invalid stored revisions fail closed and increment failure metrics",
  async () => {
    const f = await fixture();
    connect(f.store, "acme", "widgets");
    f.store.updateRepository("acme/widgets", {
      currentRevision: "short",
      indexedRevision: "short",
    });
    const response = await f.app.request("/api/v1/repositories", {
      headers: f.headers,
    });
    const body = await response.json() as any;
    assert.equal(response.status, 500);
    assert.equal(body.error.code, "repository_metadata_revision_invalid");
    assert.match(
      f.metrics.render(),
      /giro_repository_metadata_api_operations_total\{operation="failure"\} 1/,
    );
  });

test("metrics, startup contracts, and memory/PostgreSQL mapping are equivalent",
  async () => {
    const f = await fixture();
    const record = connect(f.store, "acme", "widgets");
    const persisted = repositoryRowToRecord(repositoryRecordToRow(record));
    assert.deepEqual(
      publicRepositoryMetadata(persisted),
      publicRepositoryMetadata(record),
    );
    await f.app.request("/api/v1/repositories", { headers: f.headers });
    await f.app.request("/api/v1/repositories/acme/widgets", {
      headers: f.headers,
    });
    const rendered = f.metrics.render();
    assert.match(rendered,
      /giro_repository_metadata_api_operations_total\{operation="listing"\} 1/);
    assert.match(rendered,
      /giro_repository_metadata_api_operations_total\{operation="lookup"\} 1/);
    assert.equal(REPOSITORY_METADATA_API_ROUTES.length, 2);
    verifyRepositoryMetadataApiContracts(f.store);
    assert.throws(
      () => verifyRepositoryMetadataApiContracts({} as never),
      /repository_metadata_api_dependency_missing/,
    );
  });
