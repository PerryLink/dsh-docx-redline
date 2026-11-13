/**
 * PS1 quickstart: run the two shipped synthetic .docx samples through the real tool layer.
 *
 *   node samples/quickstart/run.mjs            # human-readable run (used for the screenshot)
 *   node samples/quickstart/run.mjs --json     # the gold JSON on stdout (used by scripts/acceptance.mjs)
 *
 * No network, no model, no customer document: both files are assembled from OOXML parts by
 * scripts/make-samples.mjs. Requires `pnpm build` (or `tsc -p tsconfig.json`) first.
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createTools } from '../../lib/plugin/tools.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const jsonOnly = process.argv.includes('--json')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

class MemoryTable {
  constructor() { this.map = new Map() }
  get(key) { return this.map.get(key) }
  entries() { return this.map.entries() }
  get size() { return this.map.size }
  async put(key, value) { this.map.set(key, value) }
}

const inputs = ['samples/quickstart/input/contract-v1.docx', 'samples/quickstart/input/contract-v2.docx']
const samples = inputs.map((rel) => {
  const bytes = readFileSync(path.join(root, rel))
  return { path: rel, bytes: bytes.length, sha256: sha256(bytes) }
})

const workDir = mkdtempSync(path.join(tmpdir(), 'dsh-docx-redline-quickstart-'))
const exec = { callId: 'quickstart', agent: { id: 'quickstart' } }
const byId = new Map()

try {
  const tools = createTools({ table: new MemoryTable(), baseDir: workDir, inputRoots: [root] })
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))
  const inspect = async (rel, label) => {
    const value = await byName['doc_inspect'].execute({ path: path.join(root, rel), entity_id: 'ENT-DEMO' }, exec)
    byId.set(value.doc_id, label)
    return value
  }

  const v1 = await inspect(inputs[0], 'DOC-1')
  const v2 = await inspect(inputs[1], 'DOC-2')
  const relationships = await byName['doc_relationship_check'].execute({ path: path.join(root, inputs[0]) }, exec)
  const roundtrip = await byName['doc_roundtrip'].execute({ doc_id: v1.doc_id }, exec)
  const changes = await byName['doc_change_summary'].execute({ path: path.join(root, inputs[1]) }, exec)
  const diff = await byName['redline_diff'].execute({ base_doc_id: v1.doc_id, target_doc_id: v2.doc_id }, exec)

  const gold = {
    _note: 'Real tool output. doc ids are random per run, so they are normalised to DOC-1/DOC-2 here; every other value is verbatim. The roundtrip copies live in a temp dir, so only the compared result is recorded.',
    samples,
    inspect: [
      { doc: 'DOC-1', sha256: v1.sha256, size: v1.size, parts_count: v1.parts_count, structure: v1.structure, warnings: v1.warnings },
      { doc: 'DOC-2', sha256: v2.sha256, size: v2.size, parts_count: v2.parts_count, structure: v2.structure, warnings: v2.warnings },
    ],
    relationships,
    roundtrip: {
      doc: 'DOC-1',
      zero_diff: roundtrip.zero_diff,
      parts_compared: roundtrip.parts_compared,
      missing_parts: roundtrip.missing_parts,
      extra_parts: roundtrip.extra_parts,
      hash_mismatch: roundtrip.hash_mismatch,
    },
    change_summary: { doc: 'DOC-2', insertions: changes.insertions, deletions: changes.deletions, total: changes.total, authors: changes.authors },
    diff: { base: 'DOC-1', target: 'DOC-2', added: diff.added, removed: diff.removed, hunks: diff.hunks },
  }

  if (jsonOnly) {
    process.stdout.write(`${JSON.stringify(gold, null, 2)}\n`)
  } else {
    const s = v1.structure
    console.log(`sample: ${samples[0].path} (${samples[0].bytes} B, sha256 ${samples[0].sha256.slice(0, 16)}…)`)
    console.log(`sample: ${samples[1].path} (${samples[1].bytes} B, sha256 ${samples[1].sha256.slice(0, 16)}…)`)
    console.log('samples are synthetic: fictional parties/amounts, no customer document')
    console.log(`doc_inspect            DOC-1 parts=${v1.parts_count} p=${s.paragraphs} tbl=${s.tables} hdr=${s.headers} ftr=${s.footers} comments=${s.comments} fields=${s.fields} bookmarks=${s.bookmarks} warnings=${v1.warnings.length}`)
    console.log(`doc_inspect            DOC-2 p=${v2.structure.paragraphs} (+1 clause inserted with track changes)`)
    console.log(`doc_relationship_check relationships=${relationships.relationships} referenced=${relationships.referenced} external=${relationships.external} issues=${relationships.issues.length}`)
    console.log(`doc_roundtrip          DOC-1 zero_diff=${roundtrip.zero_diff} parts_compared=${roundtrip.parts_compared}`)
    console.log(`doc_change_summary     DOC-2 insertions=${changes.insertions} deletions=${changes.deletions} authors=${Object.entries(changes.authors).map(([who, n]) => `${who}:${n}`).join(' ')}`)
    console.log(`redline_diff           DOC-1 → DOC-2 added=${diff.added} removed=${diff.removed} hunks=${diff.hunks.length}`)
    for (const hunk of diff.hunks) console.log(`  ${hunk.op === 'add' ? '+' : '-'} ${hunk.text}`)
    console.log(`ok: quickstart finished (6 tool calls, roundtrip byte-identical per part)`)
  }
} finally {
  rmSync(workDir, { recursive: true, force: true })
}
