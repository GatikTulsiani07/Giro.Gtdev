// Compresses context to fit within a character budget while preserving key structures.

import type { SemanticSearchResult } from "../embeddings/types.js";

const TRUNCATION_MARKER = "\n… trimmed …\n";

// Lines that carry high structural signal and should be preserved.
const IMPORTANT_LINE_RE =
  /^(import |export |function |class |interface |type |const |async function |module\.exports)/;

function compressChunk(content: string, budget: number): string {
  if (content.length <= budget) return content;

  const lines = content.split("\n");
  const important: string[] = [];
  const rest: string[] = [];

  for (const line of lines) {
    if (IMPORTANT_LINE_RE.test(line.trimStart())) {
      important.push(line);
    } else {
      rest.push(line);
    }
  }

  // Always keep important lines; fill remaining budget with other lines.
  let result = important.join("\n");
  if (result.length >= budget) {
    return result.slice(0, budget - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
  }

  const remaining = budget - result.length - TRUNCATION_MARKER.length;
  const filler = rest.join("\n").slice(0, remaining);
  result = result + "\n" + filler + TRUNCATION_MARKER;

  return result;
}

export function compressContext(
  results: SemanticSearchResult[],
  maxCharacters: number,
): SemanticSearchResult[] {
  const compressed: SemanticSearchResult[] = [];
  let totalChars = 0;

  for (const result of results) {
    if (totalChars >= maxCharacters) break;

    const remainingBudget = maxCharacters - totalChars;
    const content =
      result.content.length > remainingBudget
        ? compressChunk(result.content, remainingBudget)
        : result.content;

    compressed.push({ ...result, content });
    totalChars += content.length;
  }

  return compressed;
}
