import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { unzipSync, zipSync } from 'fflate'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import {
  DOCX_ZIP_ENTRY_LIMIT,
  DOCX_ZIP_ENTRY_SIZE_LIMIT,
  DOCX_ZIP_RATIO_LIMIT,
  DOCX_ZIP_RATIO_MIN_BYTES,
  DOCX_ZIP_TOTAL_SIZE_LIMIT,
  DocxError,
  assertDocxPartLimits,
  emptyDocxStructure,
  type DocxInspection,
  type DocxPart,
  type DocxStructure,
} from '../core/docx.js'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  processEntities: false,
  allowBooleanAttributes: false,
})

/**
 * The single unzip entry point for this adapter.
 *
 * The filter runs before fflate inflates an entry, so oversized entries, too many
 * entries and classic high-ratio ZIP bombs are rejected without allocating their
 * uncompressed bytes. Declared sizes come from the ZIP central directory; the
 * actual entry lengths are checked again afterwards because a directory can lie.
 */
export function safeUnzip(buffer: Buffer | Uint8Array): Record<string, Uint8Array> {
  let count = 0
  let declaredTotal = 0
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(buffer, {
      filter(file) {
        count += 1
        if (count > DOCX_ZIP_ENTRY_LIMIT) {
          throw new DocxError('E_DOC_ZIP_LIMIT', `too many zip entries: more than ${DOCX_ZIP_ENTRY_LIMIT}`)
        }
        const originalSize = file.originalSize
        const compressedSize = file.size
        if (!Number.isFinite(originalSize) || originalSize < 0) {
          throw new DocxError('E_DOC_ZIP_LIMIT', `zip entry has an invalid size: ${file.name}`)
        }
        if (originalSize > DOCX_ZIP_ENTRY_SIZE_LIMIT) {
          throw new DocxError('E_DOC_ZIP_LIMIT', `zip entry too large: ${file.name} (${originalSize} bytes)`)
        }
        declaredTotal += originalSize
        if (declaredTotal > DOCX_ZIP_TOTAL_SIZE_LIMIT) {
          throw new DocxError('E_DOC_ZIP_LIMIT', `uncompressed zip size exceeds ${DOCX_ZIP_TOTAL_SIZE_LIMIT} bytes`)
        }
        if (originalSize > DOCX_ZIP_RATIO_MIN_BYTES) {
          if (compressedSize <= 0 || originalSize / compressedSize > DOCX_ZIP_RATIO_LIMIT) {
            throw new DocxError('E_DOC_ZIP_LIMIT', `zip entry compression ratio is too high: ${file.name}`)
          }
        }
        return true
      },
    }) as Record<string, Uint8Array>
  } catch (error) {
    if (error instanceof DocxError) throw error
    throw new DocxError('E_DOC_UNREADABLE', 'not a readable DOCX/ZIP')
  }
  let actualTotal = 0
  for (const [name, bytes] of Object.entries(entries)) {
    if (bytes.length > DOCX_ZIP_ENTRY_SIZE_LIMIT) {
      throw new DocxError('E_DOC_ZIP_LIMIT', `zip entry too large after decompression: ${name}`)
    }
    actualTotal += bytes.length
    if (actualTotal > DOCX_ZIP_TOTAL_SIZE_LIMIT) {
      throw new DocxError('E_DOC_ZIP_LIMIT', `uncompressed zip size exceeds ${DOCX_ZIP_TOTAL_SIZE_LIMIT} bytes after decompression`)
    }
  }
  return entries
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value]
}

function parseXml(text: string): unknown {
  try {
    return parser.parse(text)
  } catch {
    throw new DocxError('E_DOC_UNREADABLE', 'part XML is not parseable')
  }
}

function countKey(value: unknown, key: string, count = 0): number {
  if (Array.isArray(value)) {
    for (const item of value) count = countKey(item, key, count)
    return count
  }
  const object = asObject(value)
  if (!object) return count
  for (const [name, child] of Object.entries(object)) {
    if (name === key) count += asArray(child).length
    count = countKey(child, key, count)
  }
  return count
}

function partCount(parts: Map<string, Uint8Array>, pattern: RegExp): number {
  let count = 0
  for (const name of parts.keys()) if (pattern.test(name)) count += 1
  return count
}

function inspectDocumentXml(xml: string, structure: DocxStructure, warnings: string[]): void {
  const root = parseXml(xml)
  const document = asObject(asObject(root)?.document)
  if (!document || !asObject(document.body)) {
    throw new DocxError('E_DOC_UNREADABLE', 'document.xml has no w:document/w:body')
  }
  structure.paragraphs = countKey(root, 'p')
  structure.tables = countKey(root, 'tbl')
  structure.table_rows = countKey(root, 'tr')
  structure.table_cells = countKey(root, 'tc')
  structure.bookmarks = countKey(root, 'bookmarkStart')
  structure.fields = countKey(root, 'fldSimple') + countKey(root, 'instrText')
  structure.numbered_paragraphs = countKey(root, 'numPr')
  structure.sections = countKey(root, 'sectPr')
  if (structure.paragraphs === 0 && structure.tables === 0) warnings.push('document has no paragraphs or tables')
}

function inspectStyles(xml: string | undefined, structure: DocxStructure, warnings: string[]): void {
  if (!xml) {
    warnings.push('styles.xml is missing')
    return
  }
  structure.styles = countKey(parseXml(xml), 'style')
  if (structure.styles === 0) warnings.push('styles.xml has no w:style')
}

function inspectComments(xml: string | undefined, structure: DocxStructure): void {
  if (!xml) return
  structure.comments = countKey(parseXml(xml), 'comment')
}

function inspectFootnotes(xml: string | undefined, structure: DocxStructure): void {
  if (!xml) return
  structure.footnotes = countKey(parseXml(xml), 'footnote')
}

export function inspectDocx(buffer: Buffer): DocxInspection {
  if (buffer.length === 0) throw new DocxError('E_DOC_FILE_UNREADABLE', 'empty file')
  const raw = safeUnzip(buffer)
  const entries = Object.entries(raw).filter(([name]) => !name.endsWith('/'))
  assertDocxPartLimits(entries.map(([name, bytes]) => ({ name, size: bytes.length })))
  const parts = new Map(entries)
  if (!parts.has('[Content_Types].xml')) throw new DocxError('E_DOC_UNREADABLE', 'missing [Content_Types].xml')
  if (!parts.has('word/document.xml')) throw new DocxError('E_DOC_UNREADABLE', 'missing word/document.xml')

  const warnings: string[] = []
  const structure = emptyDocxStructure()
  const documentXml = Buffer.from(parts.get('word/document.xml')!).toString('utf8')
  inspectDocumentXml(documentXml, structure, warnings)
  inspectStyles(parts.has('word/styles.xml') ? Buffer.from(parts.get('word/styles.xml')!).toString('utf8') : undefined, structure, warnings)
  inspectComments(parts.has('word/comments.xml') ? Buffer.from(parts.get('word/comments.xml')!).toString('utf8') : undefined, structure)
  inspectFootnotes(parts.has('word/footnotes.xml') ? Buffer.from(parts.get('word/footnotes.xml')!).toString('utf8') : undefined, structure)
  structure.headers = partCount(parts, /^word\/header\d*\.xml$/)
  structure.footers = partCount(parts, /^word\/footer\d*\.xml$/)
  if (structure.headers === 0) warnings.push('no header part')
  if (structure.footers === 0) warnings.push('no footer part')
  if (structure.fields === 0) warnings.push('no field instructions detected')
  if (structure.bookmarks === 0) warnings.push('no bookmarks detected')
  if (structure.numbered_paragraphs === 0) warnings.push('no numbering properties detected')
  if (structure.comments === 0) warnings.push('no comments part/comments')

  const partList: DocxPart[] = entries
    .map(([name, bytes]) => ({ name, size: bytes.length, sha256: sha256(bytes) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { parts: partList, structure, warnings }
}

export function docxContentHash(buffer: Buffer): string {
  return sha256(buffer)
}

export function paragraphTexts(buffer: Buffer): string[] {
  const raw = safeUnzip(buffer)
  const document = raw['word/document.xml']
  if (!document) throw new DocxError('E_DOC_UNREADABLE', 'missing word/document.xml')
  const root = parseXml(Buffer.from(document).toString('utf8'))
  const out: string[] = []
  const collect = (value: unknown): string => {
    if (Array.isArray(value)) return value.map(collect).join('')
    if (value === null || value === undefined) return ''
    if (typeof value !== 'object') return String(value)
    const object = value as Record<string, unknown>
    let text = ''
    if (object.t !== undefined) text += collect(object.t)
    if (object['#text'] !== undefined) text += String(object['#text'])
    for (const [key, child] of Object.entries(object)) {
      // Attribute values (w:val, w:id, r:id, w:instr, ...) are metadata, not document text.
      // Paragraph/run properties carry no readable text either; skipping both keeps
      // paragraph-level diff output equal to what a reader sees in Word.
      if (key === 't' || key === '#text' || key.startsWith('@_')) continue
      if (key === 'pPr' || key === 'rPr') continue
      // Tracked deletions are no longer part of the current text.
      if (key === 'del') continue
      text += collect(child)
    }
    return text
  }
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return }
    const object = asObject(value)
    if (!object) return
    if (object.p !== undefined) for (const paragraph of asArray(object.p)) out.push(collect(paragraph).trim())
    for (const [key, child] of Object.entries(object)) if (key !== 'p') visit(child)
  }
  visit(root)
  return out
}

export function docxPartHashes(buffer: Buffer): Map<string, string> {
  const raw = safeUnzip(buffer)
  return new Map(Object.entries(raw).filter(([name]) => !name.endsWith('/')).map(([name, bytes]) => [name, sha256(bytes)]))
}


/** Fail closed before writing: the generated WML must be well-formed and parseable. */
function assertParsableWml(xml: string): void {
  const validation = XMLValidator.validate(xml)
  if (validation !== true) {
    const detail = `${validation.err.code} at line ${validation.err.line}: ${validation.err.msg}`
    throw new DocxError('E_DOC_WRITE_UNSUPPORTED', `generated word/document.xml is not well-formed (${detail})`)
  }
  try {
    parser.parse(xml)
  } catch {
    throw new DocxError('E_DOC_WRITE_UNSUPPORTED', 'generated word/document.xml is not parseable')
  }
}

export function replaceExactText(buffer: Buffer, find: string, replace: string): { buffer: Buffer; replacements: number } {
  if (!find) throw new DocxError('E_DOC_WRITE_UNSUPPORTED', 'find must not be empty')
  const raw = safeUnzip(buffer)
  const document = raw['word/document.xml']
  if (!document) throw new DocxError('E_DOC_UNREADABLE', 'missing word/document.xml')
  const xml = Buffer.from(document).toString('utf8')
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const needle = new RegExp(`(<w:t(?:\\s[^>]*)?>)${escape(find).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(</w:t>)`, 'g')
  const matches = [...xml.matchAll(needle)]
  if (matches.length !== 1) throw new DocxError('E_DOC_WRITE_UNSUPPORTED', `expected exactly one text match, found ${matches.length}`)
  // Function replacement: "$&", "$1" and "$`" in user input stay literal text instead of
  // being interpreted as String.replace substitution patterns.
  const next = xml.replace(needle, (_match: string, prefix: string, suffix: string) => `${prefix}${escape(replace)}${suffix}`)
  assertParsableWml(next)
  raw['word/document.xml'] = new TextEncoder().encode(next)
  return { buffer: Buffer.from(zipSync(raw)), replacements: 1 }
}

export interface RevisionSummary {
  insertions: number
  deletions: number
  authors: Record<string, number>
  total: number
}
/**
 * Count tracked revisions in word/document.xml (OOXML WML: w:ins / w:del and their w:author).
 * Read-only; it does not accept or reject changes.
 */
export function revisionSummary(buffer: Buffer): RevisionSummary {
  const raw = safeUnzip(buffer)
  const document = raw['word/document.xml']
  if (!document) throw new DocxError('E_DOC_UNREADABLE', 'missing word/document.xml')
  const xml = Buffer.from(document).toString('utf8')
  const ins = [...xml.matchAll(/<w:ins\b[^>]*>/g)]
  const del = [...xml.matchAll(/<w:del\b[^>]*>/g)]
  const authors: Record<string, number> = {}
  for (const tag of [...ins, ...del]) {
    const m = /w:author="([^"]*)"/.exec(tag[0])
    const name = (m?.[1] ?? '(unknown)').slice(0, 80)
    authors[name] = (authors[name] ?? 0) + 1
  }
  return { insertions: ins.length, deletions: del.length, authors, total: ins.length + del.length }
}

export interface RelationshipIssue { code: string; detail: string }
export interface RelationshipReport {
  relationships: number
  referenced: number
  external: number
  issues: RelationshipIssue[]
}
/**
 * OOXML package integrity: every r:id/r:embed used by word/document.xml must be declared in
 * word/_rels/document.xml.rels, and every internal relationship target must exist in the zip.
 * Read-only; clean-room from the ECMA-376 / ISO-IEC 29500 package model.
 */
export function relationshipCheck(buffer: Buffer): RelationshipReport {
  const raw = safeUnzip(buffer)
  const document = raw['word/document.xml']
  if (!document) throw new DocxError('E_DOC_UNREADABLE', 'missing word/document.xml')
  const relsPart = raw['word/_rels/document.xml.rels']
  const xml = Buffer.from(document).toString('utf8')
  const relsXml = relsPart ? Buffer.from(relsPart).toString('utf8') : ''
  const rels = new Map<string, { target: string; external: boolean }>()
  for (const tag of relsXml.match(/<Relationship\b[^>]*>/g) ?? []) {
    const id = /Id="([^"]+)"/.exec(tag)?.[1]
    const target = /Target="([^"]+)"/.exec(tag)?.[1]
    if (!id || !target) continue
    const external = /TargetMode="External"/i.test(tag)
    rels.set(id, { target, external })
  }
  const referenced = new Set<string>()
  for (const match of xml.matchAll(/r:(?:id|embed|link)="([^"]+)"/g)) referenced.add(match[1]!)
  const issues: RelationshipIssue[] = []
  for (const id of referenced) if (!rels.has(id)) issues.push({ code: 'E_DOC_REL_UNRESOLVED', detail: `document.xml references ${id} with no relationship` })
  let external = 0
  for (const [id, rel] of rels) {
    if (rel.external) { external += 1; continue }
    const part = posix.resolve('/word', rel.target).slice(1)
    if (!raw[part]) issues.push({ code: 'E_DOC_REL_MISSING_PART', detail: `${id} points at missing part ${part}` })
  }
  return { relationships: rels.size, referenced: referenced.size, external, issues }
}
