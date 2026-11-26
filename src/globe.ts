import type { Box, Point } from './atlas'

const rad = Math.PI / 180
const unit = (v: number) => Math.max(-1, Math.min(1, v))
const wrap = (v: number) => v - 360 * Math.floor((v + 180) / 360)

export interface GlobeView {
  width: number
  height: number
  zoom: number
  center: Point // longitude, south-positive latitude (same as the atlas paths)
}

export function globeRadius(v: GlobeView) {
  return 0.405 * Math.min(v.width, v.height) * v.zoom
}

export function globeProject(v: GlobeView, point: Point): Point | undefined {
  const r = globeRadius(v)
  const d = (point[0] - v.center[0]) * rad
  const b = point[1] * rad
  const c = v.center[1] * rad
  const forward = Math.cos(b) * Math.cos(d)
  if (forward * Math.cos(c) + Math.sin(b) * Math.sin(c) < 0) return
  return [
    v.width / 2 + r * Math.cos(b) * Math.sin(d),
    v.height / 2 + r * (Math.sin(b) * Math.cos(c) - forward * Math.sin(c)),
  ]
}

function normal(v: GlobeView, screen: Point) {
  const r = globeRadius(v)
  const x = (screen[0] - v.width / 2) / r
  const y = (screen[1] - v.height / 2) / r
  const z2 = 1 - x * x - y * y
  if (z2 >= 0) return { x, y, z: Math.sqrt(z2) }
}

export function globeWorld(v: GlobeView, screen: Point): Point | undefined {
  const n = normal(v, screen)
  if (!n) return
  const c = v.center[1] * rad
  return [
    wrap(
      v.center[0] +
        Math.atan2(n.x, n.z * Math.cos(c) - n.y * Math.sin(c)) / rad,
    ),
    Math.asin(unit(n.y * Math.cos(c) + n.z * Math.sin(c))) / rad,
  ]
}

// Find the north-up camera orientation that keeps the touched country under the fingers.
export function anchorGlobe(v: GlobeView, anchor: Point, screen: Point) {
  const n = normal(v, screen)
  if (!n) return false
  const a = Math.atan2(n.y, n.z)
  const b = Math.asin(
    unit(Math.sin(anchor[1] * rad) / (Math.hypot(n.y, n.z) || 1)),
  )
  const candidates = [wrap((b - a) / rad), wrap((Math.PI - b - a) / rad)]
  const nearest = candidates
    .filter((y) => Math.abs(y) <= 90)
    .sort(
      (y, other) => Math.abs(y - v.center[1]) - Math.abs(other - v.center[1]),
    )[0]
  const lat = nearest ?? 90 * unit(candidates[0] / 90)
  const c = lat * rad
  v.center = [
    wrap(
      anchor[0] - Math.atan2(n.x, n.z * Math.cos(c) - n.y * Math.sin(c)) / rad,
    ),
    lat,
  ]
  return true
}

interface Raster {
  bounds: Box
  pixels: ImageData
  zoom: number
}
type Paint = (ctx: CanvasRenderingContext2D, bounds: Box, scale: number) => void

// Only the globe's visible disc is sampled. A padded regional texture keeps
// the original SVG flags legible up close without allocating a planet-sized bitmap.
export class GlobeRenderer {
  private surface = document.createElement('canvas')
  private surfaceCtx = this.surface.getContext('2d')!
  private scratch = document.createElement('canvas')
  private scratchCtx = this.scratch.getContext('2d', {
    willReadFrequently: true,
  })!
  private buffer?: ImageData
  private overview?: Raster
  private region?: Raster

  invalidate() {
    this.overview = this.region = undefined
  }

  private raster(
    bounds: Box,
    width: number,
    height: number,
    zoom: number,
    paint: Paint,
  ): Raster {
    const ctx = this.scratchCtx
    if (this.scratch.width !== width) this.scratch.width = width
    if (this.scratch.height !== height) this.scratch.height = height
    const [west, north, east, south] = bounds
    const sx = width / (east - west)
    const sy = height / (south - north)
    ctx.setTransform(sx, 0, 0, sy, -west * sx, -north * sy)
    paint(ctx, bounds, Math.min(sx, sy))
    return { bounds, pixels: ctx.getImageData(0, 0, width, height), zoom }
  }

  private texture(v: GlobeView, paint: Paint) {
    const r = globeRadius(v)
    const chord = Math.hypot(v.width, v.height) / (2 * r)
    if (v.zoom <= 4 || chord >= 0.85) {
      return (this.overview ??= this.raster(
        [-180, -90, 180, 90],
        2048,
        1024,
        1,
        paint,
      ))
    }
    const [lng, lat] = v.center
    const dy = Math.asin(chord) / rad
    const dx =
      Math.abs(lat) + dy >= 90
        ? 180
        : Math.asin(unit(chord / Math.cos(lat * rad))) / rad
    const north = Math.max(-90, lat - dy),
      south = Math.min(90, lat + dy)
    if (this.region) {
      const [w, n, e, s] = this.region.bounds
      const x = (w + e) / 2 + wrap(lng - (w + e) / 2)
      if (
        (e - w >= 360 || (x - dx >= w && x + dx <= e)) &&
        north >= n &&
        south <= s &&
        v.zoom <= this.region.zoom * 1.4 &&
        v.zoom >= this.region.zoom * 0.6
      )
        return this.region
    }
    const half = Math.min(180, dx * 1.45)
    const bounds: Box = [
      lng - half,
      Math.max(-90, lat - dy * 1.45),
      lng + half,
      Math.min(90, lat + dy * 1.45),
    ]
    const density = r * rad * Math.min(devicePixelRatio || 1, 2)
    const size = (pixels: number) =>
      Math.max(128, Math.min(2048, Math.ceil(pixels)))
    return (this.region = this.raster(
      bounds,
      size(
        2 * half * density * Math.cos(Math.max(0, Math.abs(lat) - dy) * rad),
      ),
      size((bounds[3] - bounds[1]) * density),
      v.zoom,
      paint,
    ))
  }

  draw(
    ctx: CanvasRenderingContext2D,
    v: GlobeView,
    moving: boolean,
    paint: Paint,
  ) {
    const { width, height } = v
    const r = globeRadius(v)
    const w = Math.min(width, 2 * r + 2),
      h = Math.min(height, 2 * r + 2)
    if (2 * r <= Math.hypot(width, height) + 4) {
      this.drawSpace(ctx, width, height, r)
    }
    // Bound the work per frame independently of the device's physical resolution.
    const ratio = Math.min(
      devicePixelRatio || 1,
      Math.sqrt((moving ? 220000 : 1000000) / (w * h)),
    )
    const sw = Math.max(1, Math.ceil(w * ratio)),
      sh = Math.max(1, Math.ceil(h * ratio))
    if (
      sw !== this.surface.width ||
      sh !== this.surface.height ||
      !this.buffer
    ) {
      this.surface.width = sw
      this.surface.height = sh
      this.buffer = this.surfaceCtx.createImageData(sw, sh)
    }
    const out = this.buffer.data
    const {
      pixels,
      bounds: [west, north, east, south],
    } = this.texture(v, paint)
    const sx = pixels.width / (east - west),
      sy = pixels.height / (south - north)
    const c = v.center[1] * rad,
      sin = Math.sin(c),
      cos = Math.cos(c)
    const mid = (west + east) / 2
    const dx = w / (sw * r),
      dy = h / (sh * r)
    let i = 0
    for (let row = 0; row < sh; row++) {
      const y = (row + 0.5 - sh / 2) * dy
      for (let col = 0; col < sw; col++, i += 4) {
        const x = (col + 0.5 - sw / 2) * dx
        const z2 = 1 - x * x - y * y
        if (z2 < 0) {
          out[i + 3] = 0
          continue
        }
        const z = Math.sqrt(z2)
        const lng =
          mid + wrap(v.center[0] - mid + Math.atan2(x, z * cos - y * sin) / rad)
        const lat = Math.asin(unit(y * cos + z * sin)) / rad
        const u = Math.max(
          0,
          Math.min(pixels.width - 1, Math.floor((lng - west) * sx)),
        )
        const t = Math.max(
          0,
          Math.min(pixels.height - 1, Math.floor((lat - north) * sy)),
        )
        const j = (t * pixels.width + u) * 4
        const light = 0.74 + 0.26 * z - 0.11 * x - 0.09 * y
        out[i] = pixels.data[j] * light
        out[i + 1] = pixels.data[j + 1] * light
        out[i + 2] = pixels.data[j + 2] * light
        out[i + 3] = 255
      }
    }
    this.surfaceCtx.putImageData(this.buffer, 0, 0)
    ctx.drawImage(this.surface, (width - w) / 2, (height - h) / 2, w, h)
  }

  private drawSpace(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    r: number,
  ) {
    ctx.fillStyle = '#090f20'
    ctx.fillRect(0, 0, w, h)
    let seed = 4321
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < Math.min(420, (w * h) / 2600); i++) {
      const x = random() * w,
        y = random() * h
      const size = 0.4 + random() * 1.05
      ctx.fillStyle = 'rgba(215,233,255,' + (0.18 + random() * 0.6) + ')'
      ctx.fillRect(x, y, size, size)
    }
    const halo = ctx.createRadialGradient(
      w / 2,
      h / 2,
      Math.max(0, r - 1),
      w / 2,
      h / 2,
      r + 18,
    )
    halo.addColorStop(0, '#91d9ff')
    halo.addColorStop(0.16, '#6199c557')
    halo.addColorStop(1, '#37577f00')
    ctx.fillStyle = halo
    ctx.fillRect(0, 0, w, h)
  }
}
