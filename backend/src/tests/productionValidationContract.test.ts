import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

test("production validation fails before work when PostgreSQL URL is absent", () => {
  const environment = { ...process.env };
  delete environment.GIRO_POSTGRES_TEST_URL;
  const result = spawnSync(process.execPath, ["scripts/require-postgres-validation.mjs"], {
    cwd: root,
    env: environment,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires GIRO_POSTGRES_TEST_URL/);
});

test("local validation is explicitly optional while production forces PostgreSQL", () => {
  const local = manifest.scripts["validate:local"] ?? "";
  const production = manifest.scripts["validate:production"] ?? "";
  assert.match(local, /pnpm test:postgres/);
  assert.match(local, /pnpm verify:migrations/);
  assert.doesNotMatch(local, /require-postgres-validation|GIRO_POSTGRES_INTEGRATION_REQUIRED=1/);
  assert.match(production, /^node scripts\/require-postgres-validation\.mjs/);
  assert.match(production, /GIRO_POSTGRES_INTEGRATION_REQUIRED=1 pnpm test:postgres/);
  assert.match(production, /GIRO_POSTGRES_INTEGRATION_REQUIRED=1 pnpm verify:migrations/);
  for (const command of ["pnpm build", "pnpm typecheck", "pnpm test"]) {
    assert.match(production, new RegExp(command.replace(" ", "\\s+")));
  }
});

test("CI provisions pgvector PostgreSQL and runs every required database gate", () => {
  const workflow = readFileSync(path.join(root, "../.github/workflows/backend-ci.yml"), "utf8");
  assert.match(workflow, /image: pgvector\/pgvector:pg16/);
  assert.match(workflow, /pg_isready/);
  assert.match(workflow, /POSTGRES_DB: giro_test_admin/);
  assert.match(workflow, /GIRO_POSTGRES_INTEGRATION_REQUIRED: "1"/);
  assert.match(workflow, /run: pnpm test:postgres/);
  assert.match(workflow, /run: pnpm verify:migrations/);
  assert.match(workflow, /run: pnpm validate:production/);
  assert.doesNotMatch(workflow, /prod(?:uction)?[-_].*(?:password|key|url)/i);
});
