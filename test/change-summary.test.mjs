import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { revisionSummary } from '../lib/adapters/docx-zip.js'
import { createTools } from '../lib/plugin/tools.js'

class FakeTable { map = new Map(); get(k){return this.map.get(k)}; entries(){return this.map.entries()}; keys(){return this.map.keys()}; async put(k,v){this.map.set(k,v)} }

const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
const documentXml = `<?xml version="1.0"?><w:document ${ns}><w:body>
<w:p><w:ins w:id="1" w:author="Alice"><w:r><w:t>added clause</w:t></w:r></w:ins></w:p>
<w:p><w:del w:id="2" w:author="Bob"><w:r><w:delText>removed words</w:delText></w:r></w:del></w:p>
<w:p><w:ins w:id="3" w:author="Alice"><w:r><w:t>second edit</w:t></w:r></w:ins></w:p>
</w:body></w:document>`

const makeDocx = () => Buffer.from(zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
  'word/document.xml': strToU8(documentXml),
}))

test('revisionSummary counts insertions, deletions and authors', () => {
  const r = revisionSummary(makeDocx())
  assert.equal(r.insertions, 2)
  assert.equal(r.deletions, 1)
  assert.equal(r.total, 3)
  assert.deepEqual(r.authors, { Alice: 2, Bob: 1 })
})

test('the tool reads a local docx and returns the same summary', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'docx-rev-'))
  try {
    const file = path.join(dir, 'sample.docx')
    await writeFile(file, makeDocx())
    const tools = Object.fromEntries(createTools({ table: new FakeTable(), baseDir: dir, inputRoots: [dir] }).map((t) => [t.name, t]))
    const r = await tools['doc_change_summary'].execute({ path: file }, { callId: 'rev' })
    assert.equal(r.total, 3)
    assert.equal(r.insertions, 2)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
