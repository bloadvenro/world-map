import './style.css'
import { Atlas, readAtlas, type Country, type Point } from './atlas'
import { Markers } from './markers'
import catalog from './countries.json'

const byId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T
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
function pronounce(code: string) {
  player.pause()
  player.src = './voice/' + code + '.mp3'
  void player.play().catch((err: Error) => {
    if (err.name !== 'AbortError')
      notice('Запись не воспроизвелась. Можно попробовать ещё раз.')
  })
}

async function start() {
  const { countries, overview, loadDetail } = await readAtlas()
  const main = byId('atlas')
  const canvas = byId<HTMLCanvasElement>('map')
  const markers = new Markers(byId('markers'), countries)
  const select = byId<HTMLSelectElement>('keyboard-country')
  const nearby = byId('nearby')
  const view = new Atlas(canvas, overview, loadDetail, () => {
    markers.draw(view)
    canvas.setAttribute(
      'aria-description',
      'Масштаб ' +
        view.zoom.toLocaleString('ru', { maximumFractionDigits: 2 }) +
        '×',
    )
  })
  const modes = byId('view-mode')
  modes.hidden = false
  modes.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>(
      'button',
    )
    if (!button) return
    view.setGlobe(button.value === 'globe')
    nearby.hidden = true
    for (const choice of modes.querySelectorAll('button'))
      choice.setAttribute('aria-pressed', String(choice === button))
    canvas.setAttribute(
      'aria-label',
      view.globe
        ? 'Глобус. Стрелки вращают Землю, плюс и минус меняют масштаб.'
        : 'Карта мира. Стрелки перемещают карту, плюс и минус меняют масштаб.',
    )
  })
  new ResizeObserver(() => {
    view.resize()
    nearby.hidden = true
  }).observe(canvas)
  for (const entry of catalog) select.add(new Option(entry.name, entry.code))
  function choose(country: Country) {
    view.selected = country.code
    select.value = country.code
    byId('chosen-name').textContent = country.name
    byId<HTMLImageElement>('chosen-flag').src = country.flag.src
    byId('selection').hidden = false
    nearby.hidden = true
    view.refresh()
    pronounce(country.code)
  }
  function closeCard() {
    view.selected = ''
    select.value = ''
    byId('selection').hidden = true
    nearby.hidden = true
    player.pause()
    view.refresh()
  }
  byId('dismiss').onclick = closeCard
  byId('close-nearby').onclick = () => (nearby.hidden = true)
  select.onchange = () => {
    const c = countries.get(select.value)
    if (!c) return closeCard()
    view.focus(c.anchor)
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
      if (view.globe) view.transform(prev, p, view.zoom)
      else view.pan(p[0] - prev[0], p[1] - prev[1])
    }
    points.set(e.pointerId, p)
  })
  main.addEventListener('pointerup', (e) => {
    if (!points.delete(e.pointerId)) return
    if (!points.size) view.settle()
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
    if (points.delete(e.pointerId)) {
      moved = true
      if (!points.size) view.settle()
    }
  }
  main.addEventListener('pointercancel', cancel)
  main.addEventListener('lostpointercapture', cancel)

  function zoomAt(z: number, p: Point = [view.width / 2, view.height / 2]) {
    nearby.hidden = true
    view.transform(p, p, z)
  }
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
    else if (['+', '='].includes(e.key))
      zoomAt(view.zoom < 16 ? view.zoom + 0.25 : view.zoom * 1.25)
    else if (e.key === '-')
      zoomAt(
        view.zoom <= 16 ? view.zoom - 0.25 : Math.max(16, view.zoom / 1.25),
      )
    else if (e.key === 'Escape') closeCard()
    else return
    e.preventDefault()
  }
}
void start().catch(() => {
  const status = document.createElement('aside')
  status.id = 'load-error'
  status.className = 'panel'
  status.setAttribute('role', 'alert')
  status.textContent = 'Не удалось загрузить карту. '
  const retry = document.createElement('button')
  retry.textContent = 'Повторить'
  retry.onclick = () => location.reload()
  status.append(retry)
  byId('atlas').append(status)
})

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const register = async () => {
    const registration = await navigator.serviceWorker.register('./sw.js')
    if (!registration.active) {
      await navigator.serviceWorker.ready
      notice('Карта доступна без интернета')
    }
  }
  window.addEventListener('load', () => {
    void register().catch(() =>
      notice('Для сохранения офлайн откройте карту ещё раз с интернетом.'),
    )
  })
}
