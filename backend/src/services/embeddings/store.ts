import { createHash } from "node:crypto";
import { supabase } from "../../lib/supabase.js";
import { getPostgresPool } from "../../lib/postgres.js";
import { env } from "../../config/env.js";
import { createDeadline } from "../../runtime/deadline.js";
import { EMBEDDING_MODEL } from "./embedder.js";

export interface StoreEmbeddingInput {
  repository: string;
  filePath: string;
  language: string;
  chunkIndex: number;
  content: string;
  summary: string | null;
  startLine: number;
  endLine: number;
  embedding: number[];
  repositoryRevision: string;
  embeddingVersion: string;
  chunkId: string;
  chunkHash: string;
  tokenCount?: number;
}

export interface EmbeddingPersistenceDiagnostics {
  operation: "repository_chunks.upsert";
  repositoryId: string;
  revision: string;
  chunkId: string;
  embeddingDimension: number;
  provider: string;
  model: string;
  errorMessage: string;
  errorCode?: string;
  details?: string;
  hint?: string;
}

type SupabasePersistenceError = {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
};

export interface RepositoryChunkSqlClient {
  connect(): Promise<RepositoryChunkSqlConnection>;
}

export interface RepositoryChunkSqlConnection {
  query(
    text: string | { text: string; values?: unknown[]; signal?: AbortSignal },
    values?: unknown[],
  ): Promise<unknown>;
  release(): void;
}

const SECRET_TEXT_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\bBearer\s+\S+/gi, "Bearer [REDACTED]"],
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]"],
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+\b/g, "[REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]"],
  [/([?&](?:key|token|secret|api_key|apikey)=)[^&\s]+/gi, "$1[REDACTED]"],
  [/((?:authorization|api[_-]?key|service[_-]?key|jwt|token|secret)\s*[:=]\s*)\S+/gi, "$1[REDACTED]"],
];

function htmlErrorSummary(value: string): string | null {
  if (!/(?:<!doctype html|<html[\s>]|<body[\s>])/i.test(value)) return null;
  const title = value.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const headline = value.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const subheadline = value.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
  const rayId = value.match(/Cloudflare Ray ID:\s*<[^>]+>([^<]+)</i)?.[1];
  const parts = [title, headline, subheadline]
    .map((part) => part?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter((part): part is string => Boolean(part));
  if (rayId?.trim()) parts.push(`Cloudflare Ray ID: ${rayId.trim()}`);
  return parts.length > 0 ? parts.join(" | ") : "HTML error response from Supabase/PostgREST";
}

export class EmbeddingPersistenceError extends Error {
  readonly diagnostics: EmbeddingPersistenceDiagnostics;

  constructor(diagnostics: EmbeddingPersistenceDiagnostics, cause: unknown) {
    super(`Failed to store chunk: ${diagnostics.errorMessage}`, { cause });
    this.name = "EmbeddingPersistenceError";
    this.diagnostics = Object.freeze({ ...diagnostics });
  }
}

function diagnosticString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  let redacted = htmlErrorSummary(trimmed) ?? trimmed;
  for (const [pattern, replacement] of SECRET_TEXT_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted.slice(0, 2_000);
}

function embeddingPersistenceDiagnostics(
  input: StoreEmbeddingInput,
  error: SupabasePersistenceError,
): EmbeddingPersistenceDiagnostics {
  return {
    operation: "repository_chunks.upsert",
    repositoryId: input.repository,
    revision: input.repositoryRevision,
    chunkId: input.chunkId,
    embeddingDimension: input.embedding.length,
    provider: env.EMBEDDINGS_PROVIDER,
    model: EMBEDDING_MODEL,
    errorMessage: diagnosticString(error.message) ?? "unknown Supabase persistence error",
    ...(diagnosticString(error.code) ? { errorCode: diagnosticString(error.code) } : {}),
    ...(diagnosticString(error.details) ? { details: diagnosticString(error.details) } : {}),
    ...(diagnosticString(error.hint) ? { hint: diagnosticString(error.hint) } : {}),
  };
}

function stableChunkId(input: StoreEmbeddingInput, revision: string): string {
  return createHash("sha256").update([
    input.repository, revision, input.embeddingVersion, input.chunkId,
  ].join("\u0000")).digest("hex");
}

function embeddingVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

function storeChunkEmbeddingRow(input: StoreEmbeddingInput) {
  const repositoryRevision = input.repositoryRevision;
  return {
    id: stableChunkId(input, repositoryRevision),
    repository: input.repository,
    repositoryRevision,
    embeddingVersion: input.embeddingVersion,
    chunkId: input.chunkId,
    chunkHash: input.chunkHash,
    filePath: input.filePath,
    language: input.language,
    chunkIndex: input.chunkIndex,
    content: input.content,
    summary: input.summary,
    startLine: input.startLine,
    endLine: input.endLine,
    contentHash: createHash("sha256").update(input.content).digest("hex"),
    tokenCount: input.tokenCount ?? Math.max(1, Math.ceil(input.content.length / 4)),
    characterCount: input.content.length,
    embedding: embeddingVectorLiteral(input.embedding),
    metadata: {},
    updatedAt: new Date().toISOString(),
  };
}

function postgresPersistenceError(error: unknown): SupabasePersistenceError {
  if (!error || typeof error !== "object") return { message: String(error) };
  const record = error as Record<string, unknown>;
  return {
    message: record.message,
    code: record.code,
    details: record.detail ?? record.details,
    hint: record.hint,
  };
}

async function query(
  connection: RepositoryChunkSqlConnection,
  text: string,
  values?: unknown[],
  signal?: AbortSignal,
) {
  return connection.query({ text, values, signal });
}

async function storeChunkEmbeddingWithPostgres(
  input: StoreEmbeddingInput,
  options: { signal?: AbortSignal; sqlClient?: RepositoryChunkSqlClient } = {},
): Promise<void> {
  const deadline = createDeadline(env.DATABASE_REQUEST_TIMEOUT_MS, { parentSignal: options.signal });
  let connection: RepositoryChunkSqlConnection | null = null;
  try {
    connection = await (options.sqlClient ?? getPostgresPool()).connect();
    if (deadline.signal.aborted) throw deadline.signal.reason;
    const row = storeChunkEmbeddingRow(input);
    await query(connection, "begin", undefined, deadline.signal);
    await query(
      connection,
      "select set_config('statement_timeout', $1, true)",
      [`${env.DATABASE_STATEMENT_TIMEOUT_MS}ms`],
      deadline.signal,
    );
    await query(connection, `
      insert into public.repository_chunks (
        id, repository, repository_revision, embedding_version, chunk_id,
        chunk_hash, file_path, language, chunk_index, content, summary,
        start_line, end_line, content_hash, token_count, character_count,
        embedding, metadata, updated_at
      ) values (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16,
        $17, $18::jsonb, $19
      )
      on conflict (embedding_version, chunk_id) do nothing
    `, [
      row.id, row.repository, row.repositoryRevision, row.embeddingVersion, row.chunkId,
      row.chunkHash, row.filePath, row.language, row.chunkIndex, row.content, row.summary,
      row.startLine, row.endLine, row.contentHash, row.tokenCount, row.characterCount,
      row.embedding, JSON.stringify(row.metadata), row.updatedAt,
    ], deadline.signal);
    await query(connection, "commit", undefined, deadline.signal);
  } catch (error) {
    if (connection) {
      try {
        await connection.query("rollback");
      } catch {
        // Preserve the original persistence failure.
      }
    }
    throw new EmbeddingPersistenceError(
      embeddingPersistenceDiagnostics(input, postgresPersistenceError(error)),
      error,
    );
  } finally {
    connection?.release();
    deadline.dispose();
  }
}

export async function storeChunkEmbedding(
  input: StoreEmbeddingInput,
  options: {
    signal?: AbortSignal;
    sqlClient?: RepositoryChunkSqlClient;
  } = {},
): Promise<void> {
  return storeChunkEmbeddingWithPostgres(input, options);
}

export async function deleteRepositoryRetrievalData(
  repository: string,
  keepRevision?: string,
  databaseClient: Pick<typeof supabase, "rpc"> = supabase,
): Promise<void> {
  const { error } = await databaseClient.rpc("delete_repository_retrieval_data", {
    input_repository: repository,
    input_keep_revision: keepRevision ?? null,
  });
  if (error) throw new Error("Failed to remove repository retrieval data.");
}
