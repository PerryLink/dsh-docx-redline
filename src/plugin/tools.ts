/** S1 model-facing tools: doc_inspect and doc_roundtrip. */

import { createHash } from 'node:crypto'
import { readFile, realpath, stat, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { DocxError, type DocxStructure } from '../core/docx.js'
import { docxPartHashes, inspectDocx, paragraphTexts, relationshipCheck, replaceExactText, revisionSummary } from '../adapters/docx-zip.js'
import {
  emptyDocxRecord,
  newDocId,
  sha256Buffer,
  storeOriginal,
  type DocxRecord,
  type DocxTable,
} from './storage.js'

export interface ToolDeps {
  table: DocxTable
  baseDir: string
  inputRoots: string[]
}

function text(value: string) {
  return [{ type: 'text' as const, text: value }]
}

function runIdOf(exec: unknown): string {
  const candidate = exec as { runId?: string; callId?: string }
  return candidate?.runId ?? candidate?.callId ?? 'run-unknown'
}

function actorOf(exec: unknown): string {
  const candidate = exec as { agent?: { id?: string }; actor?: string }
  return candidate?.agent?.id ?? candidate?.actor ?? 'agent'
}

async function resolveAllowedPath(inputPath: string, roots: string[]): Promise<string> {
  let resolved: string
  try {
    resolved = await realpath(path.resolve(inputPath))
  } catch {
    throw new DocxError('E_DOC_FILE_UNREADABLE', `找不到这个文件（E_DOC_FILE_UNREADABLE）｜下一步：确认路径存在，或先用自带样例 samples/quickstart/input/contract-v1.docx`)
  }
  const resolvedRoots = await Promise.all(
    roots.map(async (root) => {
      try {
        return await realpath(path.resolve(root))
      } catch {
        return undefined
      }
    }),
  )
  const allowed = resolvedRoots.some((root) => root !== undefined && (resolved === root || resolved.startsWith(root + path.sep)))
  if (!allowed) throw new DocxError('E_DOC_PATH_NOT_ALLOWED', `这个路径不在允许的输入目录里（E_DOC_PATH_NOT_ALLOWED）｜下一步：把文件放进输入根目录，或设置 DSH_DOCX_INPUT_ROOTS`)
  return resolved
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`
}

function structureOut() {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      paragraphs: { type: 'number', required: true },
      tables: { type: 'number', required: true },
      table_rows: { type: 'number', required: true },
      table_cells: { type: 'number', required: true },
      headers: { type: 'number', required: true },
      footers: { type: 'number', required: true },
      footnotes: { type: 'number', required: true },
      comments: { type: 'number', required: true },
      fields: { type: 'number', required: true },
      bookmarks: { type: 'number', required: true },
      numbered_paragraphs: { type: 'number', required: true },
      sections: { type: 'number', required: true },
      styles: { type: 'number', required: true },
    },
  } as const
}

export function createTools(deps: ToolDeps) {
  const inspect = defineTool({
    name: 'doc_inspect',
    description: 'Inspect a local DOCX structure: parts and SHA-256, paragraphs, tables, headers/footers, footnotes, comments, fields, bookmarks, numbering, sections and styles. Read-only after storing the original locally.',
    parameters: {
      path: { type: 'string', required: true, description: 'Local .docx path under the configured input roots' },
      entity_id: { type: 'string', description: 'Optional logical entity; default "default"' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          doc_id: { type: 'string', required: true },
          sha256: { type: 'string', required: true },
          size: { type: 'number', required: true },
          existing: { type: 'boolean', required: true },
          parts_count: { type: 'number', required: true },
          structure: { ...structureOut(), required: true },
          warnings: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) =>
        text(`inspected ${value.doc_id} (${value.size} B): p=${value.structure.paragraphs} tbl=${value.structure.tables} hdr=${value.structure.headers} ftr=${value.structure.footers} fields=${value.structure.fields}`),
    },
    async execute(args, exec) {
      const resolved = await resolveAllowedPath(args.path, deps.inputRoots)
      const info = await stat(resolved)
      if (!info.isFile() || info.size === 0) throw new DocxError('E_DOC_FILE_UNREADABLE', 'not a non-empty file')
      const buffer = await readFile(resolved)
      const sha256 = sha256Buffer(buffer)
      for (const [, record] of deps.table.entries()) {
        if (record.source_sha256 === sha256) {
          return {
            doc_id: record.doc_id,
            sha256,
            size: record.source_size,
            existing: true,
            parts_count: record.parts.length,
            structure: record.structure,
            warnings: record.warnings,
          }
        }
      }
      const inspection = inspectDocx(buffer)
      const docId = newDocId()
      const storedPath = await storeOriginal(deps.baseDir, sha256, path.extname(resolved), buffer)
      const record = emptyDocxRecord({
        docId,
        entityId: args.entity_id?.trim() || 'default',
        sourceName: path.basename(resolved),
        sourcePath: storedPath,
        sha256,
        size: info.size,
        parts: inspection.parts,
        structure: inspection.structure,
        warnings: inspection.warnings,
        runId: runIdOf(exec),
        actor: actorOf(exec),
      })
      record.evidence_sha256 = createHash('sha256').update(canonicalJson({ parts: inspection.parts, structure: inspection.structure, warnings: inspection.warnings })).digest('hex')
      await deps.table.put(docId, record)
      return {
        doc_id: docId,
        sha256,
        size: info.size,
        existing: false,
        parts_count: inspection.parts.length,
        structure: inspection.structure,
        warnings: inspection.warnings,
      }
    },
  })

  const roundtrip = defineTool({
    name: 'doc_roundtrip',
    description: 'Copy an inspected DOCX to a new file, unpack both packages and compare every part hash; returns a part-wise identical report. Local R1 write; no XML/OOXML generation.',
    parameters: {
      doc_id: { type: 'string', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          doc_id: { type: 'string', required: true },
          input_sha256: { type: 'string', required: true },
          output_sha256: { type: 'string', required: true },
          zero_diff: { type: 'boolean', required: true },
          parts_compared: { type: 'number', required: true },
          missing_parts: { type: 'array', items: { type: 'string' }, required: true },
          extra_parts: { type: 'array', items: { type: 'string' }, required: true },
          hash_mismatch: { type: 'array', items: { type: 'string' }, required: true },
        },
      },
      render: (_args, value) => text(`roundtrip ${value.doc_id}: ${value.zero_diff ? 'part-wise identical' : 'DIFF'} (${value.parts_compared} parts)`),
    },
    async execute(args) {
      const record = deps.table.get(args.doc_id)
      if (!record) throw new DocxError('E_DOC_DOC_NOT_FOUND', `找不到这份文档记录（E_DOC_DOC_NOT_FOUND）｜下一步：先用 doc_inspect 读一次，再拿返回的 doc_id 继续`)
      const buffer = await readFile(record.source_path)
      const inputSha = sha256Buffer(buffer)
      const outDir = path.join(deps.baseDir, 'roundtrip')
      await mkdir(outDir, { recursive: true })
      const outPath = path.join(outDir, `${record.doc_id}.docx`)
      await writeFile(outPath, buffer)
      // Unpack what was actually written and compare every part. Whole-file SHA equality is
      // not used as proof: reading back our own copy would only compare the copy with itself.
      const output = await readFile(outPath)
      const outputSha = sha256Buffer(output)
      const inputParts = docxPartHashes(buffer)
      const outputParts = docxPartHashes(output)
      const missingParts = [...inputParts.keys()].filter((name) => !outputParts.has(name))
      const extraParts = [...outputParts.keys()].filter((name) => !inputParts.has(name))
      const hashMismatch = [...inputParts.entries()].filter(([name, hash]) => outputParts.get(name) !== hash).map(([name]) => name)
      const zeroDiff = missingParts.length === 0 && extraParts.length === 0 && hashMismatch.length === 0
      const updated: DocxRecord = {
        ...record,
        lifecycle: zeroDiff ? 'roundtripped' : 'failed',
        roundtrip: {
          input_sha256: inputSha,
          output_sha256: outputSha,
          zero_diff: zeroDiff,
          parts_compared: inputParts.size,
          missing_parts: missingParts,
          extra_parts: extraParts,
          hash_mismatch: hashMismatch,
          checked_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      }
      await deps.table.put(record.doc_id, updated)
      return {
        doc_id: record.doc_id,
        input_sha256: inputSha,
        output_sha256: outputSha,
        zero_diff: zeroDiff,
        parts_compared: inputParts.size,
        missing_parts: missingParts,
        extra_parts: extraParts,
        hash_mismatch: hashMismatch,
      }
    },
  })


  const diff = defineTool({
    name: 'redline_diff',
    description: 'Text-level paragraph diff between two inspected DOCX documents: added/removed paragraphs and ordered hunks. Read-only; does NOT write OOXML or produce a Word redline.',
    parameters: { base_doc_id: { type: 'string', required: true }, target_doc_id: { type: 'string', required: true } },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          base_doc_id: { type: 'string', required: true },
          target_doc_id: { type: 'string', required: true },
          added: { type: 'number', required: true },
          removed: { type: 'number', required: true },
          hunks: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { op: { type: 'string', required: true }, text: { type: 'string', required: true } } } },
        },
      },
      render: (_a, v) => text(`diff +${v.added} -${v.removed}`),
    },
    async execute(args) {
      const base = deps.table.get(args.base_doc_id)
      const target = deps.table.get(args.target_doc_id)
      if (!base) throw new DocxError('E_DOC_DOC_NOT_FOUND', `unknown base: ${args.base_doc_id}`)
      if (!target) throw new DocxError('E_DOC_DOC_NOT_FOUND', `unknown target: ${args.target_doc_id}`)
      const a = paragraphTexts(await readFile(base.source_path))
      const b = paragraphTexts(await readFile(target.source_path))
      const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
      for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
      const hunks: Array<{ op: string; text: string }> = []
      let i = 0, j = 0, added = 0, removed = 0
      while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i += 1; j += 1 } else if (dp[i + 1][j] >= dp[i][j + 1]) { hunks.push({ op: 'remove', text: a[i]! }); removed += 1; i += 1 } else { hunks.push({ op: 'add', text: b[j]! }); added += 1; j += 1 }
      }
      while (i < a.length) { hunks.push({ op: 'remove', text: a[i]! }); removed += 1; i += 1 }
      while (j < b.length) { hunks.push({ op: 'add', text: b[j]! }); added += 1; j += 1 }
      return { base_doc_id: base.doc_id, target_doc_id: target.doc_id, added, removed, hunks }
    },
  })


  const replaceText = defineTool({
    name: 'doc_replace_text',
    description: 'Replace one exact text run in word/document.xml and write a new DOCX. Limited OOXML write: does not preserve/alter comments or fields beyond the matched text; fail-closed unless exactly one match. Local R1 write.',
    parameters: { doc_id: { type: 'string', required: true }, find: { type: 'string', required: true }, replace: { type: 'string', required: true }, output_name: { type: 'string' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { path: { type: 'string', required: true }, sha256: { type: 'string', required: true }, replacements: { type: 'number', required: true } } }, render: (_a, v) => text(`replaced 1 run -> ${v.path}`) },
    async execute(args) {
      const record = deps.table.get(args.doc_id)
      if (!record) throw new DocxError('E_DOC_DOC_NOT_FOUND', `unknown doc: ${args.doc_id}`)
      const original = await readFile(record.source_path)
      const result = replaceExactText(original, args.find, args.replace)
      const dir = path.join(deps.baseDir, 'outputs'); await mkdir(dir, { recursive: true })
      const name = (args.output_name ?? `${record.doc_id}-replaced.docx`).replace(/[^A-Za-z0-9._-]/g, '_')
      const output = path.join(dir, name.endsWith('.docx') ? name : `${name}.docx`)
      await writeFile(output, result.buffer)
      return { path: output, sha256: sha256Buffer(result.buffer), replacements: result.replacements }
    },
  })

  const changeSummary = defineTool({
    name: 'doc_change_summary',
    description: 'Count tracked revisions in a local DOCX (OOXML WML w:ins / w:del and their authors). Read-only; it does not accept or reject changes.',
    parameters: { path: { type: 'string', required: true, description: 'Local .docx path under the configured input roots' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { insertions: { type: 'number', required: true }, deletions: { type: 'number', required: true }, total: { type: 'number', required: true }, authors: { type: 'json', required: true } } }, render: (_a, v) => text(`revisions ${v.total} (ins ${v.insertions} / del ${v.deletions})`) },
    async execute(args) {
      const resolved = await resolveAllowedPath(args.path, deps.inputRoots)
      const buffer = await readFile(resolved)
      return revisionSummary(buffer)
    },
  })

  const relCheck = defineTool({
    name: 'doc_relationship_check',
    description: 'Check OOXML package relationships: every r:id/r:embed in document.xml is declared in document.xml.rels, and every internal target part exists. Read-only; no repair.',
    parameters: { path: { type: 'string', required: true, description: 'Local .docx path under the configured input roots' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { relationships: { type: 'number', required: true }, referenced: { type: 'number', required: true }, external: { type: 'number', required: true }, issues: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { code: { type: 'string', required: true }, detail: { type: 'string', required: true } } } } } }, render: (_a, v) => text(`relationships ${v.relationships}, issues ${v.issues.length}`) },
    async execute(args) {
      const resolved = await resolveAllowedPath(args.path, deps.inputRoots)
      return relationshipCheck(await readFile(resolved))
    },
  })

  return [inspect, roundtrip, diff, replaceText, changeSummary, relCheck]
}
