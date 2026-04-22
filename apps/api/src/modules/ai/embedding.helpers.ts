/**
 * Pure helpers for the embedding pipeline. Keeping them outside
 * EmbeddingService makes them trivially unit-testable — no Prisma mock
 * needed, no Anthropic/OpenAI mock needed.
 */

/**
 * Format a JS number array as a pgvector literal: `[1.2,3.4,5.6]`.
 * Postgres accepts both with and without spaces; we emit no spaces to
 * keep the literal short.
 *
 * Not defence-in-depth against injection — the values come from our own
 * model output, never from user input. If that ever changes (e.g. a
 * client uploads their own vectors), add a numeric validator here.
 */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/** Clamp the input length so the embedding API call stays under the
 *  provider's token cap. 8192 UTF-16 code units ≈ 6k tokens on average —
 *  a comfortable fit for text-embedding-3-small (8k max) and gemini
 *  (20k max). */
export function truncateForEmbedding(input: string, max = 8192): string {
  return input.slice(0, max);
}
