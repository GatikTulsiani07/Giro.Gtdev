import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { EnrichedAssembledContext } from "../services/context/contextTypes.js";
import {
  answerSessionQuestion,
  INSUFFICIENT_REPOSITORY_EVIDENCE_MESSAGE,
} from "../services/sessions/questionService.js";
import {
  createNewSession,
  getSessionById,
} from "../services/sessions/sessionService.js";
import { clearAllSessions } from "../services/sessions/store.js";

const repositoryId = "acme/platform";

function contextWithEvidence(): EnrichedAssembledContext {
  const context = [
    {
      filePath: "src/auth/controller.ts",
      language: "typescript",
      content: "export function authenticate(token: string) { return verify(token); }",
      startLine: 10,
      endLine: 18,
      score: 1,
      source: "semantic" as const,
      signals: { semantic: 1, keyword: 1, symbol: 1, graph: 1 },
      chunkId: "auth-controller",
      symbol: "authenticate",
      repositoryVersion: "commit-abc",
      citationRetrievalType: "hybrid" as const,
      primaryQueryMatch: true,
    },
    {
      filePath: "src/auth/service.ts",
      language: "typescript",
      content: "export function verify(token: string) { return token.length > 0; }",
      startLine: 4,
      endLine: 9,
      score: 0.95,
      source: "keyword" as const,
      signals: { semantic: 0.95, keyword: 0.9, symbol: 0.8, graph: 0.7 },
      chunkId: "auth-service",
      symbol: "verify",
      repositoryVersion: "commit-abc",
      citationRetrievalType: "hybrid" as const,
      primaryQueryMatch: true,
    },
  ];
  return {
    query: "Where does authentication start?",
    repository: repositoryId,
    totalChunks: context.length,
    estimatedTokens: 40,
    context,
    stats: {
      hybridResults: 2,
      fileSearchResults: 0,
      deduplicatedCount: 0,
      finalCount: 2,
      sourceCounts: { semantic: 1, keyword: 1, symbol: 0, graph: 0, fileSearch: 0 },
    },
  };
}

function emptyContext(): EnrichedAssembledContext {
  return {
    query: "Where is missing code?",
    repository: repositoryId,
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
}

beforeEach(() => clearAllSessions());

test("canonical ask retrieves once, generates once, and reuses evidence for the response", async () => {
  const session = createNewSession({ userId: "user-1", owner: "acme", repo: "platform" });
  let retrievalCalls = 0;
  let generationCalls = 0;

  const result = await answerSessionQuestion(session.id, "Where does authentication start?", {
    assembleContext: async () => {
      retrievalCalls += 1;
      return contextWithEvidence();
    },
    generateAnswer: async ({ context, repositoryId: receivedRepository }) => {
      generationCalls += 1;
      assert.equal(receivedRepository, repositoryId);
      assert.equal(context.length, 2);
      return "Authentication enters through `authenticate` in `src/auth/controller.ts:10-18`.";
    },
    now: () => "2026-07-19T12:00:00.000Z",
  });

  assert.notEqual(result, "session_not_found");
  if (result === "session_not_found") throw new Error("expected an answer");
  assert.equal(retrievalCalls, 1);
  assert.equal(generationCalls, 1);
  assert.equal(result.answer.includes("Authentication enters"), true);
  assert.deepEqual(
    result.retrieval.results.map((item) => item.filePath),
    ["src/auth/controller.ts", "src/auth/service.ts"],
  );
  assert.deepEqual(result.retrieval.citations, result.citations);
});

test("insufficient evidence suppresses generation and persists an explicit response", async () => {
  const session = createNewSession({ userId: "user-1", owner: "acme", repo: "platform" });
  let generationCalls = 0;
  const result = await answerSessionQuestion(session.id, "Where is missing code?", {
    assembleContext: async () => emptyContext(),
    generateAnswer: async () => {
      generationCalls += 1;
      return "invented";
    },
  });

  assert.notEqual(result, "session_not_found");
  if (result === "session_not_found") throw new Error("expected an answer");
  assert.equal(generationCalls, 0);
  assert.equal(result.answer, INSUFFICIENT_REPOSITORY_EVIDENCE_MESSAGE);
  assert.equal(result.citations.length, 0);
  assert.equal(result.metadata.confidence?.answerable, false);
  assert.deepEqual(
    getSessionById(session.id)?.messages.map((message) => message.content),
    ["Where is missing code?", INSUFFICIENT_REPOSITORY_EVIDENCE_MESSAGE],
  );
});

test("answer, citations, evidence, retrieval metadata, repository, and timestamps persist in session history", async () => {
  const session = createNewSession({ userId: "user-1", owner: "acme", repo: "platform" });
  await answerSessionQuestion(session.id, "Explain auth", {
    assembleContext: async () => contextWithEvidence(),
    generateAnswer: async () => "The controller delegates token verification to the auth service.",
    now: () => "2026-07-19T12:00:00.000Z",
  });

  const history = getSessionById(session.id);
  assert.ok(history);
  assert.equal(history.messages.length, 2);
  const question = history.messages[0];
  const answer = history.messages[1];
  assert.equal(question?.role, "user");
  assert.equal(question?.content, "Explain auth");
  assert.equal(answer?.role, "assistant");
  assert.equal(answer?.citations.length, 2);
  assert.equal(answer?.evidence?.length, 2);
  assert.equal(answer?.retrievalMetadata?.repositoryId, repositoryId);
  assert.equal(answer?.retrievalMetadata?.retrievedAt, "2026-07-19T12:00:00.000Z");
  assert.equal(answer?.retrievalMetadata?.selectedChunkCount, 2);
  assert.equal(history.selectedContext.length, 2);
  assert.ok(question?.createdAt);
  assert.ok(answer?.createdAt);
});
