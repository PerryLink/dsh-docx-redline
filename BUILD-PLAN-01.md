# BUILD-PLAN-01 — SKU-01 DOCX redline S1 (public/synthetic)

## 1. Gate and approval

- Customer gate: **20 real double-version DOCX pairs + 5 malformed**; current **0/0**. E2 doc-core is not shipped, so S1 is a self-contained reader.
- User approved the public/synthetic demo path on **2026-10-31** ("现在和未来都批准").
- `ACCEPTANCE.csv` rows are `not counted`; `STATUS: partial`.

## 2. Scope

- `doc_inspect`: parts + SHA-256 + six structure families.
- `doc_roundtrip`: byte-for-byte copy + all-part hash compare; zero-diff report.
- One storage entity (`docx.documents`); no Client/Skill/Bundle/MCP.
- No OOXML writing, diff, revisions, rendering, Word/LibreOffice automation.

## 3. Tools

| Tool | Input | Output | Risk |
|---|---|---|---|
| `doc_inspect` | `path`, optional `entity_id` | `doc_id`, `sha256`, `size`, `existing`, `parts_count`, `structure`, `warnings` | R0 + local store |
| `doc_roundtrip` | `doc_id` | `input_sha256`, `output_sha256`, `zero_diff`, `parts_compared`, `missing_parts`, `hash_mismatch` | R1 |

## 4. Storage

`defineDomain({name:'docx',version:1,tables:{documents}})`, JSON KV; no migration; originals by SHA-256 under `DSH_DOCX_HOME/originals`; roundtrip copies under `roundtrip/`.

## 5. Acceptance

| ID | Metric | Threshold |
|---|---|---|
| SKU-01-A01 | no-change roundtrip (20 synthetic) | 100% |
| SKU-01-A02 | six structure families | 6/6 |
| SKU-01-A03 | malformed DOCX rejection (5) | 100% |

## 6. Fixtures

Synthetic DOCX generated in `scripts/acceptance.mjs` and tests; 20 valid + 5 malformed. No real document or PII is committed.

## 7. Failure paths

`E_DOC_FILE_UNREADABLE`, `E_DOC_PATH_NOT_ALLOWED`, `E_DOC_ZIP_LIMIT`, `E_DOC_UNREADABLE`, `E_DOC_DOC_NOT_FOUND`, `E_DOC_ROUNDTRIP_FAILED`.

## 8. Publish

`dsh-docx-redline@0.1.0-alpha.0`, `--tag next`, public registry. Name audit: scoped and bare both 404; similar public packages are `@ansonlai/docx-redline-js`, `docxodus`, `jubarte-redlines` (different scope/API).

## 9. Risks

- OOXML long tail: whitelist, fail-closed, no silent repair.
- No real pairs → no accuracy claim; only roundtrip/structure on synthetic.
- E2 base missing → S1 reader is self-contained; S2 alignment needs its own design.

## 10. Out of scope

Redline diff/apply, fidelity verify, ledger, Client, OCR, PDF, real customer documents.
