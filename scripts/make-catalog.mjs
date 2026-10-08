import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const input = resolve(root, '../.research')
const revision = (await readFile(resolve(input, 'ark-commit.txt'), 'utf8')).trim()
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid source revision')
const registry = JSON.parse(await readFile(resolve(input, 'ark-registry.json'), 'utf8'))
const tree = JSON.parse(await readFile(resolve(input, 'ark-tree.json'), 'utf8'))
if (tree.truncated || tree.sha !== revision) throw new Error('The source tree must match the pinned revision')
const blobs = new Map(tree.tree.filter(entry => entry.type === 'blob').map(entry => [entry.path, entry]))
const entries = registry.pets.filter(pet => pet.status === 'approved').map(pet => {
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(pet.id) || pet.packagePath !== `pets/${pet.id}`) throw new Error(`Unsafe source entry: ${pet.id}`)
  const files = ['pet.json', 'SOURCE.md']
  if (blobs.has(`${pet.packagePath}/provenance.json`)) files.push('provenance.json')
  const atlas = ['spritesheet.webp', 'spritesheet.png'].find(name => blobs.has(`${pet.packagePath}/${name}`))
  if (!atlas) throw new Error(`Missing atlas: ${pet.id}`)
  files.push(atlas)
  return {
    id: pet.id,
    displayName: pet.displayName,
    category: pet.category === 'skin' ? 'skin' : 'default',
    files: files.map(name => {
      const entry = blobs.get(`${pet.packagePath}/${name}`)
      if (!entry) throw new Error(`Missing source file: ${pet.id}/${name}`)
      return { name, sha1: entry.sha, bytes: entry.size }
    })
  }
}).sort((a, b) => a.id.localeCompare(b.id, 'en'))
const output = resolve(root, 'data/ark-catalog.json')
await mkdir(dirname(output), { recursive: true })
await writeFile(output, JSON.stringify({ schemaVersion: 1, repository: 'lockon-n/Arknights-Codex-Pets', revision, entries }, null, 2) + '\n')
console.log(`Created catalogue with ${entries.length} pinned entries`)
