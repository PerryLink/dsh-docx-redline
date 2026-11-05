# Changelog

## [Unreleased]

### Fixed

- Resolve internal relationship targets relative to `word/document.xml`, including `.` and `..` segments, before checking package parts. Valid parent-relative targets no longer produce false missing-part reports on Windows or POSIX hosts.

## [0.1.0] — 2026-11-02

### Stable

- First non-alpha release: the CLI surface and the tool names in this package are now
  covered by a compatibility promise (breaking changes require a minor bump).
- Ships a quickstart sample, a one-line prompt, a permission block and real captures,
  so the package can be tried without reading the source.

## [0.1.0] — 2026-11-01

### Security / Fixes

- Pre-extraction limits on every zip read (entry count, per-entry and total size, compression ratio), function-form text replacement that cannot inject OOXML, and part-wise roundtrip verification instead of a self-comparing hash.


### Security

- Every DOCX read now goes through `safeUnzip()` with pre-decompression limits (1000 entries, 4MB per entry, 32MB total, 100:1 compression above 1MB) and throws `E_DOC_ZIP_LIMIT`; actual sizes are re-checked after inflate. This covers all six former `unzipSync` call sites.
- `doc.replace_text` uses a function replacement so `$&`, `$1` and `` $` `` stay literal, validates the generated WML with `XMLValidator`/`XMLParser`, and fails before writing.
- `doc.roundtrip` now unpacks both packages and compares every part instead of treating whole-file SHA equality as proof; the output and stored record add `extra_parts`.

### Changed

- READMEs, package description and architecture docs now say "part-wise identical" instead of "byte-exact".

### Tests

- Added `test/security.test.mjs` (5.5KB/5MB ZIP bomb, all six readers, three replacement payloads, part-wise roundtrip). `node --test test/*.test.mjs`: 27/27.

## [Unreleased]

### Added

- `doc.relationship_check`: OOXML package relationship integrity — every `r:id`/`r:embed` in `document.xml` must be declared in `document.xml.rels`, and every internal target part must exist in the zip. Verified by `node --test test/*.test.mjs` (22/22).

## [Unreleased]

### Added

- `doc.change_summary`: tracked-revision summary for a local DOCX — insertion/deletion counts and per-author totals from OOXML WML `w:ins` / `w:del`. Read-only; it does not accept or reject revisions. Verified by `node --test test/*.test.mjs` (18/18).

## [0.1.0-alpha.9] — 2026-11-01

### Changed

- Documentation: five-language fixture/acceptance links now resolve on npm; added specific related-checker/tool links.
- Marketplace metadata: taxonomy category, archetype, domains and status; docs page now shows the same.

All notable changes to `dsh-docx-redline` are documented here. The format follows Keep a Changelog; this project uses alpha versions.

## [0.1.0-alpha.8] — 2026-11-01

### Added

- Five-language READMEs: English, 简体中文, Español, Português, हिन्दी.
- Local workflow SVG at `docs/assets/dsh-docx-redline-flow.svg`.
- Family cross-links (domain index, checker family, `dsh-kit`), compatibility, permissions, and related-work sections.
- Standard repository files: `SECURITY.md`, `PRIVACY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, and `icon.svg`.

### Changed

- README aligned with the PerryLink DSH checker/plugin family style; package remains public/synthetic, alpha, not GA.

### Maintenance

- 2026-11-01: active again — feature work, hardening and fresh evidence resumed.

## [Earlier]

Earlier alpha builds are available from npm and GitHub Releases; this file starts at the family-standard documentation wave.
