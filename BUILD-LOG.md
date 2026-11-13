# BUILD-LOG — dsh-docx-redline

## 2026-10-31 — S1 / 0.1.0-alpha.0

- Gate: 0 real DOCX pairs / 0 malformed; user-approved public/synthetic demo; `partial`, `not counted`.
- Tools: `doc_inspect`, `doc_roundtrip`; one `docx` domain/table; 5 source + config files.
- `pnpm test` 4/4; `gate:sku01` 3 rows (roundtrip 20/20, structure 6/6, malformed 5/5).
- Name audit: `dsh-docx-redline` and bare `dsh-docx-redline` both npm 404; similar packages exist (`@ansonlai/docx-redline-js`, `docxodus`, `jubarte-redlines`), different scope/API.
- Publish: pending.

### Publish submitted

- `npm publish --tag next` exit 0; tarball shasum `a6121063c7d351b959a5702faf1d8812514c46d6`; registry propagation pending.

### Verification and publish (2026-10-31 06:50 +08)

- `pnpm test` 4/4; `gate:sku01` 3/3 (roundtrip 20/20, structure 6/6, malformed 5/5); lint/typecheck/pack/SBOM/license pass.
- npm publish exit 0; tarball `a6121063c7d351b959a5702faf1d8812514c46d6`; `dist-tags` latest/next `0.1.0-alpha.0`.
- Registry tarball install + layer check passed; pnpm metadata mirror lag noted in `PUBLISH-STATUS.md`.

### Public MIT DOCX samples + CI (2026-10-31)

- Added 6 MIT test DOCX from `python-openxml/python-docx` under `fixtures/public/python-docx/` with LICENSE/SOURCE; public test `test/public-docx.test.mjs` passes 6/6.
- Added `.github/workflows/ci.yml` (Node 24, pnpm 11.28.5, build/lint/typecheck/test/gate:sku01).

### alpha.1 verified

- `latest`/`next` alpha.1; public MIT DOCX tests 6/6; CI run 41168443922 success.

### alpha.2 — text-level diff

- Added `redline_diff` (paragraph LCS, add/remove hunks); does not write OOXML; public samples remain MIT.

### alpha.2 verified

- `latest`/`next` alpha.2; 11/11 tests; CI run 41168790819 success. `redline_diff` is text-level only.

### alpha.3 — limited OOXML replace

- Added `doc_replace_text`; exact text run write; tests 13/13.
