import type {
  CrossEncoder,
  CrossEncoderInput,
} from "../../services/retrieval/hybridV2/crossEncoder.js";
import { candidateKey } from "../../services/retrieval/hybridV2/types.js";
import { tokenizeEvaluationText } from "./fixtures.js";

export interface RerankerEvaluationCounters {
  attempts: number;
  failures: number;
  fallbacks: number;
}

export class DeterministicEvaluationCrossEncoder implements CrossEncoder {
  readonly name = "evaluation-deterministic";

  verify(): void {}

  async rerank(input: CrossEncoderInput): Promise<ReadonlyMap<string, number>> {
    const queryTokens = new Set(tokenizeEvaluationText(input.query));
    return new Map(input.candidates.map((candidate) => {
      const candidateTokens = new Set(tokenizeEvaluationText(
        `${candidate.result.filePath} ${candidate.result.symbol ?? ""} ${candidate.result.content}`,
      ));
      const matches = [...queryTokens].filter((token) => candidateTokens.has(token)).length;
      const overlap = queryTokens.size > 0 ? matches / queryTokens.size : 0;
      return [
        candidateKey(candidate),
        Math.min(1, candidate.baseScore * 0.6 + overlap * 0.4),
      ];
    }));
  }
}

export class TrackingEvaluationCrossEncoder implements CrossEncoder {
  readonly counters: RerankerEvaluationCounters = {
    attempts: 0,
    failures: 0,
    fallbacks: 0,
  };

  constructor(
    private readonly delegate: CrossEncoder,
    readonly name = `tracked-${delegate.name}`,
  ) {}

  verify(): Promise<void> | void {
    return this.delegate.verify();
  }

  async rerank(input: CrossEncoderInput): Promise<ReadonlyMap<string, number>> {
    this.counters.attempts += 1;
    try {
      return await this.delegate.rerank(input);
    } catch (error) {
      this.counters.failures += 1;
      this.counters.fallbacks += 1;
      throw error;
    }
  }
}
