import type {
  AdjacentChunkStitchingOptions,
  AdjacentChunkStitchingResult,
  StitchableChunk,
  StitchedChunk,
} from "./stitchingTypes.js";

interface IndexedChunk<TCitation> {
  chunk: StitchableChunk<TCitation>;
  rank: number;
}

function groupKey<TCitation>(chunk: StitchableChunk<TCitation>): string {
  return JSON.stringify([
    chunk.repositoryId,
    chunk.filePath,
    chunk.repositoryVersion,
    chunk.retrievalOperation,
  ]);
}

function isStitchable<TCitation>(chunk: StitchableChunk<TCitation>): boolean {
  return Boolean(
    chunk.repositoryId.trim() &&
    chunk.filePath.trim() &&
    chunk.repositoryVersion.trim() &&
    chunk.retrievalOperation.trim() &&
    Number.isInteger(chunk.startLine) &&
    Number.isInteger(chunk.endLine) &&
    chunk.startLine >= 1 &&
    chunk.endLine >= chunk.startLine,
  );
}

function mergeContent<TCitation>(ordered: readonly IndexedChunk<TCitation>[]): string {
  const parts: string[] = [];
  let coveredThrough = 0;

  for (const { chunk } of ordered) {
    const lines = chunk.content.split("\n");
    const coveredLines = Math.max(0, coveredThrough - chunk.startLine + 1);
    const remaining = coveredLines < lines.length ? lines.slice(coveredLines) : [];
    if (remaining.length > 0) parts.push(remaining.join("\n"));
    coveredThrough = Math.max(coveredThrough, chunk.endLine);
  }

  return parts.join("\n");
}

function toStitchedChunk<TCitation>(
  component: readonly IndexedChunk<TCitation>[],
): { chunk: StitchedChunk<TCitation>; rank: number } {
  const lineOrdered = [...component].sort(
    (left, right) =>
      left.chunk.startLine - right.chunk.startLine ||
      left.chunk.endLine - right.chunk.endLine ||
      left.rank - right.rank,
  );
  const rankOrdered = [...component].sort((left, right) => left.rank - right.rank);
  const primary = rankOrdered[0]!;
  const contributors = lineOrdered.map(({ chunk }) => chunk);
  const symbols = contributors
    .map((chunk) => chunk.symbol?.trim())
    .filter((symbol): symbol is string => Boolean(symbol));

  return {
    rank: primary.rank,
    chunk: {
      ...primary.chunk,
      content: mergeContent(lineOrdered),
      startLine: Math.min(...contributors.map((chunk) => chunk.startLine)),
      endLine: Math.max(...contributors.map((chunk) => chunk.endLine)),
      citations: contributors.flatMap((chunk) => chunk.citations),
      primaryChunk: primary.chunk,
      contributors,
      retrievalScores: contributors.map((chunk) => chunk.score),
      symbols: [...new Set(symbols)],
    },
  };
}

export function stitchAdjacentChunks<TCitation>(
  chunks: readonly StitchableChunk<TCitation>[],
  options: AdjacentChunkStitchingOptions,
): AdjacentChunkStitchingResult<TCitation> {
  if (!Number.isInteger(options.configuredLineGap) || options.configuredLineGap < 0) {
    throw new TypeError("configuredLineGap must be a non-negative integer");
  }
  const primaryChunkCount = options.primaryChunkCount ?? chunks.length;
  if (
    !Number.isInteger(primaryChunkCount) ||
    primaryChunkCount < 0 ||
    primaryChunkCount > chunks.length
  ) {
    throw new TypeError("primaryChunkCount must be between zero and the chunk count");
  }

  const indexed = chunks.map((chunk, rank) => ({ chunk, rank }));
  const groups = new Map<string, IndexedChunk<TCitation>[]>();
  const standalone: IndexedChunk<TCitation>[] = [];

  for (const entry of indexed) {
    if (!isStitchable(entry.chunk)) {
      standalone.push(entry);
      continue;
    }
    const key = groupKey(entry.chunk);
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  const output: Array<{ chunk: StitchedChunk<TCitation>; rank: number }> = standalone
    .filter((entry) => entry.rank < primaryChunkCount)
    .map((entry) => toStitchedChunk([entry]));
  let stitchCount = 0;
  let chunksMerged = 0;

  for (const group of groups.values()) {
    const ordered = [...group].sort(
      (left, right) =>
        left.chunk.startLine - right.chunk.startLine ||
        left.chunk.endLine - right.chunk.endLine ||
        left.rank - right.rank,
    );
    let component: IndexedChunk<TCitation>[] = [];
    let componentEnd = 0;

    const flush = () => {
      if (component.length === 0) return;
      const isAnchored = component.some((entry) => entry.rank < primaryChunkCount);
      if (!isAnchored) {
        component = [];
        componentEnd = 0;
        return;
      }
      output.push(toStitchedChunk(component));
      if (component.length > 1) {
        stitchCount += 1;
        chunksMerged += component.length;
      }
      component = [];
      componentEnd = 0;
    };

    for (const entry of ordered) {
      if (component.length === 0) {
        component = [entry];
        componentEnd = entry.chunk.endLine;
        continue;
      }
      const gap = entry.chunk.startLine - componentEnd - 1;
      if (gap <= options.configuredLineGap) {
        component.push(entry);
        componentEnd = Math.max(componentEnd, entry.chunk.endLine);
      } else {
        flush();
        component = [entry];
        componentEnd = entry.chunk.endLine;
      }
    }
    flush();
  }

  output.sort((left, right) => left.rank - right.rank);
  return {
    chunks: output.map(({ chunk }) => chunk),
    stitchCount,
    chunksMerged,
  };
}
