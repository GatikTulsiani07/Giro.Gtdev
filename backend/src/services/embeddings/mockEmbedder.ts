// Deterministic mock embedding generator for local development.
// Produces a 1536-dimension vector derived from a simple hash of the input text.
// Same text always produces the same vector. No external API calls.

import { createHash } from "node:crypto";

const VECTOR_LENGTH = 1536;

export function generateMockEmbedding(text: string): number[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  // Use SHA-256 to get a deterministic seed from the text
  const hash = createHash("sha256").update(normalized).digest();

  const vector: number[] = [];
  for (let i = 0; i < VECTOR_LENGTH; i++) {
    // Cycle through hash bytes, normalize to [-1, 1] range
    const byte = hash[i % hash.length] as number;
    // Mix in the index to avoid repeating patterns
    const mixed = (byte + i * 7) % 256;
    vector.push((mixed / 255) * 2 - 1);
  }

  // Normalize to unit vector (cosine similarity expects this)
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return vector.map((v) => v / magnitude);
}
