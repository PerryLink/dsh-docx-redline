# SKU-01 approval and evidence — 2026-10-31

**User approval**: on 2026-10-31 the user said "现在和未来都批准，然后发布。然后继续后面新的包（项目）的开发". This is explicit approval for the public/synthetic demo path for subsequent SKUs. It does **not** convert synthetic data into the customer gate.

## Gate status

- Required: 20 real double-version DOCX pairs + 5 malformed DOCX (plus E2 doc-core).
- Current authorized real evidence: **0 pairs / 0 malformed**; E2 is not a shipped base, so S1 builds a self-contained reader.
- Public/synthetic demo is approved; every acceptance row is `not counted`, `STATUS: partial`.
- No customer PII is committed; synthetic fixtures only.

## S1 scope (narrow)

- `doc_inspect`: DOCX ZIP/XML reader; structure counts for paragraphs, tables, headers/footers, footnotes, comments, fields, bookmarks, numbering, sections/styles.
- `doc_roundtrip`: byte/part-hash no-change copy; zero-diff report.
- Storage: one `docx` domain / `documents` table.
- Client/Skill/Bundle: deferred (S1 host-only).
