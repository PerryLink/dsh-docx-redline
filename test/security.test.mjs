import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { XMLValidator } from 'fast-xml-parser'
import {
  docxPartHashes,
  inspectDocx,
  paragraphTexts,
  relationshipCheck,
  replaceExactText,
  revisionSummary,
  safeUnzip,
} from '../lib/adapters/docx-zip.js'
import { DocxError } from '../lib/core/docx.js'
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
const documentXml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Alpha</w:t></w:r></w:p></w:body></w:document>`

function makeDocx(extra = {}) {
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    'word/document.xml': strToU8(documentXml),
    ...extra,
  }))
}

/** paragraphTexts reads WML with processEntities:false, so compare against escaped text. */
function escapeXmlText(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

test('a normal DOCX still passes the pre-decompression guard', () => {
  const buffer = makeDocx()
  const inspection = inspectDocx(buffer)
  assert.ok(inspection.parts.length >= 2)
  assert.equal(inspection.structure.paragraphs >= 1, true)
})

test('a 5.5KB ZIP with a 5MB entry is rejected before every DOCX read', () => {
  const buffer = makeDocx({ 'word/media/bomb.bin': new Uint8Array(5 * 1024 * 1024) })
  assert.ok(buffer.length < 6000, `bomb ZIP should stay small, got ${buffer.length} bytes`)
  const readers = [
    ['inspectDocx', () => inspectDocx(buffer)],
    ['paragraphTexts', () => paragraphTexts(buffer)],
    ['docxPartHashes', () => docxPartHashes(buffer)],
    ['replaceExactText', () => replaceExactText(buffer, 'Alpha', 'Beta')],
    ['revisionSummary', () => revisionSummary(buffer)],
    ['relationshipCheck', () => relationshipCheck(buffer)],
  ]
  for (const [name, read] of readers) {
    assert.throws(
      read,
      (error) => error instanceof DocxError && error.code === 'E_DOC_ZIP_LIMIT',
      `${name} must reject the ZIP bomb`,
    )
  }
  // safeUnzip itself is the single shared entry point.
  assert.throws(() => safeUnzip(buffer), (error) => error instanceof DocxError && error.code === 'E_DOC_ZIP_LIMIT')
})

test('replaceExactText keeps replacement metacharacters literal and emits valid WML', () => {
  for (const replacement of ['cost $& 5', '$1', '$`']) {
    const result = replaceExactText(makeDocx(), 'Alpha', replacement)
    const xml = Buffer.from(safeUnzip(result.buffer)['word/document.xml']).toString('utf8')
    assert.equal(XMLValidator.validate(xml), true, `generated WML must be well-formed for ${replacement}`)
    assert.deepEqual(paragraphTexts(result.buffer), [escapeXmlText(replacement)])
    assert.doesNotThrow(() => inspectDocx(result.buffer))
  }
})

test('doc_replace_text writes literal injection payloads to a parseable DOCX', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-docx-inject-'))
  try {
    const file = path.join(dir, 'base.docx')
    await writeFile(file, makeDocx())
    const tools = Object.fromEntries(createTools({ table: new FakeTable(), baseDir: path.join(dir, 'store'), inputRoots: [dir] }).map((tool) => [tool.name, tool]))
    const exec = { callId: 'inject', agent: { id: 'tester' } }
    const inspected = await tools['doc_inspect'].execute({ path: file }, exec)
    for (const [index, replacement] of ['cost $& 5', '$1', '$`'].entries()) {
      const out = await tools['doc_replace_text'].execute({
        doc_id: inspected.doc_id,
        find: 'Alpha',
        replace: replacement,
        output_name: `injected-${index}`,
      }, exec)
      const buffer = await readFile(out.path)
      const xml = Buffer.from(safeUnzip(buffer)['word/document.xml']).toString('utf8')
      assert.equal(XMLValidator.validate(xml), true, `generated WML must be well-formed for ${replacement}`)
      assert.deepEqual(paragraphTexts(buffer), [escapeXmlText(replacement)])
      assert.doesNotThrow(() => inspectDocx(buffer))
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('doc_roundtrip reports part-wise identity instead of whole-file SHA equality', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-docx-partwise-'))
  try {
    const file = path.join(dir, 'base.docx')
    await writeFile(file, makeDocx())
    const tools = Object.fromEntries(createTools({ table: new FakeTable(), baseDir: path.join(dir, 'store'), inputRoots: [dir] }).map((tool) => [tool.name, tool]))
    const exec = { callId: 'roundtrip', agent: { id: 'tester' } }
    const inspected = await tools['doc_inspect'].execute({ path: file }, exec)
    const rt = await tools['doc_roundtrip'].execute({ doc_id: inspected.doc_id }, exec)
    assert.equal(rt.zero_diff, true)
    assert.equal(rt.parts_compared, inspected.parts_count)
    assert.deepEqual(rt.missing_parts, [])
    assert.deepEqual(rt.extra_parts, [])
    assert.deepEqual(rt.hash_mismatch, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
