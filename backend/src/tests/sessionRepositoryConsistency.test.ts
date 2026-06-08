import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.js";
import { signAccessToken } from "../services/auth/jwt.js";
import { clearAllSessions } from "../services/sessions/store.js";
import {
  setRepositoryOwner,
  clearRepositoryOwners,
} from "../services/repository/ownershipStore.js";
import { requireSessionRepositoryOwnership } from "../services/sessions/sessionRepositoryGuard.js";

const USER_A = { userId: "user-a", email: "a@example.com" };
const USER_B = { userId: "user-b", email: "b@example.com" };

const TOKEN_A = `Bearer ${await signAccessToken(USER_A)}`;
const TOKEN_B = `Bearer ${await signAccessToken(USER_B)}`;

type ApiResponse = {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
};

function asRecord(v: unknown): Record<string, unknown> {
  assert.ok(v && typeof v === "object", "expected object");
  return v as Record<string, unknown>;
}

async function call(method: string, path: string, authorization?: string, body?: unknown) {
  const app = createApp();
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authorization) headers.authorization = authorization;
  const res = await app.fetch(
    new Request("http://local" + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
  const json = (await res.json().catch(() => ({}))) as ApiResponse;
  return { status: res.status, json };
}

beforeEach(() => {
  clearAllSessions();
  clearRepositoryOwners();
});

// --- guard unit ---
test("1. guard: owned repo -> ok", () => {
  setRepositoryOwner("acme/demo", USER_A.userId);
  const r = requireSessionRepositoryOwnership({ owner: "acme", repo: "demo", userId: USER_A.userId });
  assert.equal(r.ok, true);
});

test("2. guard: unowned/unknown repo -> 404 repo_not_connected", () => {
  const r = requireSessionRepositoryOwnership({ owner: "ghost", repo: "missing", userId: USER_A.userId });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 404);
    assert.equal(r.code, "repo_not_connected");
  }
});

test("3. guard: repo owned by another user -> 403 repo_not_owned", () => {
  setRepositoryOwner("acme/demo", USER_A.userId);
  const r = requireSessionRepositoryOwnership({ owner: "acme", repo: "demo", userId: USER_B.userId });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 403);
    assert.equal(r.code, "repo_not_owned");
  }
});

// --- POST /sessions enforcement ---
test("4. create session for owned repo -> 201", async () => {
  setRepositoryOwner("acme/demo", USER_A.userId);
  const { status } = await call("POST", "/sessions", TOKEN_A, { owner: "acme", repo: "demo" });
  assert.equal(status, 201);
});

test("5. create session for unconnected repo -> 404 repo_not_connected", async () => {
  const { status, json } = await call("POST", "/sessions", TOKEN_A, { owner: "ghost", repo: "missing" });
  assert.equal(status, 404);
  assert.equal(json.error?.code, "repo_not_connected");
});

test("6. create session for another user's repo -> 403 repo_not_owned", async () => {
  setRepositoryOwner("acme/demo", USER_A.userId);
  // USER_B tries to open a session against USER_A's repo.
  const { status, json } = await call("POST", "/sessions", TOKEN_B, { owner: "acme", repo: "demo" });
  assert.equal(status, 403);
  assert.equal(json.error?.code, "repo_not_owned");
});

// --- POST /sessions/:id/ask enforcement ---
test("7. ask reaches handler when user still owns the session's repo", async () => {
  setRepositoryOwner("acme/demo", USER_A.userId);
  const created = await call("POST", "/sessions", TOKEN_A, { owner: "acme", repo: "demo" });
  const id = asRecord(created.json.data).id as string;

  const { status } = await call("POST", `/sessions/${id}/ask`, TOKEN_A, { question: "explain" });
  // Repo not cloned locally -> degrades, but repo-ownership consistency passed.
  assert.notEqual(status, 401);
  assert.notEqual(status, 403);
  assert.notEqual(status, 404);
});

test("8. ask blocked if repo ownership is revoked after session creation", async () => {
  setRepositoryOwner("acme/demo", USER_A.userId);
  const created = await call("POST", "/sessions", TOKEN_A, { owner: "acme", repo: "demo" });
  const id = asRecord(created.json.data).id as string;

  // Repository ownership is reassigned to another user.
  setRepositoryOwner("acme/demo", USER_B.userId);

  const { status, json } = await call("POST", `/sessions/${id}/ask`, TOKEN_A, { question: "explain" });
  assert.equal(status, 403);
  assert.equal(json.error?.code, "repo_not_owned");
});

test("9. ask blocked if repo becomes unconnected after session creation", async () => {
  setRepositoryOwner("acme/demo", USER_A.userId);
  const created = await call("POST", "/sessions", TOKEN_A, { owner: "acme", repo: "demo" });
  const id = asRecord(created.json.data).id as string;

  clearRepositoryOwners(); // repo no longer connected

  const { status, json } = await call("POST", `/sessions/${id}/ask`, TOKEN_A, { question: "explain" });
  assert.equal(status, 404);
  assert.equal(json.error?.code, "repo_not_connected");
});
