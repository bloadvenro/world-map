const prefix = 'flag-atlas:' + self.registration.scope + ':'
const name = prefix + '__VERSION__'
const assets = OFFLINE_ASSETS
const scope = self.registration.scope
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(name)
      try {
        for (let i = 0; i < assets.length; i += 24) {
          await cache.addAll(
            assets
              .slice(i, i + 24)
              .map(
                (path) =>
                  new Request(new URL(path, scope), { cache: 'reload' }),
              ),
          )
        }
      } catch (error) {
        await caches.delete(name)
        throw error
      }
    })(),
  )
})
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(prefix) && key !== name) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})
async function audioRange(response, range) {
  const data = await response.arrayBuffer()
  const size = data.byteLength
  const parts = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!parts || (!parts[1] && !parts[2]))
    return new Response(data, { headers: response.headers })
  const start = parts[1]
    ? Number(parts[1])
    : Math.max(0, size - Number(parts[2]))
  const end =
    parts[1] && parts[2] ? Math.min(size - 1, Number(parts[2])) : size - 1
  if (start >= size || end < start)
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': 'bytes */' + size },
    })
  return new Response(data.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Content-Length': String(end - start + 1),
    },
  })
}
self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || !request.url.startsWith(scope)) return
  event.respondWith(
    (async () => {
      const cache = await caches.open(name)
      const url =
        request.mode === 'navigate'
          ? new URL('index.html', scope).href
          : request.url
      const hit = await cache.match(url)
      if (!hit) return fetch(request)
      const range = request.headers.get('Range')
      return range && new URL(url).pathname.endsWith('.mp3')
        ? audioRange(hit, range)
        : hit
    })(),
  )
})
