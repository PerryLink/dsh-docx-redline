import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
const root = process.cwd(); const failures = []
function filesUnder(directory) {
  const base = path.join(root, directory)
  return readdirSync(base, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.ts')).map((e) => path.join(e.parentPath ?? base, e.name))
}
for (const file of filesUnder('src/core')) {
  const text = readFileSync(file, 'utf8')
  if (/\bctx\./.test(text) || /@deepseek-ai\//.test(text)) failures.push(`${file}: core imports ctx/DSH`)
}
for (const file of filesUnder('src/adapters')) {
  if (/ctx\.tools\.register/.test(readFileSync(file, 'utf8'))) failures.push(`${file}: adapter registers tools`)
}
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
if (pkg.name !== 'dsh-docx-redline') failures.push('unexpected name')
if (!pkg.dsh?.bundle?.patch) failures.push('missing dsh.bundle.patch')
if (!pkg.engines?.dsh) failures.push('missing engines.dsh')
if (pkg.dsh?.client) failures.push('S1 must not declare Client')
const patch = readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
if (!patch.includes("name: 'dsh-docx-redline'")) failures.push('bad patch')
if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log('lint ok: layer direction + bundle manifest')
