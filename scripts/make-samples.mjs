/**
 * Build the PS1 quickstart samples: two minimal, synthetic .docx files.
 *
 * Everything here is hand-written for this repository:
 *   - fictional parties (示例采购有限公司 / 示例供应有限公司)
 *   - a fictional contract amount and dates
 *   - no customer document, no PII, no extracted real text
 *
 * The files are assembled from OOXML parts with fflate (no Word, no template):
 *   [Content_Types].xml + _rels/.rels + word/document.xml + word/_rels/document.xml.rels
 *   + word/styles.xml + word/header1.xml + word/footer1.xml + word/comments.xml + word/numbering.xml
 *
 * `contract-v2.docx` differs from v1 in exactly two ways:
 *   1. the amount paragraph carries a tracked replacement (w:del "120,000" → w:ins "150,000", author 张三)
 *   2. one tracked-inserted clause at the end (author 李四)
 * so redline_diff reports +2/-1 and doc_change_summary reports 2 insertions / 1 deletion.
 *
 *   node scripts/make-samples.mjs
 */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { strToU8, zipSync } from 'fflate'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
const HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`

const contentTypes = `${HEAD}<Types xmlns="${CT}">`
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  + '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
  + '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
  + '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>'
  + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
  + '</Types>'

const packageRels = `${HEAD}<Relationships xmlns="${PKG}">`
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>'

const documentRels = `${HEAD}<Relationships xmlns="${PKG}">`
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>'
  + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'
  + '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>'
  + '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/synthetic-contract" TargetMode="External"/>'
  + '<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
  + '</Relationships>'

const styles = `${HEAD}<w:styles xmlns:w="${W}">`
  + '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="24"/></w:rPr></w:rPrDefault></w:docDefaults>'
  + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
  + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style>'
  + '</w:styles>'

const numbering = `${HEAD}<w:numbering xmlns:w="${W}">`
  + '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>'
  + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
  + '</w:numbering>'

const header = `${HEAD}<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>示例采购有限公司 · 采购合同（合成样例）</w:t></w:r></w:p></w:hdr>`

const footer = `${HEAD}<w:ftr xmlns:w="${W}"><w:p><w:r><w:t xml:space="preserve">第 </w:t></w:r>`
  + '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>'
  + '<w:r><w:t xml:space="preserve"> 页 · 仅为合成样例</w:t></w:r></w:p></w:ftr>'

const comments = `${HEAD}<w:comments xmlns:w="${W}">`
  + '<w:comment w:id="0" w:author="王五" w:date="2026-11-02T08:30:00Z" w:initials="WW"><w:p><w:r><w:t>金额待法务确认（合成样例批注）</w:t></w:r></w:p></w:comment>'
  + '</w:comments>'

const table = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>'
  + '<w:tr><w:tc><w:p><w:r><w:t>付款节点</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>比例</w:t></w:r></w:p></w:tc></w:tr>'
  + '<w:tr><w:tc><w:p><w:r><w:t>预付</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>30%</w:t></w:r></w:p></w:tc></w:tr>'
  + '</w:tbl>'

const paragraph = (text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`

const numberedProps = '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'

function documentXml({ amountRun, extraClause }) {
  return `${HEAD}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>`
    + `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>采购合同（合成样例）</w:t></w:r></w:p>`
    + paragraph('第一条 甲方：示例采购有限公司（合成）；乙方：示例供应有限公司（合成）。')
    + `<w:p>${numberedProps}<w:bookmarkStart w:id="0" w:name="amount"/><w:commentRangeStart w:id="0"/>${amountRun}`
    + '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r><w:bookmarkEnd w:id="0"/></w:p>'
    + paragraph('第三条 交付日期：2026-12-31。')
    + '<w:p><w:r><w:t xml:space="preserve">编制日期：</w:t></w:r><w:fldSimple w:instr=" DATE "><w:r><w:t>2026-11-02</w:t></w:r></w:fldSimple></w:p>'
    + '<w:p><w:r><w:t xml:space="preserve">模板说明见 </w:t></w:r><w:hyperlink r:id="rId5"><w:r><w:t>示例链接</w:t></w:r></w:hyperlink></w:p>'
    + table
    + paragraph('（以下无正文）')
    + (extraClause ?? '')
    + '<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:footerReference w:type="default" r:id="rId3"/>'
    + '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1800" w:bottom="1440" w:left="1800"/></w:sectPr>'
    + '</w:body></w:document>'
}

const AMOUNT_PLAIN = '<w:r><w:t xml:space="preserve">第二条 合同金额：人民币 120,000 元（含税）。</w:t></w:r>'

// Tracked replacement of the whole amount line, the way Word records "replace line with
// track changes on": the old line lives in w:delText (not current text), the new one in w:t.
const AMOUNT_REDLINED = '<w:del w:id="10" w:author="张三" w:date="2026-11-02T09:00:00Z">'
  + '<w:r><w:delText>第二条 合同金额：人民币 120,000 元（含税）。</w:delText></w:r></w:del>'
  + '<w:ins w:id="11" w:author="张三" w:date="2026-11-02T09:00:00Z">'
  + '<w:r><w:t>第二条 合同金额：人民币 150,000 元（含税）。</w:t></w:r></w:ins>'

const EXTRA_CLAUSE = '<w:p><w:ins w:id="12" w:author="李四" w:date="2026-11-02T09:30:00Z">'
  + '<w:r><w:t>第四条 保密条款：双方对合同内容保密，期限三年。</w:t></w:r></w:ins></w:p>'

function buildDocx(document) {
  const files = {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': packageRels,
    'word/document.xml': document,
    'word/_rels/document.xml.rels': documentRels,
    'word/styles.xml': styles,
    'word/header1.xml': header,
    'word/footer1.xml': footer,
    'word/comments.xml': comments,
    'word/numbering.xml': numbering,
  }
  const entries = {}
  for (const [name, text] of Object.entries(files)) entries[name] = strToU8(text)
  return Buffer.from(zipSync(entries, { mtime: new Date('2026-11-02T00:00:00Z') }))
}

const outDir = path.join(root, 'samples', 'quickstart', 'input')
mkdirSync(outDir, { recursive: true })

const files = {
  'contract-v1.docx': buildDocx(documentXml({ amountRun: AMOUNT_PLAIN, extraClause: null })),
  'contract-v2.docx': buildDocx(documentXml({ amountRun: AMOUNT_REDLINED, extraClause: EXTRA_CLAUSE })),
}

for (const [name, buffer] of Object.entries(files)) {
  writeFileSync(path.join(outDir, name), buffer)
  console.log(`wrote samples/quickstart/input/${name} (${buffer.length} B, sha256 ${createHash('sha256').update(buffer).digest('hex')})`)
}
console.log('synthetic only: fictional parties/amounts, no customer document, no extracted real text')
