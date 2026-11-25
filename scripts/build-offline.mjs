import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? files(dir + '/' + e.name) : dir + '/' + e.name,
      ),
    )
  ).flat()
}
const assets = (await files('dist')).filter((p) => p !== 'dist/sw.js').sort()
const sw = await readFile('scripts/service-worker.js', 'utf8')
const hash = createHash('sha256').update(sw)
for (const path of assets) hash.update(path).update(await readFile(path))
await writeFile(
  'dist/sw.js',
  sw
    .replace('__VERSION__', hash.digest('hex').slice(0, 16))
    .replace('OFFLINE_ASSETS', JSON.stringify(assets.map((p) => p.slice(5)))),
)
console.log('Offline bundle:', assets.length, 'files')
