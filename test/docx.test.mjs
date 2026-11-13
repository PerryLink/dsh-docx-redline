import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { inspectDocx, paragraphTexts } from '../lib/adapters/docx-zip.js'
import { createTools } from '../lib/plugin/tools.js'

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
const documentXml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Alpha</w:t></w:r></w:p>
<w:p><w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple><w:bookmarkStart w:id="0" w:name="bm"/></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:sectPr><w:headerReference w:type="default" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><w:footerReference w:type="default" r:id="rId2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></w:sectPr>
</w:body></w:document>`
const stylesXml = `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal"/><w:style w:type="paragraph" w:styleId="Heading1"/></w:styles>`
const commentsXml = `<?xml version="1.0"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="A"><w:p><w:r><w:t>note</w:t></w:r></w:p></w:comment></w:comments>`
const footnotesXml = `<?xml version="1.0"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1"><w:p><w:r><w:t>fn</w:t></w:r></w:p></w:footnote></w:footnotes>`
const numberingXml = `<?xml version="1.0"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"/><w:num w:numId="1"/></w:numbering>`

function makeDocx(extra = {}) {
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'),
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8(stylesXml),
    'word/comments.xml': strToU8(commentsXml),
    'word/footnotes.xml': strToU8(footnotesXml),
    'word/numbering.xml': strToU8(numberingXml),
    'word/header1.xml': strToU8('<?xml version="1.0"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:hdr>'),
    'word/footer1.xml': strToU8('<?xml version="1.0"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:ftr>'),
    ...extra,
  }))
}

test('inspectDocx counts six structure families', () => {
  const result = inspectDocx(makeDocx())
  assert.ok(result.structure.paragraphs >= 3)
  assert.equal(result.structure.tables, 1)
  assert.equal(result.structure.table_rows, 1)
  assert.equal(result.structure.table_cells, 1)
  assert.equal(result.structure.headers, 1)
  assert.equal(result.structure.footers, 1)
  assert.equal(result.structure.footnotes, 1)
  assert.equal(result.structure.comments, 1)
  assert.equal(result.structure.fields, 1)
  assert.equal(result.structure.bookmarks, 1)
  assert.equal(result.structure.numbered_paragraphs, 1)
  assert.equal(result.structure.sections, 1)
  assert.equal(result.structure.styles, 2)
  assert.equal(result.parts.length, 9)
})

test('inspectDocx rejects non-DOCX and missing document.xml', () => {
  assert.throws(() => inspectDocx(Buffer.alloc(0)), /E_DOC_FILE_UNREADABLE/)
  assert.throws(() => inspectDocx(Buffer.from('not a zip')), /E_DOC_UNREADABLE/)
  assert.throws(() => inspectDocx(Buffer.from(zipSync({ '[Content_Types].xml': strToU8(contentTypes) }))), /E_DOC_UNREADABLE/)
})

test('doc_inspect and doc_roundtrip are idempotent and zero-diff', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-docx-test-'))
  try {
    const file = path.join(dir, 'sample.docx')
    await writeFile(file, makeDocx())
    const table = new FakeTable()
    const tools = createTools({ table, baseDir: path.join(dir, 'store'), inputRoots: [dir] })
    const inspect = tools.find((tool) => tool.name === 'doc_inspect')
    const roundtrip = tools.find((tool) => tool.name === 'doc_roundtrip')
    const exec = { callId: 'call-1', agent: { id: 'agent-1' } }
    const first = await inspect.execute({ path: file, entity_id: 'ENT-A' }, exec)
    assert.equal(first.existing, false)
    assert.equal(first.structure.tables, 1)
    const second = await inspect.execute({ path: file }, exec)
    assert.equal(second.existing, true)
    assert.equal(second.doc_id, first.doc_id)
    const rt = await roundtrip.execute({ doc_id: first.doc_id }, exec)
    assert.equal(rt.zero_diff, true)
    assert.equal(rt.hash_mismatch.length, 0)
    assert.ok(rt.parts_compared >= 9)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('path allowlist and unknown doc fail closed', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-docx-test-'))
  try {
    const table = new FakeTable()
    const tools = createTools({ table, baseDir: path.join(dir, 'store'), inputRoots: [dir] })
    const inspect = tools.find((tool) => tool.name === 'doc_inspect')
    const roundtrip = tools.find((tool) => tool.name === 'doc_roundtrip')
    await assert.rejects(() => inspect.execute({ path: '/etc/hosts' }, { callId: 'c' }), /E_DOC_PATH_NOT_ALLOWED/)
    await assert.rejects(() => roundtrip.execute({ doc_id: 'missing' }, { callId: 'c' }), /E_DOC_DOC_NOT_FOUND/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('redline_diff reports paragraph changes without writing OOXML', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-docx-diff-'))
  try {
    const baseFile = path.join(dir, 'base.docx')
    const targetFile = path.join(dir, 'target.docx')
    await writeFile(baseFile, makeDocx())
    await writeFile(targetFile, makeDocx({ 'word/document.xml': strToU8(documentXml.replace('Alpha', 'Beta')) }))
    const tools = createTools({ table: new FakeTable(), baseDir: path.join(dir, 'store'), inputRoots: [dir] })
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]))
    const exec = { callId: 'diff-1', agent: { id: 'tester' } }
    const base = await byName['doc_inspect'].execute({ path: baseFile }, exec)
    const target = await byName['doc_inspect'].execute({ path: targetFile }, exec)
    const diff = await byName['redline_diff'].execute({ base_doc_id: base.doc_id, target_doc_id: target.doc_id }, exec)
    assert.ok(diff.added + diff.removed > 0)
    assert.ok(diff.hunks.length > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('doc_replace_text limited OOXML write', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-docx-replace-'))
  try {
    const file = path.join(dir, 'base.docx')
    await writeFile(file, makeDocx())
    const tools = createTools({ table: new FakeTable(), baseDir: path.join(dir, 'store'), inputRoots: [dir] })
    const by = Object.fromEntries(tools.map((tool) => [tool.name, tool]))
    const exec = { callId: 'replace', agent: { id: 'tester' } }
    const inspected = await by['doc_inspect'].execute({ path: file }, exec)
    const replaced = await by['doc_replace_text'].execute({ doc_id: inspected.doc_id, find: 'Alpha', replace: 'Beta' }, exec)
    assert.equal(replaced.replacements, 1)
    const texts = paragraphTexts(await readFile(replaced.path))
    assert.ok(texts.some((text) => text.includes('Beta')))
    assert.equal(texts.some((text) => text.includes('Alpha')), false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
