# Fixtures — SKU-01 S1

- Valid synthetic DOCX: 20 in `scripts/acceptance.mjs` (3–6 paragraphs, optional table, numbering/field/bookmark, header/footer, footnote, comment, styles).
- Malformed: empty, non-ZIP, missing `[Content_Types].xml`, missing `word/document.xml`, non-DOCX `document.xml`.
- No real customer DOCX, no PII, no `fixtures/input` commit.
- `doc_roundtrip` writes copies only to a temp/`DSH_DOCX_HOME` directory.

## Public MIT DOCX samples (2026-10-31)

`fixtures/public/python-docx/` contains 6 DOCX test files from `python-openxml/python-docx` (MIT; see `SOURCE.md` and `LICENSE`). They are used by `test/public-docx.test.mjs` to exercise real OOXML variants (headers/footers, comments, numbering, hyperlinks, section properties). They are public test documents, **not customer evidence**, and are not shipped in the npm tarball.
