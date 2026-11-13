# Development

Add a new structural count in `src/adapters/docx-zip.ts`:

1. Count only whitelisted OOXML elements; never parse external relationships or execute fields.
2. Extend `DocxStructure` and the `structureOut()` schema together.
3. Add a synthetic fixture in `test/docx.test.mjs`; keep `[Content_Types].xml` and `word/document.xml` present.
4. Run `pnpm lint && pnpm typecheck && pnpm test && pnpm gate:sku01`.

S1 intentionally does not ship `redline_*` or a Client. Do not add OOXML-writing tools until S2/S3 gates and a real customer evidence path exist.
