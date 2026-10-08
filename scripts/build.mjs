import { build } from 'esbuild'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../', import.meta.url))
await mkdir(new URL('../lib/', import.meta.url), { recursive: true })
await build({ absWorkingDir: root, entryPoints: ['src/client.js'], outfile: 'lib/client.js', bundle: true, platform: 'browser', format: 'iife', target: 'es2022', minify: false, legalComments: 'inline', banner: { js: '/* DSH Ark Pet. MIT. Includes renderer code derived from Signalight (MIT). */' } })
console.log('Built lib/client.js')
