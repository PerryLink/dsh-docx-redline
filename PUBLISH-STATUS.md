# PUBLISH-STATUS — dsh-docx-redline

## 0.1.0-alpha.0 — submitted 2026-10-31T06:48+08:00

- `npm publish --access public --tag next --registry=https://registry.npmjs.org/` → exit 0; tarball shasum `a6121063c7d351b959a5702faf1d8812514c46d6`.
- Registry root was 404 immediately after publish; first-package processing/placeholder propagation. Re-check before announcing.
- No unpublish/deprecate.

### Update 2026-10-31T06:50+08:00

- `dist-tags`: `{ latest: "0.1.0-alpha.0", next: "0.1.0-alpha.0" }`; exact version metadata is public and `npm view` succeeds.
- Direct registry tarball install into a temp DSH profile passed:
  `dsh plugin add https://registry.npmjs.org/dsh-docx-redline/-/dsh-docx-redline-0.1.0-alpha.0.tgz` → layer `# == dsh-docx-redline`.
- pnpm's **metadata endpoint** briefly returned 404 immediately after publish (cache/mirror propagation), while the direct registry metadata was 200; use the exact version or tarball URL until the mirror catches up.
- `latest` is alpha because this is the first/only version; not GA.

## 0.1.0-alpha.1 — verified 2026-10-31T12:26+08:00

- `latest` and `next` both `0.1.0-alpha.1`; tarball includes the updated public-sample notice but not the DOCX binaries/tests (they stay in GitHub, not npm).
- `dist-tags` verified after propagation.
- GitHub Actions `ci` run 41168443922: success; 10/10 local tests (4 unit + 6 public MIT DOCX samples), gate 3 rows.

## 0.1.0-alpha.2 — verified 2026-10-31T12:32+08:00

- `latest` and `next` both `0.1.0-alpha.2`; 11/11 local tests, 3 S1 gate rows.
- GitHub Actions `ci` run 41168790819: success.
- `redline_diff` is **text-level paragraph diff only**; it does not write OOXML or produce a Word redline, and has no separate acceptance row.

## 0.1.0-alpha.3 — limited OOXML replace (2026-10-31)

- Added `doc_replace_text`; exact single-run write; no comments/fields rewrite; synthetic tests.
