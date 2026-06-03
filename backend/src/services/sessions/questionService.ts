// Deterministic ask orchestration: load session -> gather context -> assemble
// answer -> persist messages. Graceful degradation on retrieval, hard fail on persist.

import { getSessionById, addMessageToSession } from "./sessionService.js";
import { assembleAnswer } from "./answerAssembler.js";
import type { AskResult, RepositorySummaryView } from "./answerTypes.js";
import { assembleEnrichedContext } from "../context/enrichedAssembler.js";
import { searchRepositoryFiles as searchFiles } from "../fileSearch/index.js";
import { analyzeRepoDependencies } from "../graph/index.js";
import { repoClonePath } from "../repository/clone.js";
import { scanRepo } from "../repository/scanner.js";
import { analyzeRepository } from "../repository/analyzer.js";
import { logger } from "../../lib/logger.js";

type QuestionResult = AskResult | "session_not_found";

export async function answerSessionQuestion(
  sessionId: string,
  question: string,
): Promise<QuestionResult> {
  // STEP 1 — Load session
  const session = getSessionById(sessionId);
  if (!session) return "session_not_found";

  // STEP 2 — Extract owner + repo
  const { owner, repo } = session;

  // STEP 3 — Build RepositorySummaryView (graceful)
  const summary: RepositorySummaryView = {
    available: false,
    framework: "unknown",
    primaryLanguage: "unknown",
    entrypoints: [],
    centralModules: [],
  };
  try {
    const clonePath = repoClonePath(owner, repo);
    const scanStats = await scanRepo(clonePath);
    const analysis = await analyzeRepository(clonePath, scanStats);
    summary.available = true;
    summary.framework = analysis.framework;
    summary.primaryLanguage = analysis.primaryLanguage;
    summary.entrypoints = analysis.entrypoints;
  } catch (err) {
    logger.warn("repo_summary_unavailable", {
      sessionId,
      owner,
      repo,
      message: err instanceof Error ? err.message : "unknown",
    });
  }

  // STEP 4 — Dependency graph (graceful)
  let usedDependencyGraph = false;
  try {
    const graph = await analyzeRepoDependencies(owner, repo);
    summary.centralModules = graph.insights.centralModules;
    usedDependencyGraph = true;
  } catch (err) {
    logger.warn("dependency_graph_unavailable", {
      sessionId,
      owner,
      repo,
      message: err instanceof Error ? err.message : "unknown",
    });
  }

  // STEP 5 — Enriched context (graceful)
  const EMPTY_CONTEXT = {
    query: question,
    repository: `${owner}/${repo}`,
    totalChunks: 0,
    estimatedTokens: 0,
    context: [],
    stats: {
      hybridResults: 0,
      fileSearchResults: 0,
      deduplicatedCount: 0,
      finalCount: 0,
      sourceCounts: { semantic: 0, keyword: 0, symbol: 0, graph: 0, fileSearch: 0 },
    },
  };
  let enrichedContext: Awaited<ReturnType<typeof assembleEnrichedContext>> =
    EMPTY_CONTEXT;
  try {
    enrichedContext = await assembleEnrichedContext({
      query: question,
      owner,
      repo,
      maxChars: 16000,
      limit: 25,
    });
  } catch (err) {
    logger.error("enriched_context_failed", {
      sessionId,
      owner,
      repo,
      message: err instanceof Error ? err.message : "unknown",
    });
  }

  // STEP 6 — File search (graceful)
  let fileResults: Awaited<ReturnType<typeof searchFiles>> = {
    query: question,
    repository: `${owner}/${repo}`,
    results: [],
    totalFilesScanned: 0,
  };
  try {
    fileResults = await searchFiles({ query: question, owner, repo, limit: 10 });
  } catch (err) {
    logger.warn("file_search_failed", {
      sessionId,
      owner,
      repo,
      message: err instanceof Error ? err.message : "unknown",
    });
  }

  // STEP 7 — Assemble answer (synchronous)
  const { answer, sources, citations } = assembleAnswer(
    question,
    enrichedContext,
    fileResults.results,
    summary,
  );

  // STEP 8 — Persist messages sequentially (hard fail)
  await addMessageToSession(sessionId, { role: "user", content: question });
  await addMessageToSession(sessionId, {
    role: "assistant",
    content: answer,
    citations,
  });

  // STEP 9 — Build metadata
  const metadata = {
    retrievedFiles: sources.length,
    usedSummary: summary.available,
    usedDependencyGraph,
    retrievalSourceCounts: enrichedContext.stats.sourceCounts,
    estimatedContextTokens: enrichedContext.estimatedTokens,
  };

  // STEP 10 — Log success
  logger.info("session_question_answered", {
    sessionId,
    owner,
    repo,
    retrievedFiles: sources.length,
    usedDependencyGraph,
  });

  // STEP 11 — Return
  return { answer, sources, citations, metadata };
}
