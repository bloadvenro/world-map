import { DETAIL_ZOOM, type Atlas, type Country, type Point } from './atlas'

interface Group {
  point: Point
  countries: Country[]
}
export class Markers {
  private groups = new Map<string, Group>()
  private buttons = new Map<string, HTMLButtonElement>()

  constructor(
    private layer: HTMLElement,
    private countries: Map<string, Country>,
  ) {}
  get(key: string) {
    return this.groups.get(key)
  }
  draw(view: Atlas) {
    const groups: Group[] = []
    const period = view.scale * 360
    const closeUp = view.zoom > DETAIL_ZOOM
    for (const country of this.countries.values()) {
      if (view.globe && !closeUp) break
      if (country.markerSize * view.scale >= (closeUp ? 44 : 24)) continue
      const point = view.markerPoint(country.anchor)
      if (!point) continue
      const [baseX, y] = point
      if (view.globe && baseX < -22) continue
      if (y < -22 || y > view.height + 22) continue
      for (
        let x = view.globe
          ? baseX
          : baseX + Math.ceil((-22 - baseX) / period) * period;
        x < view.width + 22;
        x += period
      ) {
        const group = groups.find(
          (g) => Math.abs(g.point[0] - x) < 42 && Math.abs(g.point[1] - y) < 42,
        )
        if (group) group.countries.push(country)
        else groups.push({ point: [x, y], countries: [country] })
        if (view.globe) break
      }
    }
    this.groups.clear()
    for (const group of groups) {
      const {
        countries,
        point: [x, y],
      } = group
      let key = countries.map((c) => c.code).join('-')
      while (this.groups.has(key)) key += '*'
      this.groups.set(key, group)
      let button = this.buttons.get(key)
      if (!button) {
        button = document.createElement('button')
        button.className = countries.length > 1 ? 'mark group' : 'mark'
        button.dataset.key = key
        button.title = countries.map((c) => c.name).join(', ')
        button.setAttribute('aria-label', button.title)
        const dot = document.createElement('span')
        dot.textContent = countries.length > 1 ? String(countries.length) : ''
        button.append(dot)
        this.layer.append(button)
        this.buttons.set(key, button)
      }
      button.style.left = x + 'px'
      button.style.top = y + 'px'
      button.classList.toggle('ring', closeUp && countries.length === 1)
      button.classList.toggle(
        'active',
        countries.some((c) => c.code === view.selected),
      )
    }
    for (const [key, button] of this.buttons) {
      if (this.groups.has(key)) continue
      button.remove()
      this.buttons.delete(key)
    }
  }
}
