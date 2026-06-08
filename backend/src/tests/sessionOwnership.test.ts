import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../app.js";
import { signAccessToken } from "../services/auth/jwt.js";
import { clearAllSessions } from "../services/sessions/store.js";
import { createNewSession } from "../services/sessions/sessionService.js";
import { requireSessionAccess } from "../services/sessions/sessionOwnershipGuard.js";
import {
  setRepositoryOwner,
  clearRepositoryOwners,
} from "../services/repository/ownershipStore.js";

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

async function call(
  method: string,
  path: string,
  authorization?: string,
  body?: unknown,
) {
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

async function createSession(
  authorization: string,
  owner = "acme",
  repo = "demo",
): Promise<string> {
  const { json } = await call("POST", "/sessions", authorization, { owner, repo });
  return asRecord(json.data).id as string;
}

beforeEach(() => {
  clearAllSessions();
  clearRepositoryOwners();
  // A session may only target a repository owned by the creating user, so
  // register repository ownership for the repos these tests exercise.
  setRepositoryOwner("acme/demo", USER_A.userId);
  setRepositoryOwner("acme/one", USER_A.userId);
  setRepositoryOwner("acme/two", USER_A.userId);
  setRepositoryOwner("beta/solo", USER_B.userId);
});

// --- 1. Creation ---
test("1. authed user creates a session (201) with matching userId", async () => {
  const { status, json } = await call("POST", "/sessions", TOKEN_A, {
    owner: "acme",
    repo: "demo",
  });
  assert.equal(status, 201);
  assert.equal(json.success, true);
  const data = asRecord(json.data);
  assert.equal(typeof data.id, "string");
  assert.equal(data.userId, USER_A.userId);
});

// --- 2. Listing ---
test("2. list returns only the requesting user's sessions", async () => {
  await createSession(TOKEN_A, "acme", "one");
  await createSession(TOKEN_A, "acme", "two");
  await createSession(TOKEN_B, "beta", "solo");

  const { json } = await call("GET", "/sessions", TOKEN_A);
  const data = asRecord(json.data);
  const sessions = data.sessions as Array<Record<string, unknown>>;
  assert.equal(data.count, 2);
  assert.equal(sessions.length, 2);
  assert.ok(sessions.every((s) => s.userId === USER_A.userId));
});

// --- 3. Read ---
test("3a. owner can read their session (200)", async () => {
  const id = await createSession(TOKEN_A);
  const { status, json } = await call("GET", `/sessions/${id}`, TOKEN_A);
  assert.equal(status, 200);
  assert.equal(asRecord(json.data).id, id);
});

test("3b. other user reading is 403 session_not_owned", async () => {
  const id = await createSession(TOKEN_A);
  const { status, json } = await call("GET", `/sessions/${id}`, TOKEN_B);
  assert.equal(status, 403);
  assert.equal(json.error?.code, "session_not_owned");
});

test("3c. missing session id is 404 session_not_found", async () => {
  const { status, json } = await call("GET", "/sessions/does-not-exist", TOKEN_A);
  assert.equal(status, 404);
  assert.equal(json.error?.code, "session_not_found");
});

// --- 4. Messages ---
test("4a. owner adds a message (200) and response contains it", async () => {
  const id = await createSession(TOKEN_A);
  const { status, json } = await call("POST", `/sessions/${id}/messages`, TOKEN_A, {
    role: "user",
    content: "hello",
  });
  assert.equal(status, 200);
  const messages = asRecord(json.data).messages as Array<Record<string, unknown>>;
  const last = messages[messages.length - 1];
  assert.equal(last?.role, "user");
  assert.equal(last?.content, "hello");
});

test("4b. other user adding a message is 403", async () => {
  const id = await createSession(TOKEN_A);
  const { status, json } = await call("POST", `/sessions/${id}/messages`, TOKEN_B, {
    role: "user",
    content: "intrude",
  });
  assert.equal(status, 403);
  assert.equal(json.error?.code, "session_not_owned");
});

// --- 5. Ask ---
test("5a. owner reaches ask handler (not 401/403)", async () => {
  const id = await createSession(TOKEN_A);
  const { status } = await call("POST", `/sessions/${id}/ask`, TOKEN_A, {
    question: "what does this repo do?",
  });
  // Repo is not cloned locally -> ask degrades gracefully or errors downstream,
  // but ownership/auth must have passed (never 401/403).
  assert.notEqual(status, 401);
  assert.notEqual(status, 403);
});

test("5b. other user asking is 403", async () => {
  const id = await createSession(TOKEN_A);
  const { status, json } = await call("POST", `/sessions/${id}/ask`, TOKEN_B, {
    question: "leak please",
  });
  assert.equal(status, 403);
  assert.equal(json.error?.code, "session_not_owned");
});

// --- 6. Delete ---
test("6a. owner deletes session (200 { id, deleted:true })", async () => {
  const id = await createSession(TOKEN_A);
  const { status, json } = await call("DELETE", `/sessions/${id}`, TOKEN_A);
  assert.equal(status, 200);
  const data = asRecord(json.data);
  assert.equal(data.id, id);
  assert.equal(data.deleted, true);
});

test("6b. other user deleting is 403", async () => {
  const id = await createSession(TOKEN_A);
  const { status, json } = await call("DELETE", `/sessions/${id}`, TOKEN_B);
  assert.equal(status, 403);
  assert.equal(json.error?.code, "session_not_owned");
});

test("6c. deleted session is 404 on re-read", async () => {
  const id = await createSession(TOKEN_A);
  await call("DELETE", `/sessions/${id}`, TOKEN_A);
  const { status, json } = await call("GET", `/sessions/${id}`, TOKEN_A);
  assert.equal(status, 404);
  assert.equal(json.error?.code, "session_not_found");
});

// --- 7. requireSessionAccess direct unit ---
test("7a. requireSessionAccess: owner -> ok true", () => {
  const session = createNewSession({ userId: USER_A.userId, owner: "acme", repo: "demo" });
  const r = requireSessionAccess({ sessionId: session.id, userId: USER_A.userId });
  assert.equal(r.ok, true);
});

test("7b. requireSessionAccess: wrong owner -> 403", () => {
  const session = createNewSession({ userId: USER_A.userId, owner: "acme", repo: "demo" });
  const r = requireSessionAccess({ sessionId: session.id, userId: USER_B.userId });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 403);
    assert.equal(r.code, "session_not_owned");
  }
});

test("7c. requireSessionAccess: missing -> 404", () => {
  const r = requireSessionAccess({ sessionId: "nope", userId: USER_A.userId });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 404);
    assert.equal(r.code, "session_not_found");
  }
});

// --- 8. Auth ---
test("8a. no Authorization header -> 401 unauthorized", async () => {
  const { status, json } = await call("GET", "/sessions");
  assert.equal(status, 401);
  assert.equal(json.error?.code, "unauthorized");
});

test("8b. garbage token -> 401 invalid_token", async () => {
  const { status, json } = await call("GET", "/sessions", "Bearer not.a.jwt");
  assert.equal(status, 401);
  assert.equal(json.error?.code, "invalid_token");
});

test("8c. valid JWT reaches ownership checks (not 401)", async () => {
  const id = await createSession(TOKEN_A);
  const { status } = await call("GET", `/sessions/${id}`, TOKEN_A);
  assert.notEqual(status, 401);
  assert.ok(status === 200 || status === 403 || status === 404);
});
