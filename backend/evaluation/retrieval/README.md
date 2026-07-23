# Offline retrieval evaluation

The harness reads `benchmarks.json` and `repository-fixtures.json`, generates
deterministic offline lexical, semantic, symbol, and path candidates, and runs
them through Hybrid Retrieval V2. It never calls a production database or
public API.

Commands:

- `pnpm eval:retrieval` writes `.reports/retrieval-evaluation.json`.
- `pnpm eval:retrieval:regression` applies `thresholds.json` and exits non-zero
  when a required gate fails.
- `pnpm eval:retrieval:baseline -- --confirm --overwrite` is the only supported
  way to replace the checked-in baseline. `--confirm` is required, and an
  existing baseline additionally requires `--overwrite`.
- `pnpm eval:retrieval:external` is optional and requires `OPENAI_API_KEY`. It
  is intentionally separate from deterministic local and regression runs.

Benchmark cases use schema version 1 and include a stable benchmark ID,
fixture/revision identity, natural-language query, relevant files, symbols and
optional chunks, plus optional exclusions, category, difficulty, and notes.
Repository fixture revisions include publication and embedding metadata; the
harness rejects unpublished revisions and incompatible embeddings.
