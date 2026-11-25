import './style.css'
import { Atlas, readAtlas, type Country, type Point } from './atlas'
import { Markers } from './markers'
import catalog from './countries.json'

const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T
const glyphs = {
  sound: '<path d="M3 9h4l5-4v14l-5-4H3zM16 8q5 4 0 8m3-11q8 7 0 14"/>',
  silent: '<path d="M3 9h4l5-4v14l-5-4H3zM17 9l5 6m0-6-5 6"/>',
  reset: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6"/>',
  repeat: '<path d="M4 9a8 8 0 1 1-1 5M4 3v6h6"/><path d="m10 9 5 3-5 3z"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  more: '<path d="M12 5v14M5 12h14"/>',
  less: '<path d="M5 12h14"/>',
  touch:
    '<path d="M9 13V5a2 2 0 0 1 4 0v5l4 1q3 1 3 4v3l-2 3h-7l-6-7q-1-3 2-2l2 1z"/>',
}
function icon(id: string, k: keyof typeof glyphs) {
  byId(id).innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 24 24">' + glyphs[k] + '</svg>'
}
icon('reset', 'reset')
icon('repeat', 'repeat')
icon('dismiss', 'close')
icon('close-nearby', 'close')
icon('minus', 'less')
icon('plus', 'more')
icon('hint-icon', 'touch')
let sound = true
try {
  sound = localStorage.getItem('flag-atlas-muted') !== 'yes'
} catch {
  /* optional preference */
}
const player = new Audio()
player.crossOrigin = 'anonymous'
let noticeTimer = 0
function notice(message: string) {
  const el = byId('notice')
  clearTimeout(noticeTimer)
  el.textContent = message
  el.hidden = false
  noticeTimer = window.setTimeout(() => (el.hidden = true), 4400)
}
function soundState() {
  icon('sound', sound ? 'sound' : 'silent')
  const button = byId('sound')
  button.title = sound ? 'Выключить звук' : 'Включить звук'
  button.setAttribute('aria-label', button.title)
  button.setAttribute('aria-pressed', String(sound))
  byId<HTMLButtonElement>('repeat').disabled = !sound
}
soundState()
byId('sound').onclick = () => {
  sound = !sound
  if (!sound) player.pause()
  try {
    localStorage.setItem('flag-atlas-muted', sound ? 'no' : 'yes')
  } catch {
    /* optional preference */
  }
  soundState()
}
function pronounce(code: string) {
  player.pause()
  if (!sound) return
  player.src = './voice/' + code + '.mp3'
  void player.play().catch((err: Error) => {
    if (err.name !== 'AbortError')
      notice('Запись не воспроизвелась. Можно попробовать ещё раз.')
  })
}

async function start() {
  const { countries, land, borders } = await readAtlas()
  const main = byId('atlas')
  const canvas = byId<HTMLCanvasElement>('map')
  const markers = new Markers(byId('markers'), countries)
  const select = byId<HTMLSelectElement>('keyboard-country')
  const hint = byId('hint')
  const nearby = byId('nearby')
  const view = new Atlas(canvas, land, borders, () => {
    markers.draw(view)
    byId('scale').textContent =
      Number(view.zoom.toFixed(2)).toLocaleString('ru') + '×'
    byId<HTMLButtonElement>('minus').disabled = view.zoom <= 1
    byId<HTMLButtonElement>('plus').disabled = view.zoom >= 2
  })
  new ResizeObserver(() => {
    view.resize()
    nearby.hidden = true
  }).observe(canvas)
  byId('hint-text').textContent = 'Коснитесь страны, чтобы услышать её название'
  for (const entry of catalog) select.add(new Option(entry.name, entry.code))
  function choose(country: Country) {
    view.selected = country.code
    select.value = country.code
    byId('chosen-name').textContent = country.name
    byId<HTMLImageElement>('chosen-flag').src = country.flag.src
    byId('selection').hidden = false
    hint.hidden = true
    nearby.hidden = true
    view.refresh()
    pronounce(country.code)
  }
  function closeCard() {
    view.selected = ''
    select.value = ''
    byId('selection').hidden = true
    hint.hidden = false
    nearby.hidden = true
    player.pause()
    view.refresh()
  }
  byId('dismiss').onclick = closeCard
  byId('repeat').onclick = () => {
    if (view.selected) pronounce(view.selected)
  }
  byId('reset').onclick = () => {
    closeCard()
    view.reset()
  }
  byId('close-nearby').onclick = () => (nearby.hidden = true)
  select.onchange = () => {
    const c = countries.get(select.value)
    if (!c) return closeCard()
    const focus = view.project(c.anchor)
    view.pan(view.width / 2 - focus[0], view.height / 2 - focus[1])
    choose(c)
  }
  function openMark(key: string) {
    const group = markers.get(key)
    if (!group) return
    if (group.countries.length === 1) return choose(group.countries[0])
    const choices = byId('choices')
    choices.replaceChildren()
    for (const country of group.countries) {
      const btn = document.createElement('button')
      const img = document.createElement('img')
      img.src = country.flag.src
      img.alt = ''
      btn.append(img, country.name)
      btn.onclick = () => choose(country)
      choices.append(btn)
    }
    nearby.hidden = false
    nearby.scrollTop = 0
    nearby.style.left =
      Math.max(
        8,
        Math.min(view.width - nearby.offsetWidth - 8, group.point[0] + 15),
      ) + 'px'
    nearby.style.top =
      Math.max(
        8,
        Math.min(view.height - nearby.offsetHeight - 8, group.point[1] - 20),
      ) + 'px'
  }
  byId('markers').addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('[data-key]')
    if (e.detail === 0 && btn) openMark(btn.dataset.key!)
  })

  const points = new Map<number, Point>()
  let origin: Point = [0, 0],
    mark: string | undefined,
    moved = false
  const middle = (a: Point, b: Point): Point => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ]
  const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])
  main.addEventListener('pointerdown', (e) => {
    const target = e.target as Element
    const btn = target.closest<HTMLButtonElement>('.mark')
    if ((target !== canvas && !btn) || e.button !== 0) return
    const p: Point = [e.clientX, e.clientY]
    if (!points.size) {
      origin = p
      mark = btn?.dataset.key
      moved = false
    } else moved = true
    points.set(e.pointerId, p)
    main.setPointerCapture(e.pointerId)
    nearby.hidden = true
  })
  main.addEventListener('pointermove', (e) => {
    const prev = points.get(e.pointerId)
    if (!prev) return
    const p: Point = [e.clientX, e.clientY]
    const other = Array.from(points.entries()).find(
      ([id]) => id !== e.pointerId,
    )?.[1]
    if (other && points.size === 2) {
      const d = distance(prev, other)
      if (d > 0)
        view.transform(
          middle(prev, other),
          middle(p, other),
          (view.zoom * distance(p, other)) / d,
        )
    } else if (points.size === 1) {
      if (!moved && distance(p, origin) < 6) return
      moved = true
      view.pan(p[0] - prev[0], p[1] - prev[1])
    }
    points.set(e.pointerId, p)
  })
  main.addEventListener('pointerup', (e) => {
    if (!points.delete(e.pointerId)) return
    const p: Point = [e.clientX, e.clientY]
    if (!moved && !points.size && distance(p, origin) < 6) {
      if (mark) openMark(mark)
      else {
        const country = view.hit(p)
        if (country) choose(country)
        else closeCard()
      }
    }
  })
  const cancel = (e: PointerEvent) => {
    if (points.delete(e.pointerId)) moved = true
  }
  main.addEventListener('pointercancel', cancel)
  main.addEventListener('lostpointercapture', cancel)

  function zoomAt(z: number, p: Point = [view.width / 2, view.height / 2]) {
    nearby.hidden = true
    view.transform(p, p, z)
  }
  byId('plus').onclick = () => zoomAt(view.zoom + 0.25)
  byId('minus').onclick = () => zoomAt(view.zoom - 0.25)
  main.addEventListener(
    'wheel',
    (e) => {
      if (e.target !== canvas && !(e.target as Element).closest('.mark')) return
      e.preventDefault()
      const dy =
        e.deltaY *
        (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.height : 1)
      zoomAt(view.zoom * Math.exp(-dy * 0.002), [e.clientX, e.clientY])
    },
    { passive: false },
  )
  canvas.onkeydown = (e) => {
    const arrows: Record<string, Point> = {
      ArrowLeft: [60, 0],
      ArrowRight: [-60, 0],
      ArrowUp: [0, 60],
      ArrowDown: [0, -60],
    }
    if (arrows[e.key]) view.pan(...arrows[e.key])
    else if (['+', '='].includes(e.key)) zoomAt(view.zoom + 0.25)
    else if (e.key === '-') zoomAt(view.zoom - 0.25)
    else if (e.key === 'Escape') closeCard()
    else return
    e.preventDefault()
  }
}
void start().catch(() => {
  byId('hint-text').textContent = 'Не удалось загрузить карту.'
  const retry = document.createElement('button')
  retry.textContent = 'Повторить'
  retry.onclick = () => location.reload()
  byId('hint').append(retry)
})

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const register = async () => {
    await navigator.serviceWorker.register('./sw.js')
    await navigator.serviceWorker.ready
    if (!sessionStorage.getItem('atlas-offline-notified')) {
      notice('Карта доступна без интернета')
      sessionStorage.setItem('atlas-offline-notified', '1')
    }
  }
  window.addEventListener('load', () => {
    void register().catch(() =>
      notice('Для сохранения офлайн откройте карту ещё раз с интернетом.'),
    )
  })
}
