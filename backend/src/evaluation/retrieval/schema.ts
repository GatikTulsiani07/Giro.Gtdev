import { z } from "zod";

export const RETRIEVAL_BENCHMARK_CATEGORIES = [
  "exact symbol lookup",
  "implementation discovery",
  "cross-file dependency tracing",
  "architecture questions",
  "configuration discovery",
  "error/debugging lookup",
  "test discovery",
  "semantic intent without exact keywords",
  "ambiguous queries",
  "large-repository retrieval",
] as const;

const nonEmptyUniqueStrings = z.array(z.string().trim().min(1)).min(1).refine(
  (values) => new Set(values).size === values.length,
  "Values must be unique.",
);

export const RetrievalBenchmarkCaseSchema = z.object({
  benchmarkId: z.string().trim().regex(/^[a-z0-9][a-z0-9._-]*$/),
  repositoryFixture: z.string().trim().min(1),
  repositoryRevision: z.string().trim().min(1),
  query: z.string().trim().min(1),
  expectedRelevantFiles: nonEmptyUniqueStrings,
  expectedRelevantSymbols: z.array(z.string().trim().min(1)).default([]),
  expectedRelevantChunks: z.array(z.string().trim().min(1)).default([]),
  excludedFiles: z.array(z.string().trim().min(1)).default([]),
  category: z.enum(RETRIEVAL_BENCHMARK_CATEGORIES).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  notes: z.string().trim().min(1).optional(),
}).strict();

export const RetrievalBenchmarkSuiteSchema = z.object({
  schemaVersion: z.literal(1),
  benchmarkVersion: z.string().trim().min(1),
  cases: z.array(RetrievalBenchmarkCaseSchema).min(1).refine(
    (cases) => new Set(cases.map((item) => item.benchmarkId)).size === cases.length,
    "Benchmark IDs must be unique.",
  ),
}).strict();

const FixtureChunkSchema = z.object({
  chunkId: z.string().trim().min(1),
  content: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  symbols: z.array(z.string().trim().min(1)).default([]),
  semanticTerms: z.array(z.string().trim().min(1)).default([]),
}).strict().refine((chunk) => chunk.endLine >= chunk.startLine, {
  message: "Chunk end line must not precede its start line.",
});

const FixtureFileSchema = z.object({
  filePath: z.string().trim().min(1),
  language: z.string().trim().min(1),
  generated: z.boolean().default(false),
  vendor: z.boolean().default(false),
  chunks: z.array(FixtureChunkSchema).min(1),
}).strict();

const FixtureEmbeddingSchema = z.object({
  provider: z.string().trim().min(1),
  model: z.string().trim().min(1),
  dimension: z.number().int().positive(),
  embeddingVersion: z.string().trim().min(1),
  chunkingStrategyVersion: z.string().trim().min(1),
}).strict();

export const RepositoryFixtureSchema = z.object({
  fixtureId: z.string().trim().min(1),
  repositoryId: z.string().trim().regex(/^[^/]+\/[^/]+$/),
  repositoryRevision: z.string().trim().min(1),
  publicationStatus: z.enum(["building", "published", "failed", "superseded"]),
  embedding: FixtureEmbeddingSchema,
  files: z.array(FixtureFileSchema).min(1),
}).strict();

export const RepositoryFixtureSuiteSchema = z.object({
  schemaVersion: z.literal(1),
  fixtures: z.array(RepositoryFixtureSchema).min(1).refine(
    (fixtures) => new Set(fixtures.map((item) =>
      `${item.fixtureId}\u0000${item.repositoryRevision}`)).size === fixtures.length,
    "Fixture revision identities must be unique.",
  ),
}).strict();

export type RetrievalBenchmarkCase = z.infer<typeof RetrievalBenchmarkCaseSchema>;
export type RetrievalBenchmarkSuite = z.infer<typeof RetrievalBenchmarkSuiteSchema>;
export type RepositoryFixture = z.infer<typeof RepositoryFixtureSchema>;
export type RepositoryFixtureSuite = z.infer<typeof RepositoryFixtureSuiteSchema>;
export type FixtureEmbedding = z.infer<typeof FixtureEmbeddingSchema>;
