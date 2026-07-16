import { describe, expect, it, beforeEach } from "vitest";

import { buildRepositorySymbolGraph } from "../services/repositoryGraph/graphBuilder.js";
import {
  clearRepositorySymbolGraphs,
  saveRepositorySymbolGraph,
} from "../services/repositoryGraph/runtimeRepositoryGraph.js";
import { expandRetrievalCandidatesWithRepositoryGraph } from "../services/repositoryGraph/repositoryGraph.js";
import { buildRetrievalPipeline } from "../services/retrieval/retrievalPipeline.js";
import { buildRetrievalCacheKey } from "../services/retrieval/cache/retrievalCache.js";
import { buildCitations } from "../services/retrieval/citations.js";
import type { FileImport, FileSymbolMap } from "../services/graph/types.js";

const REPO = "acme/demo";

function imp(source: string, specifiers: string[], line = 1): FileImport {
  return { source, specifiers, isRelative: source.startsWith("."), line };
}

function maps(): FileSymbolMap[] {
  return [
    {
      filePath: "src/base.ts",
      language: "typescript",
      symbols: [
        { name: "Printable", kind: "interface", exported: true, line: 1 },
        { name: "BasePrinter", kind: "class", exported: true, line: 5 },
      ],
      imports: [],
    },
    {
      filePath: "src/printer.ts",
      language: "typescript",
      symbols: [
        {
          name: "Printer",
          kind: "class",
          exported: true,
          line: 3,
          extends: ["BasePrinter"],
          implements: ["Printable"],
        },
        { name: "formatOutput", kind: "function", exported: true, line: 20 },
      ],
      imports: [imp("./base.js", ["BasePrinter", "Printable"], 1)],
    },
  ];
}

function captureLogger() {
  const events: Array<{ event: string; fields?: Record<string, unknown> }> = [];
  return {
    events,
    logger: {
      info(event: string, fields?: Record<string, unknown>) {
        events.push({ event, fields });
      },
    },
  };
}

function captureMetrics() {
  return {
    expansions: 0,
    drops: 0,
    incrementSymbolExpansion(count = 1) {
      this.expansions += count;
    },
    incrementSymbolExpansionBudgetDrop(count = 1) {
      this.drops += count;
    },
  };
}

beforeEach(() => {
  clearRepositorySymbolGraphs();
});

describe("repository symbol graph", () => {
  it("extracts symbol nodes and module parent-child relationships", () => {
    const graph = buildRepositorySymbolGraph({
      repositoryId: REPO,
      repositoryVersion: "v1",
      symbolMaps: maps(),
    });

    expect(graph.nodes.map((node) => `${node.kind}:${node.name}`)).toEqual(
      expect.arrayContaining([
        "module:src/base.ts",
        "interface:Printable",
        "class:BasePrinter",
        "module:src/printer.ts",
        "imported_member:BasePrinter",
        "imported_member:Printable",
        "class:Printer",
        "function:formatOutput",
      ]),
    );
    expect(graph.nodes).toHaveLength(8);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "child" }),
        expect.objectContaining({ kind: "parent" }),
        expect.objectContaining({ kind: "exports" }),
      ]),
    );
  });

  it("records imports, inheritance, and interface implementation relationships", () => {
    const graph = buildRepositorySymbolGraph({
      repositoryId: REPO,
      repositoryVersion: "v1",
      symbolMaps: maps(),
    });
    const printer = graph.nodes.find((node) => node.name === "Printer" && node.kind === "class")?.symbolId;
    const base = graph.nodes.find((node) => node.name === "BasePrinter" && node.kind === "class")?.symbolId;
    const printable = graph.nodes.find((node) => node.name === "Printable" && node.kind === "interface")?.symbolId;

    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { fromSymbolId: printer, toSymbolId: base, kind: "extends" },
        { fromSymbolId: printer, toSymbolId: printable, kind: "implements" },
        expect.objectContaining({ kind: "imports" }),
        expect.objectContaining({ kind: "references" }),
      ]),
    );
  });

  it("looks up a selected symbol and expands one bounded hop", () => {
    saveRepositorySymbolGraph(buildRepositorySymbolGraph({
      repositoryId: REPO,
      repositoryVersion: "v1",
      symbolMaps: maps(),
    }));
    const metrics = captureMetrics();
    const { logger, events } = captureLogger();

    const expanded = expandRetrievalCandidatesWithRepositoryGraph(
      [{
        filePath: "src/printer.ts",
        content: "class Printer {}",
        score: 1,
        startLine: 3,
        endLine: 3,
        symbol: "Printer",
      }],
      { repositoryId: REPO, maxCharacters: 500, metrics, logger },
    );

    expect(expanded.map((candidate) => candidate.symbol)).toEqual([
      "Printer",
      "Printable",
      "BasePrinter",
      "src/printer.ts",
      "formatOutput",
    ]);
    expect(metrics.expansions).toBe(4);
    expect(events.map((event) => event.event)).toEqual([
      "symbol_expansion_started",
      "symbol_expansion_completed",
    ]);
  });

  it("trims expansions against remaining budget after primary retrieval wins", () => {
    saveRepositorySymbolGraph(buildRepositorySymbolGraph({
      repositoryId: REPO,
      repositoryVersion: "v1",
      symbolMaps: maps(),
    }));
    const metrics = captureMetrics();
    const { logger, events } = captureLogger();

    const expanded = expandRetrievalCandidatesWithRepositoryGraph(
      [{
        filePath: "src/printer.ts",
        content: "class Printer {}",
        score: 1,
        startLine: 3,
        endLine: 3,
        symbol: "Printer",
      }],
      { repositoryId: REPO, maxCharacters: 20, metrics, logger },
    );

    expect(expanded).toHaveLength(1);
    expect(metrics.drops).toBeGreaterThan(0);
    expect(events.some((event) => event.event === "symbol_expansion_trimmed")).toBe(true);
  });

  it("participates in retrieval pipeline ordering without displacing primaries", () => {
    saveRepositorySymbolGraph(buildRepositorySymbolGraph({
      repositoryId: REPO,
      repositoryVersion: "v1",
      symbolMaps: maps(),
    }));

    const context = buildRetrievalPipeline(
      [{
        filePath: "src/printer.ts",
        content: "class Printer {}",
        score: 1,
        startLine: 3,
        endLine: 3,
        symbol: "Printer",
      }],
      {
        minScore: 0,
        maxCandidates: 1,
        maxCharacters: 500,
        repositoryId: REPO,
      },
    );

    expect(context.chunkCount).toBeGreaterThan(1);
    expect(context.content.indexOf("class Printer {}")).toBeLessThan(
      context.content.indexOf("interface Printable"),
    );
  });

  it("keeps repository version invalidation in the retrieval cache key", () => {
    const first = buildRetrievalCacheKey({
      repositoryId: REPO,
      query: "printer",
      mode: "hybrid",
      repositoryVersion: "v1",
    });
    const second = buildRetrievalCacheKey({
      repositoryId: REPO,
      query: "printer",
      mode: "hybrid",
      repositoryVersion: "v2",
    });

    expect(first).not.toBe(second);
  });

  it("expanded chunks use normal citation generation", () => {
    const citations = buildCitations([
      {
        repositoryId: REPO,
        filePath: "src/base.ts",
        language: "typescript",
        startLine: 1,
        endLine: 1,
        retrievalType: "graph",
        score: 0,
        symbol: "Printable",
        repositoryVersion: "v1",
      },
    ], {
      surface: "context",
      metrics: {
        incrementCitationsGenerated: () => undefined,
        addCitationChunks: () => undefined,
        addCitationMerges: () => undefined,
      },
      logger: { info: () => undefined },
    });

    expect(citations).toEqual([
      expect.objectContaining({
        relativeFilePath: "src/base.ts",
        retrievalType: "graph",
        symbol: "Printable",
      }),
    ]);
  });
});
