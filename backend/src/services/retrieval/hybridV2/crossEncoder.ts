import OpenAI from "openai";
import { env } from "../../../config/env.js";
import { logger } from "../../../lib/logger.js";
import type { HybridRetrievalCandidate } from "./types.js";
import { candidateKey } from "./types.js";
import { runtimeHybridRetrievalV2Config } from "./config.js";

export interface CrossEncoderInput {
  query: string;
  candidates: readonly HybridRetrievalCandidate[];
  signal?: AbortSignal;
}

export interface CrossEncoder {
  readonly name: string;
  rerank(input: CrossEncoderInput): Promise<ReadonlyMap<string, number>>;
  verify(): Promise<void> | void;
}

/** Deterministic, side-effect-free fallback and test implementation. */
export class DeterministicNoopCrossEncoder implements CrossEncoder {
  readonly name = "deterministic";

  verify(): void {}

  async rerank(input: CrossEncoderInput): Promise<ReadonlyMap<string, number>> {
    return new Map(input.candidates.map((candidate) => [
      candidateKey(candidate),
      candidate.baseScore,
    ]));
  }
}

export class OpenAICrossEncoder implements CrossEncoder {
  readonly name = "openai";

  constructor(
    private readonly client: Pick<OpenAI, "chat">,
    private readonly model: string,
  ) {}

  verify(): void {
    if (!this.model.trim()) throw new Error("OpenAI reranker model is required.");
  }

  async rerank(input: CrossEncoderInput): Promise<ReadonlyMap<string, number>> {
    input.signal?.throwIfAborted();
    const candidatePayload = input.candidates.slice(0, 100).map((candidate) => ({
      id: candidateKey(candidate),
      path: candidate.result.filePath,
      symbol: candidate.result.symbol,
      text: candidate.result.content.slice(0, 2_000),
    }));
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Score each code candidate for relevance. Return JSON only: {\"scores\":[{\"id\":\"...\",\"score\":0.0}]}. Include every id once. Scores are between 0 and 1.",
        },
        {
          role: "user",
          content: JSON.stringify({ query: input.query, candidates: candidatePayload }),
        },
      ],
    }, { signal: input.signal });
    const content = response.choices[0]?.message.content;
    if (!content) throw new Error("OpenAI reranker returned no scores.");
    const parsed = JSON.parse(content) as { scores?: Array<{ id?: unknown; score?: unknown }> };
    const allowed = new Set(candidatePayload.map((candidate) => candidate.id));
    const scores = new Map<string, number>();
    for (const entry of parsed.scores ?? []) {
      if (typeof entry.id !== "string" || !allowed.has(entry.id) ||
          typeof entry.score !== "number" || !Number.isFinite(entry.score)) continue;
      scores.set(entry.id, Math.max(0, Math.min(1, entry.score)));
    }
    if (scores.size !== candidatePayload.length) {
      throw new Error("OpenAI reranker returned an incomplete score set.");
    }
    return scores;
  }
}

export const deterministicCrossEncoder = new DeterministicNoopCrossEncoder();

export const runtimeCrossEncoder: CrossEncoder =
  runtimeHybridRetrievalV2Config.rerankerProvider === "openai"
    ? new OpenAICrossEncoder(new OpenAI({ apiKey: env.OPENAI_API_KEY }), runtimeHybridRetrievalV2Config.rerankerModel)
    : deterministicCrossEncoder;

export async function rerankWithFallback(
  encoder: CrossEncoder,
  input: CrossEncoderInput,
): Promise<ReadonlyMap<string, number>> {
  try {
    return await encoder.rerank(input);
  } catch (error) {
    if (input.signal?.aborted) throw input.signal.reason;
    logger.warn("retrieval_reranker_fallback", {
      provider: encoder.name,
      reasonCode: "reranker_unavailable",
    });
    return deterministicCrossEncoder.rerank(input);
  }
}
