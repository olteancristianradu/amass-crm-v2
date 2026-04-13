-- S14: pgvector embedding columns for semantic search + similar records.
-- One nullable vector(1536) column per entity table. Populated asynchronously
-- by EmbeddingService using OpenAI text-embedding-3-small.
--
-- We use HNSW indexes (pgvector ≥ 0.5) because:
--   - No training data required (unlike IVFFlat which needs rows first)
--   - Better recall at lower probes count
--   - Smaller overhead on write-heavy dev workloads
-- m=16, ef_construction=64 are safe defaults; tune for prod with REINDEX.

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "embedding" vector(1536);
ALTER TABLE "contacts"  ADD COLUMN IF NOT EXISTS "embedding" vector(1536);
ALTER TABLE "clients"   ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

CREATE INDEX IF NOT EXISTS companies_embedding_hnsw_idx
  ON "companies" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS contacts_embedding_hnsw_idx
  ON "contacts" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS clients_embedding_hnsw_idx
  ON "clients" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
