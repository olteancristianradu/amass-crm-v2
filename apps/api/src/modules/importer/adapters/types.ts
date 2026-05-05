/**
 * Importer adapter contract.
 *
 * The pipeline is: file (Buffer) → adapter.parse() → RawRow[] → mapper
 * (existing gestcom-mapper or future format-specific mapper) → upsert.
 *
 * Each format has its own adapter. The factory picks one based on mime
 * type or file extension. New formats only need to:
 *   1. Implement ImporterAdapter
 *   2. Register the adapter in adapters/factory.ts
 *
 * Existing CSV path goes through Papa.parse directly in import.processor.ts.
 * This module is the seam for new formats (Excel, SmartBill, SAGA, GestCom
 * proprietary, PDF) without rewriting the processor.
 */

/** A single parsed row, as a flat key-value map. */
export type RawRow = Record<string, unknown>;

export interface ParseResult {
  /** Successfully extracted rows, in the order they appeared in the source. */
  rows: RawRow[];

  /** Non-fatal warnings the operator should see (e.g. "row 47 had a mismatched column count"). */
  warnings: string[];

  /** Detected source language/locale, if applicable. Used by mappers for column-name heuristics. */
  detectedLocale?: 'ro' | 'en' | 'unknown';
}

export interface ImporterAdapter {
  /** Stable id used in logs and audit entries. */
  readonly id: string;

  /** Human-readable label for UI selection. */
  readonly label: string;

  /**
   * True if this adapter can parse the file. Called with mime type AND
   * file extension because mime detection (multer) is unreliable for
   * proprietary formats (GestCom .DBF, SAGA .SDF). Adapters use whichever
   * signal is more discriminating.
   */
  canHandle(input: { mimeType: string; fileName: string; magicBytes?: Buffer }): boolean;

  /**
   * Parse the file. Should NOT throw on individual row errors — collect
   * them in `warnings`. Throw only on unrecoverable file-level errors
   * (corrupt header, encryption, completely wrong format).
   */
  parse(buffer: Buffer): Promise<ParseResult>;
}
