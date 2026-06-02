// Heuristic detectors for database, auth, queue, testing, and infra technologies.
// All operate on a dependency name set + top-level file set. Pure & deterministic.

interface Signals {
  deps: Set<string>;
  files: Set<string>;
}

function matchDeps(deps: Set<string>, table: Array<[string, string]>): string[] {
  const found = new Set<string>();
  for (const [dep, label] of table) {
    if (deps.has(dep)) found.add(label);
  }
  return [...found];
}

const DB_DEPS: Array<[string, string]> = [
  ["pg", "postgresql"],
  ["postgres", "postgresql"],
  ["@supabase/supabase-js", "supabase"],
  ["prisma", "prisma"],
  ["@prisma/client", "prisma"],
  ["mongoose", "mongodb"],
  ["mongodb", "mongodb"],
  ["mysql", "mysql"],
  ["mysql2", "mysql"],
  ["redis", "redis"],
  ["ioredis", "redis"],
  ["drizzle-orm", "drizzle"],
  ["sqlite3", "sqlite"],
  ["better-sqlite3", "sqlite"],
  ["typeorm", "typeorm"],
];

const AUTH_DEPS: Array<[string, string]> = [
  ["next-auth", "next-auth"],
  ["@auth/core", "auth.js"],
  ["passport", "passport"],
  ["jsonwebtoken", "jwt"],
  ["jose", "jwt"],
  ["@clerk/nextjs", "clerk"],
  ["@clerk/clerk-sdk-node", "clerk"],
  ["firebase-admin", "firebase-auth"],
  ["bcrypt", "bcrypt"],
  ["bcryptjs", "bcrypt"],
  ["lucia", "lucia"],
];

const QUEUE_DEPS: Array<[string, string]> = [
  ["bullmq", "bullmq"],
  ["bull", "bull"],
  ["bee-queue", "bee-queue"],
  ["agenda", "agenda"],
  ["kafkajs", "kafka"],
  ["amqplib", "rabbitmq"],
  ["@google-cloud/pubsub", "pubsub"],
];

const TEST_DEPS: Array<[string, string]> = [
  ["jest", "jest"],
  ["vitest", "vitest"],
  ["mocha", "mocha"],
  ["@playwright/test", "playwright"],
  ["cypress", "cypress"],
  ["ava", "ava"],
  ["tap", "tap"],
];

const INFRA_FILES: Array<[string, string]> = [
  ["Dockerfile", "docker"],
  ["docker-compose.yml", "docker-compose"],
  ["docker-compose.yaml", "docker-compose"],
  ["vercel.json", "vercel"],
  ["fly.toml", "fly.io"],
  ["railway.json", "railway"],
  ["render.yaml", "render"],
  ["serverless.yml", "serverless"],
  ["kubernetes.yaml", "kubernetes"],
  ["terraform.tf", "terraform"],
];

export function detectDatabases(s: Signals): string[] {
  return matchDeps(s.deps, DB_DEPS);
}

export function detectAuth(s: Signals): string[] {
  return matchDeps(s.deps, AUTH_DEPS);
}

export function detectQueues(s: Signals): string[] {
  return matchDeps(s.deps, QUEUE_DEPS);
}

export function detectTesting(s: Signals): string[] {
  return matchDeps(s.deps, TEST_DEPS);
}

export function detectInfrastructure(s: Signals): string[] {
  const found = new Set<string>();
  for (const [file, label] of INFRA_FILES) {
    if (s.files.has(file)) found.add(label);
  }
  return [...found];
}
