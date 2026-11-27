import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const countries = JSON.parse(await readFile('src/countries.json', 'utf8'))
const codes = countries.map((c) => c.code).sort()
assert.equal(codes.length, 195)
assert.equal(new Set(codes).size, 195)
for (const file of ['world.json', 'world-detail.json']) {
  const { features, borders } = JSON.parse(
    await readFile('public/' + file, 'utf8'),
  )
  assert.ok(
    typeof borders === 'string' && borders.startsWith('M'),
    'Missing shared land borders',
  )
  assert.deepEqual(
    features
      .map((f) => f.code)
      .filter(Boolean)
      .sort(),
    codes,
  )
  for (const feature of features) {
    assert.ok(feature.pieces.length && feature.anchor.every(Number.isFinite))
    for (const { b, d } of feature.pieces)
      assert.ok(
        b[2] > b[0] && b[3] > b[1] && d.startsWith('M') && d.endsWith('Z'),
      )
  }
}
for (const [directory, extension] of [
  ['flags', 'svg'],
  ['voice', 'mp3'],
  ['population', 'mp3'],
]) {
  const names = await readdir('public/' + directory)
  assert.deepEqual(
    names.sort(),
    codes.map((c) => c + '.' + extension),
  )
  await Promise.all(
    names.map(async (name) => {
      const data = await readFile('public/' + directory + '/' + name)
      assert.ok(data.length > 0, name)
    }),
  )
}
console.log('195 countries matched to geometry, flags and recordings.')
