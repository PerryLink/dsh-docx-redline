# Architecture — SKU-01 S1

```text
core/docx.ts       error codes, limits, structure type
adapters/docx-zip.ts  fflate unzip + fast-xml-parser structure counts
plugin/storage.ts  docx domain (documents), originals, ULID
plugin/tools.ts    doc_inspect / doc_roundtrip
plugin/index.ts    DSH Host entry
```

Data flow: local `.docx` → path allowlist → ZIP limits → `[Content_Types].xml`/`word/document.xml` check → XML structure counts → local original → `documents` record; `doc_roundtrip` copies the package, unpacks both copies and compares every part hash (part-wise identical).

The reader is deliberately a whitelist: no macros, no external relationships, no XML entity expansion. The no-change roundtrip verifies unpacked parts rather than comparing the copy's whole-file SHA, so it cannot claim identity it did not check. S2 (diff/redline) and S3 (verify/ledger) are not part of this package.
