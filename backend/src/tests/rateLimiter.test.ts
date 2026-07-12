import assert from "node:assert/strict";
import { test } from "node:test";
import { Hono } from "hono";
import { rateLimiter } from "../middleware/rateLimiter.js";
import { setAuthenticatedUser } from "../services/auth/authContext.js";

function createTestApp(options: Parameters<typeof rateLimiter>[0]) {
  const app = new Hono();
  app.use("/limited", async (c, next) => {
    const userId = c.req.header("x-test-user");
    if (userId) setAuthenticatedUser(c, { userId, email: `${userId}@test.dev` });
    await next();
  });
  app.use("/limited", rateLimiter(options));
  app.get("/limited", (c) => c.json({ success: true }));
  app.get("/health", (c) => c.json({ status: "ok" }));
  return app;
}

test("allows requests under the limit and returns rate limit headers", async () => {
  const app = createTestApp({ windowMs: 60_000, maxRequests: 2 });
  const response = await app.request("/limited");

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-RateLimit-Limit"), "2");
  assert.equal(response.headers.get("X-RateLimit-Remaining"), "1");
  assert.equal(response.headers.get("Retry-After"), "60");
});

test("returns a safe 429 response after the limit is exceeded", async () => {
  const app = createTestApp({ windowMs: 60_000, maxRequests: 1 });
  await app.request("/limited");
  const response = await app.request("/limited");
  const body = await response.json() as { error: { code: string; message: string } };

  assert.equal(response.status, 429);
  assert.deepEqual(body.error, {
    code: "rate_limit_exceeded",
    message: "Too many requests. Please try again later.",
  });
  assert.equal(response.headers.get("X-RateLimit-Remaining"), "0");
});

test("resets counters when the configured window expires", async () => {
  let timestamp = 1_000;
  const app = createTestApp({ windowMs: 1_000, maxRequests: 1, now: () => timestamp });
  await app.request("/limited");
  assert.equal((await app.request("/limited")).status, 429);
  timestamp = 2_000;
  assert.equal((await app.request("/limited")).status, 200);
});

test("isolates authenticated users", async () => {
  const app = createTestApp({ windowMs: 60_000, maxRequests: 1 });
  await app.request("/limited", { headers: { "x-test-user": "user-a" } });
  assert.equal((await app.request("/limited", { headers: { "x-test-user": "user-a" } })).status, 429);
  assert.equal((await app.request("/limited", { headers: { "x-test-user": "user-b" } })).status, 200);
});

test("uses the first forwarded IP when no user is authenticated", async () => {
  const app = createTestApp({ windowMs: 60_000, maxRequests: 1 });
  await app.request("/limited", { headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" } });
  assert.equal((await app.request("/limited", { headers: { "x-forwarded-for": "203.0.113.1" } })).status, 429);
  assert.equal((await app.request("/limited", { headers: { "x-forwarded-for": "203.0.113.2" } })).status, 200);
});

test("authenticated user takes priority over forwarded IP", async () => {
  const app = createTestApp({ windowMs: 60_000, maxRequests: 1 });
  await app.request("/limited", { headers: { "x-test-user": "user-a", "x-forwarded-for": "203.0.113.1" } });
  assert.equal((await app.request("/limited", { headers: { "x-test-user": "user-a", "x-forwarded-for": "203.0.113.2" } })).status, 429);
});

test("does not affect routes where middleware is not registered", async () => {
  const app = createTestApp({ windowMs: 60_000, maxRequests: 1 });
  await app.request("/limited");
  await app.request("/limited");
  assert.equal((await app.request("/health")).status, 200);
  assert.equal((await app.request("/health")).headers.get("X-RateLimit-Limit"), null);
});

test("supports a custom key generator", async () => {
  const app = createTestApp({
    windowMs: 60_000,
    maxRequests: 1,
    keyGenerator: (c) => c.req.header("x-api-key") ?? "anonymous",
  });
  await app.request("/limited", { headers: { "x-api-key": "key-a" } });
  assert.equal((await app.request("/limited", { headers: { "x-api-key": "key-a" } })).status, 429);
  assert.equal((await app.request("/limited", { headers: { "x-api-key": "key-b" } })).status, 200);
});

test("supports a custom skip callback and message", async () => {
  const app = createTestApp({
    windowMs: 60_000,
    maxRequests: 1,
    skip: (c) => c.req.header("x-internal") === "true",
    message: "Request limit reached.",
  });
  await app.request("/limited", { headers: { "x-internal": "true" } });
  await app.request("/limited", { headers: { "x-internal": "true" } });
  assert.equal((await app.request("/limited")).status, 200);
  const response = await app.request("/limited");
  assert.equal(response.status, 429);
  assert.equal(((await response.json()) as { error: { message: string } }).error.message, "Request limit reached.");
});
