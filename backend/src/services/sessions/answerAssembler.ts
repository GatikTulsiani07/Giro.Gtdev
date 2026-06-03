// Deterministic repository answer assembly. No randomness, timestamps, or AI.

import type { Citation } from "./types.js";
import type { AnswerSource, RepositorySummaryView } from "./answerTypes.js";
import type {
  EnrichedAssembledContext,
  EnrichedContextChunk,
} from "../context/contextTypes.js";
import type { FileSearchResult } from "../fileSearch/types.js";

const MAX_SOURCES = 6;
const MAX_CITATIONS = 6;
const SNIPPET_LEN = 160;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function snippetOf(content: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  if (collapsed.length <= SNIPPET_LEN) return collapsed;
  return collapsed.slice(0, SNIPPET_LEN) + "…";
}

function buildSources(
  question: string,
  chunks: EnrichedContextChunk[],
  fileResults: FileSearchResult[],
): AnswerSource[] {
  const fileReasonByPath = new Map<string, string>();
  for (const f of fileResults) {
    if (!fileReasonByPath.has(f.path)) fileReasonByPath.set(f.path, f.reason);
  }

  // Group by filePath, keep the highest-scoring chunk per file.
  const bestByPath = new Map<string, EnrichedContextChunk>();
  for (const chunk of chunks) {
    const existing = bestByPath.get(chunk.filePath);
    if (!existing || chunk.score > existing.score) {
      bestByPath.set(chunk.filePath, chunk);
    }
  }

  const sources: AnswerSource[] = [...bestByPath.values()].map((chunk) => {
    const reason =
      chunk.reason ??
      fileReasonByPath.get(chunk.filePath) ??
      `Relevant to: ${question}`;
    return { path: chunk.filePath, reason, score: round3(chunk.score) };
  });

  return sources
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, MAX_SOURCES);
}

function buildCitations(chunks: EnrichedContextChunk[]): Citation[] {
  return [...chunks]
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.filePath.localeCompare(b.filePath) ||
        a.startLine - b.startLine,
    )
    .slice(0, MAX_CITATIONS)
    .map((chunk) => ({
      filePath: chunk.filePath,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      snippet: snippetOf(chunk.content),
    }));
}

function buildAnswer(
  question: string,
  context: EnrichedAssembledContext,
  summary: RepositorySummaryView,
  sources: AnswerSource[],
): string {
  const sections: string[] = [];

  sections.push(
    summary.available
      ? `This ${summary.framework} repository uses ${summary.primaryLanguage} as its primary language.`
      : "I found repository context relevant to your question.",
  );

  if (summary.centralModules.length > 0) {
    sections.push(
      `The most central modules are: ${summary.centralModules.slice(0, 3).join(", ")}.`,
    );
  }

  if (summary.entrypoints.length > 0) {
    sections.push(`Entrypoints include: ${summary.entrypoints.join(", ")}.`);
  }

  if (sources.length > 0) {
    const list = sources.map((s) => `${s.path} (${s.reason})`).join("; ");
    sections.push(`The files most relevant to your question are: ${list}.`);
  }

  sections.push(
    `This answer was assembled from ${context.totalChunks} retrieved code segments across ${sources.length} files.`,
  );

  return sections.join("\n\n");
}

export function assembleAnswer(
  question: string,
  context: EnrichedAssembledContext,
  fileResults: FileSearchResult[],
  summary: RepositorySummaryView,
): { answer: string; sources: AnswerSource[]; citations: Citation[] } {
  const chunks = context.context;
  const sources = buildSources(question, chunks, fileResults);
  const citations = buildCitations(chunks);
  const answer = buildAnswer(question, context, summary, sources);
  return { answer, sources, citations };
}
