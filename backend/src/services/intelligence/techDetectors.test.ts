// Tests for heuristic tech detection. Run with: pnpm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectDatabases,
  detectAuth,
  detectQueues,
  detectTesting,
  detectInfrastructure,
} from "./techDetectors.js";
import { classifyArchitecture } from "./architecture.js";
import { scoreDirectories } from "./directoryScoring.js";

const sig = (deps: string[], files: string[] = []) => ({
  deps: new Set(deps),
  files: new Set(files),
});

test("detectDatabases maps known deps and dedupes", () => {
  assert.deepEqual(detectDatabases(sig(["pg"])), ["postgresql"]);
  assert.deepEqual(detectDatabases(sig(["prisma", "@prisma/client"])), ["prisma"]);
  assert.deepEqual(detectDatabases(sig(["@supabase/supabase-js"])), ["supabase"]);
  assert.deepEqual(detectDatabases(sig([])), []);
});

test("detectAuth recognizes auth libraries", () => {
  assert.deepEqual(detectAuth(sig(["jsonwebtoken"])), ["jwt"]);
  assert.deepEqual(detectAuth(sig(["next-auth"])), ["next-auth"]);
  assert.ok(detectAuth(sig(["@clerk/nextjs"])).includes("clerk"));
});

test("detectQueues recognizes job queues", () => {
  assert.deepEqual(detectQueues(sig(["bullmq"])), ["bullmq"]);
  assert.deepEqual(detectQueues(sig(["kafkajs"])), ["kafka"]);
  assert.deepEqual(detectQueues(sig(["express"])), []);
});

test("detectTesting recognizes test frameworks", () => {
  assert.deepEqual(detectTesting(sig(["vitest"])), ["vitest"]);
  assert.deepEqual(detectTesting(sig(["jest", "@playwright/test"])).sort(), [
    "jest",
    "playwright",
  ]);
});

test("detectInfrastructure reads top-level files", () => {
  assert.deepEqual(detectInfrastructure(sig([], ["Dockerfile"])), ["docker"]);
  assert.ok(detectInfrastructure(sig([], ["fly.toml"])).includes("fly.io"));
  assert.deepEqual(detectInfrastructure(sig([], ["README.md"])), []);
});

test("classifyArchitecture prioritizes monorepo then fullstack", () => {
  assert.equal(
    classifyArchitecture({
      monorepo: true, hasBackend: true, hasFrontend: true,
      hasBin: false, isLibrary: false, entrypointCount: 1,
    }),
    "monorepo",
  );
  assert.equal(
    classifyArchitecture({
      monorepo: false, hasBackend: true, hasFrontend: true,
      hasBin: false, isLibrary: false, entrypointCount: 2,
    }),
    "fullstack",
  );
  assert.equal(
    classifyArchitecture({
      monorepo: false, hasBackend: true, hasFrontend: false,
      hasBin: false, isLibrary: false, entrypointCount: 1,
    }),
    "backend-api",
  );
});

test("scoreDirectories ranks routes/services highest and caps at 15", () => {
  const scored = scoreDirectories([
    "src/routes", "src/services", "src/components", "node_modules", "tests",
  ]);
  assert.equal(scored[0]?.path, "src/routes");
  assert.equal(scored[1]?.path, "src/services");
  assert.ok(scored.every((s) => s.path !== "node_modules"));
  assert.ok(scored.length <= 15);
});
