import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { MetricsRegistry } from "../observability/metrics.js";
import { SemanticAdapterRegistry } from "../services/semanticCodeIntelligence/adapter.js";
import {
  buildSemanticGraph,
  deterministicSemanticSymbolId,
  SemanticNavigator,
} from "../services/semanticCodeIntelligence/engine.js";
import {
  MemorySemanticCodeIntelligenceStore,
  PostgresSemanticCodeIntelligenceStore,
} from "../services/semanticCodeIntelligence/store.js";
import type {
  BuildSemanticGraphInput,
  SemanticGraph,
} from "../services/semanticCodeIntelligence/types.js";
import {
  SemanticCodeIntelligenceError,
} from "../services/semanticCodeIntelligence/types.js";
import { validateSemanticGraph } from "../services/semanticCodeIntelligence/validation.js";

const revisionA = "a".repeat(40);
const revisionB = "b".repeat(40);
const timestamp = "2026-08-21T00:00:00.000Z";

function input(
  overrides: Partial<BuildSemanticGraphInput> = {},
): BuildSemanticGraphInput {
  return {
    tenantId: "tenant-1",
    ownerId: "user-1",
    repositoryOwnerId: "user-1",
    repositoryId: "acme/widgets",
    repositoryRevision: revisionA,
    snapshotRevision: revisionA,
    indexedAt: timestamp,
    files: [
      {
        file: "src/contracts.ts",
        content: `
          /** runnable contract */
          export interface Runnable { run(): void }
          export class Base {
            work(): void {}
          }
        `,
      },
      {
        file: "src/worker.ts",
        content: `
          import { Base, Runnable } from "./contracts.js";
          export class Worker extends Base implements Runnable {
            work(): void { helper(); }
            run(): void { this.work(); }
          }
          export function helper(): void {}
        `,
      },
    ],
    ...overrides,
  };
}

test("semantic IDs and graph output are deterministic", () => {
  const first = buildSemanticGraph(input());
  const second = buildSemanticGraph(input());
  assert.deepEqual(second, first);
  assert.equal(deterministicSemanticSymbolId({
    repositoryId: "acme/widgets",
    repositoryRevision: revisionA,
    file: "src/a.ts",
    language: "typescript",
    kind: "class",
    qualifiedName: "A",
    line: 1,
    column: 1,
  }), deterministicSemanticSymbolId({
    repositoryId: "acme/widgets",
    repositoryRevision: revisionA,
    file: "src/a.ts",
    language: "typescript",
    kind: "class",
    qualifiedName: "A",
    line: 1,
    column: 1,
  }));
  assert.ok(first.symbols.every((symbol) =>
    symbol.signature.length > 0 && symbol.documentationHash.length === 64));
  assert.ok(first.symbols.some((symbol) => symbol.kind === "import"));
  const exported = new SemanticAdapterRegistry().forFile("src/index.ts")?.analyze(
    "src/index.ts", 'export { Worker } from "./worker.js";',
  );
  assert.ok(exported?.symbols.some((symbol) =>
    symbol.kind === "export" && symbol.visibility === "public"));
});

test("cross-file inheritance, implementation, reference, override, and call edges navigate", () => {
  const graph = buildSemanticGraph(input());
  validateSemanticGraph(graph);
  const kinds = new Set(graph.relationships.map((edge) => edge.kind));
  for (const kind of [
    "extends", "inherited_by", "implements", "implemented_by",
    "calls", "called_by", "references", "referenced_by",
    "overrides", "overridden_by", "imports", "imported_by",
  ]) assert.ok(kinds.has(kind as never), `missing ${kind}`);

  const navigation = new SemanticNavigator(graph);
  assert.deepEqual(
    navigation.implementations("Runnable").symbols.map((item) => item.name),
    ["Worker"],
  );
  assert.ok(navigation.callers("helper").symbols.some((item) => item.name === "work"));
  assert.ok(navigation.callees("work").symbols.some((item) => item.name === "helper"));
  assert.ok(navigation.inheritanceChain("Worker").symbols.some(
    (item) => item.name === "Base"));
  assert.ok(navigation.dependencyChain("src/worker.ts").symbols.some(
    (item) => item.file === "src/contracts.ts"));
});

test("incremental indexing reuses unchanged analyses and parses only changed files", () => {
  const first = buildSemanticGraph(input());
  const changedFiles = input().files.map((file) => file.file === "src/worker.ts"
    ? { ...file, content: `${file.content}\nexport const changed = true;` }
    : file);
  const next = buildSemanticGraph(input({
    repositoryRevision: revisionB,
    snapshotRevision: revisionB,
    previousGraph: first,
    files: changedFiles,
  }));
  assert.equal(next.metrics.graphRebuilds, 0);
  assert.equal(next.metrics.incrementalUpdates, 1);
  assert.strictEqual(
    next.fileAnalyses.find((item) => item.file === "src/contracts.ts"),
    first.fileAnalyses.find((item) => item.file === "src/contracts.ts"),
  );
  assert.notEqual(next.graphVersion, first.graphVersion);
});

test("ownership, revision consistency, adapter compatibility, and integrity are enforced", () => {
  assert.throws(() => buildSemanticGraph(input({
    repositoryOwnerId: "user-2",
  })), (error: unknown) => error instanceof SemanticCodeIntelligenceError &&
    error.code === "semantic_repository_access_denied");
  assert.throws(() => buildSemanticGraph(input({
    snapshotRevision: revisionB,
  })), (error: unknown) => error instanceof SemanticCodeIntelligenceError &&
    error.code === "semantic_repository_access_denied");
  assert.doesNotThrow(() => new SemanticAdapterRegistry().verify());
  const graph = buildSemanticGraph(input());
  assert.throws(() => validateSemanticGraph({
    ...graph,
    relationships: [{
      ...graph.relationships[0]!,
      toSymbolId: "missing",
    }],
  }), (error: unknown) => error instanceof SemanticCodeIntelligenceError &&
    error.code === "semantic_graph_integrity_invalid");
});

test("memory recovery fences interrupted builds and removes stale graph entries", async () => {
  const graph = buildSemanticGraph(input());
  const store = new MemorySemanticCodeIntelligenceStore();
  store.hydrate({
    ...graph,
    lifecycle: "building",
    publishedAt: null,
  });
  assert.equal(await store.recover(), 1);
  const metrics = await store.metrics("tenant-1");
  assert.equal(metrics.recoveryOperations, 1);
  assert.equal(await store.get(
    "tenant-1", "user-1", "acme/widgets", revisionA,
  ), null);

  const orphan = {
    ...graph.symbols[0]!,
    symbolId: "orphan",
    file: "removed.ts",
  };
  const staleStore = new MemorySemanticCodeIntelligenceStore();
  staleStore.hydrate({
    ...graph,
    symbols: [...graph.symbols, orphan],
    relationships: [...graph.relationships, {
      ...graph.relationships[0]!,
      relationshipId: "stale",
      fromSymbolId: orphan.symbolId,
    }],
  });
  assert.equal(await staleStore.recover(), 1);
  const recovered = await staleStore.get(
    "tenant-1", "user-1", "acme/widgets", revisionA,
  );
  assert.ok(recovered);
  assert.equal(recovered.symbols.some((item) => item.symbolId === "orphan"), false);
  assert.equal(recovered.relationships.some((item) =>
    item.relationshipId === "stale"), false);
});

class FakeSemanticDatabase {
  graph: SemanticGraph | null = null;
  readonly calls: string[] = [];

  async rpc(name: string, parameters: Record<string, unknown> = {}) {
    this.calls.push(name);
    let data: unknown;
    if (name === "save_semantic_code_graph") {
      this.graph = structuredClone(parameters.input_graph as SemanticGraph);
      data = this.graph;
    } else if (name === "get_semantic_code_graph") {
      data = this.graph;
    } else if (name === "semantic_code_graph_metrics") {
      data = this.graph?.metrics ?? {
        indexedSymbols: 0, indexedRelationships: 0, indexingDurationMs: 0,
        graphRebuilds: 0, incrementalUpdates: 0, recoveryOperations: 0,
      };
    } else if (name === "verify_semantic_code_graph_contract") {
      data = [{ valid: true, problems: [] }];
    } else data = 0;
    return { data, error: null };
  }
}

test("memory and PostgreSQL adapters preserve equivalent deterministic graph state", async () => {
  const graph = buildSemanticGraph(input());
  const memory = new MemorySemanticCodeIntelligenceStore();
  const database = new FakeSemanticDatabase();
  const postgres = new PostgresSemanticCodeIntelligenceStore(database as never);
  const memorySaved = await memory.save(graph);
  const postgresSaved = await postgres.save(graph);
  assert.deepEqual(postgresSaved, memorySaved);
  assert.deepEqual(await postgres.get(
    "tenant-1", "user-1", "acme/widgets", revisionA,
  ), await memory.get("tenant-1", "user-1", "acme/widgets", revisionA));
  await assert.doesNotReject(() => postgres.verify());
  assert.ok(database.calls.includes("verify_semantic_code_graph_contract"));
});

test("semantic metrics render all required operational counters", () => {
  const registry = new MetricsRegistry({
    processStartTimeSeconds: 0,
    uptimeSeconds: () => 1,
  });
  registry.recordSemanticCodeIntelligence({
    indexedSymbols: 3,
    indexedRelationships: 4,
    indexingDurationMs: 5,
    graphRebuilds: 1,
    incrementalUpdates: 2,
    recoveryOperations: 1,
  });
  const rendered = registry.render();
  for (const metric of [
    "giro_semantic_indexed_symbols",
    "giro_semantic_indexed_relationships",
    "giro_semantic_indexing_duration_ms_total",
    "giro_semantic_graph_rebuilds_total",
    "giro_semantic_incremental_updates_total",
    "giro_semantic_recovery_operations_total",
  ]) assert.match(rendered, new RegExp(metric));
});

test("migration defines semantic schema, indexes, constraints, RLS, grants, and retention", async () => {
  const migration = await readFile(new URL(
    "../../supabase/migrations/20260821000000_add_semantic_code_intelligence.sql",
    import.meta.url,
  ), "utf8");
  for (const table of [
    "semantic_graph_versions",
    "semantic_symbols",
    "semantic_edges",
    "semantic_language_metadata",
    "semantic_indexing_diagnostics",
    "semantic_graph_retention",
  ]) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  for (const contract of [
    "semantic_symbols_definition_idx",
    "semantic_edges_from_kind_idx",
    "semantic_edge_from_symbol_fk",
    "semantic_edge_to_symbol_fk",
    "recover_semantic_code_graphs",
    "collect_semantic_code_graphs",
    "verify_semantic_code_graph_contract",
    "enable row level security",
    "grant execute on function public.save_semantic_code_graph",
    "on delete cascade",
  ]) assert.match(migration, new RegExp(contract));
});

test("semantic engine has no execution, Git, process, or network capability", async () => {
  const sources = await Promise.all([
    "adapter.ts", "engine.ts", "service.ts", "store.ts",
  ].map((file) => readFile(new URL(
    `../services/semanticCodeIntelligence/${file}`, import.meta.url,
  ), "utf8")));
  const joined = sources.join("\n");
  assert.doesNotMatch(joined, /child_process|simple-git|spawn\(|execFile|fetch\(/u);
});
