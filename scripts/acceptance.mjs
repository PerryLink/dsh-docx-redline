/** SKU-01 S1 acceptance: 20 synthetic DOCX + 5 malformed; public/synthetic, not counted. */

import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { createTools } from '../lib/plugin/tools.js'
import { DocxError } from '../lib/core/docx.js'
import { relationshipCheck, revisionSummary } from '../lib/adapters/docx-zip.js'

class FakeTable {
  map = new Map()
  get(key) { return this.map.get(key) }
  entries() { return this.map.entries() }
  keys() { return this.map.keys() }
  get size() { return this.map.size }
  async put(key, value) { this.map.set(key, value) }
  async delete(key) { return this.map.delete(key) }
}

const contentTypes = `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
const styles = `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal"/><w:style w:type="paragraph" w:styleId="Heading1"/></w:styles>`
const comments = `<?xml version="1.0"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="A"><w:p><w:r><w:t>note</w:t></w:r></w:p></w:comment></w:comments>`
const footnotes = `<?xml version="1.0"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>fn</w:t></w:r></w:p></w:footnote></w:footnotes>`
const numbering = `<?xml version="1.0"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"/><w:num w:numId="1"/></w:numbering>`
const header = `<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:hdr>`
const footer = `<?xml version="1.0"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:ftr>`

function makeDocx(index) {
  const paragraphs = Array.from({ length: 3 + (index % 4) }, (_, i) => `<w:p><w:r><w:t>Paragraph ${i}</w:t></w:r></w:p>`).join('')
  const table = index % 3 === 0 ? '' : `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
  const doc = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple><w:bookmarkStart w:id="0" w:name="bm"/></w:p>${table}<w:sectPr/></w:body></w:document>`
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'),
    'word/document.xml': strToU8(doc),
    'word/styles.xml': strToU8(styles),
    'word/comments.xml': strToU8(comments),
    'word/footnotes.xml': strToU8(footnotes),
    'word/numbering.xml': strToU8(numbering),
    'word/header1.xml': strToU8(header),
    'word/footer1.xml': strToU8(footer),
  }))
}

const root = process.cwd()
const runId = `sku01-${new Date().toISOString().replace(/[:.]/g, '-')}`
const evidenceDir = path.join(root, 'evidence', runId)
mkdirSync(evidenceDir, { recursive: true })
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-docx-accept-'))
const samples = []
let roundtripPass = 0
let malformedRejected = 0
const coverage = new Set()
try {
  const table = new FakeTable()
  const tools = createTools({ table, baseDir: path.join(dir, 'store'), inputRoots: [dir] })
  const inspect = tools.find((tool) => tool.name === 'doc_inspect')
  const roundtrip = tools.find((tool) => tool.name === 'doc_roundtrip')
  const exec = { callId: 'acceptance', agent: { id: 'acceptance' } }
  for (let index = 0; index < 20; index += 1) {
    const file = path.join(dir, `sample-${index}.docx`)
    const buffer = makeDocx(index)
    await writeFile(file, buffer)
    const result = await inspect.execute({ path: file, entity_id: 'ENT-A' }, exec)
    const rt = await roundtrip.execute({ doc_id: result.doc_id }, exec)
    if (rt.zero_diff) roundtripPass += 1
    const s = result.structure
    if (s.paragraphs > 0) coverage.add('paragraphs')
    if (s.tables > 0) coverage.add('tables')
    if (s.headers > 0 && s.footers > 0) coverage.add('headers-footers')
    if (s.footnotes > 0 && s.comments > 0) coverage.add('footnotes-comments')
    if (s.fields > 0 && s.bookmarks > 0 && s.numbered_paragraphs > 0) coverage.add('fields-bookmarks-numbering')
    if (s.sections > 0 && s.styles > 0) coverage.add('sections-styles')
    samples.push({ name: `sample-${index}`, sha256: sha256(buffer), parts: result.parts_count })
  }
  const malformed = [
    Buffer.alloc(0),
    Buffer.from('not a zip'),
    Buffer.from(zipSync({ '[Content_Types].xml': strToU8(contentTypes) })),
    Buffer.from(zipSync({ '[Content_Types].xml': strToU8(contentTypes), 'word/document.xml': strToU8('not xml') })),
    Buffer.from(zipSync({ 'word/document.xml': strToU8('<w:document/>') })),
  ]
  for (let index = 0; index < malformed.length; index += 1) {
    const file = path.join(dir, `bad-${index}.docx`)
    await writeFile(file, malformed[index])
    try {
      await inspect.execute({ path: file }, exec)
    } catch (error) {
      if (error instanceof DocxError) malformedRejected += 1
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true })
}

const revXml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
  + '<w:p><w:ins w:id="1" w:author="A"><w:r><w:t>added</w:t></w:r></w:ins></w:p>'
  + '<w:p><w:del w:id="2" w:author="B"><w:r><w:delText>removed</w:delText></w:r></w:del></w:p>'
  + '<w:p><w:ins w:id="3" w:author="A"><w:r><w:t>again</w:t></w:r></w:ins></w:p></w:body></w:document>'
const revBuf = Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  'word/document.xml': strToU8(revXml),
}))
const rev = revisionSummary(revBuf)
const relBuf = Buffer.from(zipSync({ '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'), 'word/document.xml': strToU8('<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body><w:p><w:hyperlink r:id="rId1"/></w:p></w:body></w:document>'), 'word/_rels/document.xml.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="header1.xml"/></Relationships>'), 'word/header1.xml': strToU8('<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>') }))
const rel = relationshipCheck(relBuf)
const qs = JSON.parse(execFileSync(process.execPath, ['samples/quickstart/run.mjs', '--json'], { encoding: 'utf8' }))
const qsGoldText = readFileSync('samples/quickstart/expected/result.json', 'utf8')
const qsOk = JSON.stringify(qs) === JSON.stringify(JSON.parse(qsGoldText))
const qsSha = sha256(Buffer.from(qsGoldText))

const metrics = [
  { req_id: 'SKU-01-A01', metric: '无改动往返通过率（20 合成）', threshold: '100%', actual: roundtripPass / 20, pass: roundtripPass === 20, counted: false },
  { req_id: 'SKU-01-A02', metric: '结构覆盖（6 类）', threshold: '6/6', actual: coverage.size, pass: coverage.size === 6, counted: false },
  { req_id: 'SKU-01-A03', metric: '畸形拒绝率（5 份）', threshold: '100%', actual: malformedRejected / 5, pass: malformedRejected === 5, counted: false },
  { req_id: 'SKU-01-A04', metric: '修订统计（w:ins/w:del）', threshold: '2/1', actual: `${rev.insertions}/${rev.deletions}`, pass: rev.insertions === 2 && rev.deletions === 1 && rev.authors.A === 2, counted: false },
  { req_id: 'SKU-01-A05', metric: 'OOXML 关系完整性', threshold: '0 issues', actual: rel.issues.length, pass: rel.issues.length === 0 && rel.referenced === 1 && rel.relationships === 1, counted: false },
  { req_id: 'PS1-QS01', metric: 'quickstart 样例与金标一致', threshold: '1/1', actual: qsOk ? 1 : 0, pass: qsOk, evidence_sha256: qsSha, source: 'synthetic/quickstart', counted: true },
]
const result = {
  run_id: runId,
  timestamp: new Date().toISOString(),
  scope: 'SKU-01-S1',
  status: 'partial',
  counted: false,
  note: 'synthetic only; user-approved public/synthetic demo; 0 real DOCX pairs',
  samples,
  metrics,
  pass: metrics.every((metric) => metric.pass),
}
const resultText = `${JSON.stringify(result, null, 2)}\n`
writeFileSync(path.join(evidenceDir, 'result.json'), resultText)
const evidenceSha = sha256(resultText)
const csv = ['req_id,metric,threshold,actual,script,evidence_sha256,pass,source,counted', ...metrics.map((m) => `${m.req_id},${m.metric},${m.threshold},${m.actual},scripts/acceptance.mjs,${m.evidence_sha256 ?? evidenceSha},${m.pass},${m.source ?? 'public/synthetic'},${m.counted ?? false}`)].join('\n') + '\n'
writeFileSync(path.join(root, 'ACCEPTANCE.csv'), csv)
if (!result.pass) {
  console.error(JSON.stringify(result, null, 2))
  process.exit(1)
}
console.log(`acceptance ok: ${runId}; coverage=${coverage.size}/6; roundtrip=${roundtripPass}/20; malformed=${malformedRejected}/5`)


// Normalize the public-only acceptance schema: source + counted=false.
{
  const fs = await import('node:fs')
  const file = 'ACCEPTANCE.csv'
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  if (!lines[0].includes('source,counted')) {
    lines[0] += ',source,counted'
    for (let i = 1; i < lines.length; i += 1) lines[i] += ',public/synthetic,false'
    fs.writeFileSync(file, lines.join('\n') + '\n')
  }
}
