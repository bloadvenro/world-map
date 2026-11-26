import moonUrl from './moon.webp'
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

// Scene coordinates at the initial Africa-facing view: right, down, towards the observer.
type Vector = { x: number; y: number; z: number }
const sceneMeridian = 20
const moonPosition = { x: -0.93, y: 0.84, z: 1 }
const sunLength = Math.hypot(0.48, -0.42, -1)
const sunDirection = {
  x: 0.48 / sunLength,
  y: -0.42 / sunLength,
  z: -1 / sunLength,
}

function cameraRotation(center: Point) {
  const yaw = (center[0] - sceneMeridian) * rad,
    pitch = center[1] * rad
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw),
    cp = Math.cos(pitch),
    sp = Math.sin(pitch)
  return ({ x, y, z }: Vector): Vector => {
    const depth = x * sy + z * cy
    return {
      x: x * cy - z * sy,
      y: y * cp - depth * sp,
      z: y * sp + depth * cp,
    }
  }
}

function screenDisc(
  v: GlobeView,
  direction: Vector,
  scale: number,
  radius: number,
) {
  const x = v.width / 2 + direction.x * scale,
    y = v.height / 2 + direction.y * scale
  if (
    x + radius < 0 ||
    y + radius < 0 ||
    x - radius > v.width ||
    y - radius > v.height
  )
    return
  return { x, y, radius, front: direction.z > 0 }
}

function moonDisc(v: GlobeView, direction: Vector) {
  const focal = 0.9 * Math.min(v.width, v.height)
  // As we approach the surface, the observer can pass the Moon.
  const distance = 1 + focal / globeRadius(v) - direction.z
  if (distance <= 0.01) return
  const scale = focal / distance
  return screenDisc(v, direction, scale, 0.19 * scale)
}

function makeStars() {
  let seed = 4321
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  return Array.from({ length: 2400 }, () => {
    const y = 2 * random() - 1,
      azimuth = random() * 2 * Math.PI
    const horizontal = Math.sqrt(1 - y * y)
    return {
      x: horizontal * Math.cos(azimuth),
      y,
      z: horizontal * Math.sin(azimuth),
      brightness: random(),
      color: random() < 0.2 ? '#ffe6bf' : '#dfedff',
    }
  })
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

  private stars = makeStars()
  private moon = new Image()

  constructor(refresh: () => void) {
    this.moon.onload = refresh
    this.moon.src = moonUrl
  }

  moonCovers(v: GlobeView, point: Point) {
    if (!this.moon.naturalWidth) return false
    const disc = moonDisc(v, cameraRotation(v.center)(moonPosition))
    return (
      !!disc?.front &&
      Math.hypot(point[0] - disc.x, point[1] - disc.y) <= disc.radius
    )
  }

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
    const rotate = cameraRotation(v.center)
    const sun = rotate(sunDirection)
    const moon = moonDisc(v, rotate(moonPosition))
    if (2 * r <= Math.hypot(width, height) + 4) {
      this.drawSpace(ctx, v, rotate, sun, r)
      if (moon && !moon.front) this.drawMoon(ctx, moon, sun)
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
        const light =
          0.83 + 0.16 * z + 0.14 * (x * sun.x + y * sun.y + z * sun.z)
        out[i] = pixels.data[j] * light
        out[i + 1] = pixels.data[j + 1] * light
        out[i + 2] = pixels.data[j + 2] * light
        out[i + 3] = 255
      }
    }
    this.surfaceCtx.putImageData(this.buffer, 0, 0)
    ctx.drawImage(this.surface, (width - w) / 2, (height - h) / 2, w, h)
    if (moon?.front) this.drawMoon(ctx, moon, sun)
  }

  private drawMoon(
    ctx: CanvasRenderingContext2D,
    disc: NonNullable<ReturnType<typeof moonDisc>>,
    sun: Vector,
  ) {
    if (!this.moon.naturalWidth) return
    ctx.save()
    ctx.translate(disc.x, disc.y)
    ctx.rotate(
      Math.atan2(sun.y, sun.x) - Math.atan2(sunDirection.y, sunDirection.x),
    )
    ctx.drawImage(
      this.moon,
      -disc.radius,
      -disc.radius,
      disc.radius * 2,
      disc.radius * 2,
    )
    ctx.restore()
  }

  private drawSpace(
    ctx: CanvasRenderingContext2D,
    v: GlobeView,
    rotate: (p: Vector) => Vector,
    sunlight: Vector,
    r: number,
  ) {
    const { width: w, height: h } = v
    const focal = 0.9 * Math.min(w, h)
    ctx.fillStyle = '#090f20'
    ctx.fillRect(0, 0, w, h)
    for (const star of this.stars) {
      const direction = rotate(star)
      if (direction.z >= 0) continue
      const position = screenDisc(v, direction, -focal / direction.z, 4)
      if (!position) continue
      const { x, y } = position
      const { brightness } = star
      const radius = 0.45 + brightness * brightness * 1.05
      ctx.fillStyle = star.color
      ctx.globalAlpha = 0.35 + brightness * 0.65
      ctx.beginPath()
      ctx.arc(x, y, radius, 0, 2 * Math.PI)
      ctx.fill()
      if (brightness > 0.965) {
        ctx.globalAlpha = 0.55
        ctx.beginPath()
        ctx.moveTo(x, y - 4)
        ctx.quadraticCurveTo(x, y, x + 3.2, y)
        ctx.quadraticCurveTo(x, y, x, y + 4)
        ctx.quadraticCurveTo(x, y, x - 3.2, y)
        ctx.quadraticCurveTo(x, y, x, y - 4)
        ctx.fill()
      }
    }
    ctx.globalAlpha = 1
    const radius = Math.max(6, Math.min(w, h) * 0.018)
    if (sunlight.z < 0) {
      const position = screenDisc(v, sunlight, -focal / sunlight.z, radius * 7)
      if (position) this.drawSun(ctx, position.x, position.y, radius)
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

  private drawSun(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
  ) {
    const reach = radius * 7
    const sun = ctx.createRadialGradient(x, y, 0, x, y, reach)
    sun.addColorStop(0, '#fffff4')
    sun.addColorStop(0.115, '#fff4c4')
    sun.addColorStop(1 / 7, '#ffda86')
    sun.addColorStop(0.15, '#ffc166b8')
    sun.addColorStop(0.24, '#ffac484f')
    sun.addColorStop(0.52, '#ff9a3718')
    sun.addColorStop(1, '#ff963100')
    ctx.fillStyle = sun
    ctx.fillRect(x - reach, y - reach, reach * 2, reach * 2)
  }
}
