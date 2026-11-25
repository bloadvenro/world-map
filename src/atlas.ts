import catalog from './countries.json'

export type Point = [number, number]
type Box = [number, number, number, number]
interface SourceFeature {
  code: string | null
  anchor: Point
  pieces: { d: string; b: Box }[]
}
export interface Country {
  code: string
  name: string
  anchor: Point
  markerSize: number
  flag: HTMLImageElement
}
interface Land {
  country?: Country
  pieces: { path: Path2D; b: Box }[]
}

export async function readAtlas() {
  const response = await fetch('./world.json')
  if (!response.ok) throw Error('world.json: ' + response.status)
  const { features, borders }: { features: SourceFeature[]; borders: string } =
    await response.json()
  const flags = new Map(
    await Promise.all(
      catalog.map(async (entry) => {
        const flag = new Image()
        flag.src = './flags/' + entry.code + '.svg'
        await flag.decode()
        return [entry.code, { ...entry, flag }] as const
      }),
    ),
  )
  const countries = new Map<string, Country>()
  const land = features.map((feature) => {
    const entry = flags.get(feature.code ?? '')
    let country: Country | undefined
    if (entry) {
      const markerSize = Math.max(
        ...feature.pieces.map(({ b }) => Math.min(b[2] - b[0], b[3] - b[1])),
      )
      country = { ...entry, anchor: feature.anchor, markerSize }
      countries.set(country.code, country)
    }
    return {
      country,
      pieces: feature.pieces.map(({ d, b }) => ({ path: new Path2D(d), b })),
    }
  })
  return { countries, land, borders: new Path2D(borders) }
}

const wrap = (x: number) => ((((x + 180) % 360) + 360) % 360) - 180
const clamp = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, n))
const oceans: [string, number, number][] = [
  ['ТИХИЙ ОКЕАН', -130, 3],
  ['АТЛАНТИЧЕСКИЙ ОКЕАН', -25, 32],
  ['ИНДИЙСКИЙ ОКЕАН', 77, 26],
  ['СЕВЕРНЫЙ ЛЕДОВИТЫЙ ОКЕАН', 5, -84],
  ['ЮЖНЫЙ ОКЕАН', 75, 61],
]

export class Atlas {
  width = 1
  height = 1
  zoom = 1
  center: Point = [20, 0]
  selected = ''
  private frame = 0
  private ctx: CanvasRenderingContext2D
  private texture = document.createElement('canvas')

  constructor(
    private canvas: HTMLCanvasElement,
    private land: Land[],
    private borders: Path2D,
    private afterDraw: () => void,
  ) {
    this.ctx = canvas.getContext('2d')!
    this.resize()
  }

  get baseScale() {
    return this.height > this.width
      ? this.height / 180
      : Math.min(this.width / 360, this.height / 180)
  }
  get scale() {
    return this.baseScale * this.zoom
  }

  resize() {
    this.width = this.canvas.clientWidth
    this.height = this.canvas.clientHeight
    const ratio = Math.min(devicePixelRatio || 1, 3)
    this.canvas.width = Math.round(this.width * ratio)
    this.canvas.height = Math.round(this.height * ratio)
    // Cache the static flag artwork once so swiping never redraws thousands of clipped islands.
    const textureWidth = Math.min(
      4096,
      Math.max(1440, Math.ceil(this.baseScale * 360 * ratio * 2)),
    )
    if (this.texture.width !== textureWidth) this.bake(textureWidth)
    this.constrain()
    this.refresh()
  }

  private bake(width: number) {
    this.texture.width = width
    this.texture.height = Math.round(width / 2)
    const ctx = this.texture.getContext('2d')!
    ctx.setTransform(
      width / 360,
      0,
      0,
      this.texture.height / 180,
      width / 2,
      this.texture.height / 2,
    )
    ctx.lineJoin = 'round'
    for (const { country, pieces } of this.land) {
      for (const { path, b } of pieces) {
        ctx.fillStyle = country ? '#faf3dc' : '#e9e8d8'
        ctx.fill(path, 'evenodd')
        if (country) {
          ctx.save()
          ctx.clip(path, 'evenodd')
          ctx.drawImage(country.flag, b[0], b[1], b[2] - b[0], b[3] - b[1])
          ctx.restore()
        }
        ctx.strokeStyle = 'rgba(30,55,65,.8)'
        ctx.lineWidth = 0.7 / this.baseScale
        ctx.stroke(path)
      }
    }
  }

  project(p: Point): Point {
    return [
      this.width / 2 + wrap(p[0] - this.center[0]) * this.scale,
      this.height / 2 + (p[1] - this.center[1]) * this.scale,
    ]
  }
  private world(p: Point): Point {
    return [
      this.center[0] + (p[0] - this.width / 2) / this.scale,
      this.center[1] + (p[1] - this.height / 2) / this.scale,
    ]
  }
  private constrain() {
    this.center[0] = wrap(this.center[0])
    const limit = Math.max(0, 90 - this.height / (2 * this.scale))
    this.center[1] = clamp(this.center[1], -limit, limit)
  }
  pan(dx: number, dy: number) {
    this.center[0] -= dx / this.scale
    this.center[1] -= dy / this.scale
    this.constrain()
    this.refresh()
  }
  transform(from: Point, to: Point, zoom: number) {
    const anchor = this.world(from)
    this.zoom = clamp(zoom, 1, 2)
    this.center = [
      anchor[0] - (to[0] - this.width / 2) / this.scale,
      anchor[1] - (to[1] - this.height / 2) / this.scale,
    ]
    this.constrain()
    this.refresh()
  }
  reset() {
    this.center = [20, 0]
    this.zoom = 1
    this.refresh()
  }
  hit(p: Point) {
    const [lng, y] = this.world(p)
    const x = wrap(lng)
    this.ctx.save()
    this.ctx.resetTransform()
    try {
      for (const { country, pieces } of this.land) {
        if (!country) continue
        for (const { path, b } of pieces) {
          if (
            x >= b[0] &&
            x <= b[2] &&
            y >= b[1] &&
            y <= b[3] &&
            this.ctx.isPointInPath(path, x, y, 'evenodd')
          )
            return country
        }
      }
    } finally {
      this.ctx.restore()
    }
  }
  refresh() {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.draw()
      this.afterDraw()
    })
  }
  private draw() {
    const { ctx, width, height, scale } = this
    ctx.setTransform(
      this.canvas.width / width,
      0,
      0,
      this.canvas.height / height,
      0,
      0,
    )
    ctx.fillStyle = '#d4e8ea'
    ctx.fillRect(0, 0, width, height)
    const left = this.world([0, 0])[0]
    const right = this.world([width, height])[0]
    const top = this.project([0, -90])[1]
    const bottom = this.project([0, 90])[1]
    const screenX = (lng: number) => (lng - this.center[0]) * scale + width / 2
    ctx.strokeStyle = '#b8d5da'
    ctx.lineWidth = 0.8
    ctx.beginPath()
    for (let lng = Math.ceil(left / 15) * 15; lng < right; lng += 15) {
      ctx.moveTo(screenX(lng), top)
      ctx.lineTo(screenX(lng), bottom)
    }
    for (let y = -90; y <= 90; y += 15) {
      const py = this.project([0, y])[1]
      ctx.moveTo(0, py)
      ctx.lineTo(width, py)
    }
    ctx.stroke()
    const chosen = this.selected
      ? this.land.find((f) => f.country?.code === this.selected)
      : undefined
    for (
      let k = Math.floor((left + 180) / 360);
      k <= Math.floor((right + 180) / 360);
      k++
    ) {
      ctx.drawImage(
        this.texture,
        screenX(-180 + 360 * k),
        top,
        360 * scale,
        180 * scale,
      )
      // Shared land borders stay crisp independently of the cached flag texture.
      ctx.save()
      ctx.translate(screenX(k * 360), this.project([0, 0])[1])
      ctx.scale(scale, scale)
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.lineWidth = (2.3 + 0.32 * (this.zoom - 1)) / scale
      ctx.strokeStyle = 'rgba(30,51,63,.70)'
      ctx.stroke(this.borders)
      ctx.lineWidth = (1.4 + 0.32 * (this.zoom - 1)) / scale
      ctx.strokeStyle = '#ffffff'
      ctx.stroke(this.borders)
      ctx.restore()
      if (chosen) {
        ctx.save()
        ctx.translate(screenX(k * 360), this.project([0, 0])[1])
        ctx.scale(scale, scale)
        ctx.lineJoin = 'round'
        for (const { path } of chosen.pieces) {
          ctx.strokeStyle = '#16394f'
          ctx.lineWidth = 4 / scale
          ctx.stroke(path)
          ctx.strokeStyle = '#ffcf67'
          ctx.lineWidth = 2 / scale
          ctx.stroke(path)
          ctx.fillStyle = 'rgba(255,226,139,.16)'
          ctx.fill(path, 'evenodd')
        }
        ctx.restore()
      }
      ctx.font = 'italic 600 ' + clamp(scale * 2.3, 10, 16) + 'px Georgia,serif'
      ctx.textAlign = 'center'
      ctx.fillStyle = '#47717e'
      for (const [label, x, y] of oceans) {
        ctx.fillText(
          label,
          screenX(x + k * 360),
          this.project([0, y])[1],
          scale * 36,
        )
      }
    }
  }
}
