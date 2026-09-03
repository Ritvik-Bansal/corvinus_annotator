// Drawing helpers for the two vector layers.
//
// KEY DECISION: the image layer draws in image space through the viewport
// transform, but the annotation and overlay layers draw in SCREEN space, with
// every position produced by imageToScreen. Two consequences fall out for free:
//   - line widths and handle sizes are already zoom-independent, with no
//     per-shape 1/scale compensation anywhere;
//   - the only coordinate math in the whole rendering path is imageToScreen.

import { imageToScreen } from './viewport.ts'
import type { BboxGeometry, Point, Viewport } from '../state/types.ts'

/** CSS pixels. Constant on screen at any zoom, by construction. */
export const HANDLE_SIZE = 9
/** Slightly larger than the visual handle so it stays easy to grab. */
export const HANDLE_HIT_RADIUS = 10

export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

/** The one conversion: two opposite corners through imageToScreen. */
export function bboxToScreen(geometry: BboxGeometry, viewport: Viewport): ScreenRect {
  const topLeft = imageToScreen({ x: geometry.x, y: geometry.y }, viewport)
  const bottomRight = imageToScreen(
    { x: geometry.x + geometry.width, y: geometry.y + geometry.height },
    viewport,
  )
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  }
}

export type HandleId = 'nw' | 'ne' | 'se' | 'sw'
export const HANDLE_IDS: readonly HandleId[] = ['nw', 'ne', 'se', 'sw']

/** Every vertex of a polygon, in screen space. Same single conversion as boxes. */
export function polygonToScreen(
  geometry: { points: readonly Point[] },
  viewport: Viewport,
): Point[] {
  return geometry.points.map((point) => imageToScreen(point, viewport))
}

/** Top-left of a point set's bounding box, used to anchor the class-name chip. */
export function screenBounds(points: readonly Point[]): Point {
  let x = Infinity
  let y = Infinity
  for (const point of points) {
    if (point.x < x) x = point.x
    if (point.y < y) y = point.y
  }
  return { x, y }
}

export function handlePoint(rect: ScreenRect, id: HandleId): Point {
  const right = rect.x + rect.width
  const bottom = rect.y + rect.height
  switch (id) {
    case 'nw':
      return { x: rect.x, y: rect.y }
    case 'ne':
      return { x: right, y: rect.y }
    case 'se':
      return { x: right, y: bottom }
    case 'sw':
      return { x: rect.x, y: bottom }
  }
}

export function drawBox(
  ctx: CanvasRenderingContext2D,
  rect: ScreenRect,
  color: string,
  options: { selected?: boolean; dashed?: boolean } = {},
): void {
  ctx.save()
  ctx.fillStyle = color
  ctx.globalAlpha = options.selected === true ? 0.2 : 0.12
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)

  ctx.globalAlpha = 1
  ctx.strokeStyle = color
  ctx.lineWidth = options.selected === true ? 2 : 1.5
  if (options.dashed === true) ctx.setLineDash([6, 4])
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
  ctx.restore()
}

export function rectHandlePoints(rect: ScreenRect): Point[] {
  return HANDLE_IDS.map((id) => handlePoint(rect, id))
}

/**
 * Handles for an arbitrary point set — box corners or polygon vertices.
 * Fixed pixel size because this layer works in screen space, which is the whole
 * reason they stay grabbable at 20% and at 400%.
 */
export function drawPointHandles(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  color: string,
  emphasisIndex = -1,
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  points.forEach((point, index) => {
    const size = index === emphasisIndex ? HANDLE_SIZE + 4 : HANDLE_SIZE
    const half = size / 2
    ctx.fillStyle = index === emphasisIndex ? color : '#ffffff'
    ctx.fillRect(point.x - half, point.y - half, size, size)
    ctx.strokeRect(point.x - half, point.y - half, size, size)
  })
  ctx.restore()
}

export function drawPolygon(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  color: string,
  options: { selected?: boolean; open?: boolean; dashed?: boolean } = {},
): void {
  if (points.length === 0) return
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y)

  // An in-progress shape is an open polyline: no closing edge and no fill,
  // so it never looks finished before it is.
  if (options.open !== true) {
    ctx.closePath()
    ctx.fillStyle = color
    ctx.globalAlpha = options.selected === true ? 0.2 : 0.12
    ctx.fill()
    ctx.globalAlpha = 1
  }
  ctx.strokeStyle = color
  ctx.lineWidth = options.selected === true ? 2 : 1.5
  if (options.dashed === true) ctx.setLineDash([6, 4])
  ctx.stroke()
  ctx.restore()
}

/**
 * Even-odd ray casting. Counts how many edges a rightward ray from the point
 * crosses; odd means inside. This is why the hollow of a concave "C" is
 * correctly outside the shape, which a bounding-box test would get wrong.
 */
export function hitPolygon(points: readonly Point[], probe: Point): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i]
    const b = points[j]
    // Does the horizontal ray at probe.y pass between this edge's endpoints?
    if (a.y > probe.y === b.y > probe.y) continue
    const crossingX = a.x + ((probe.y - a.y) / (b.y - a.y)) * (b.x - a.x)
    if (probe.x < crossingX) inside = !inside
  }
  return inside
}

export function hitVertex(points: readonly Point[], screenPoint: Point): number | null {
  for (let i = 0; i < points.length; i += 1) {
    if (
      Math.abs(screenPoint.x - points[i].x) <= HANDLE_HIT_RADIUS &&
      Math.abs(screenPoint.y - points[i].y) <= HANDLE_HIT_RADIUS
    ) {
      return i
    }
  }
  return null
}

/**
 * Class name in a filled chip above the box. Drawn in screen space like
 * everything else on this layer, so the text stays legible at every zoom
 * instead of scaling with the image.
 */
/**
 * Class name in a filled chip above the shape. Drawn in screen space like
 * everything else on this layer, so the text stays legible at every zoom
 * instead of scaling with the image.
 */
export function drawLabelChip(
  ctx: CanvasRenderingContext2D,
  anchor: Point,
  text: string,
  color: string,
): void {
  ctx.save()
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.textBaseline = 'middle'

  const paddingX = 5
  const height = 15
  const width = ctx.measureText(text).width + paddingX * 2
  // Flip below the top edge when the chip would sit off the top of the canvas.
  const y = anchor.y - height - 2 < 0 ? anchor.y + 2 : anchor.y - height - 2

  ctx.fillStyle = color
  ctx.fillRect(anchor.x, y, width, height)
  ctx.fillStyle = readableTextOn(color)
  ctx.fillText(text, anchor.x + paddingX, y + height / 2)
  ctx.restore()
}

/**
 * Black or white, whichever is readable on the class colour. Saturated greens,
 * ambers and limes need dark text; blues and reds need light.
 */
export function readableTextOn(color: string): string {
  const hex = color.replace('#', '')
  if (hex.length < 6) return '#ffffff'
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  // Rec. 709 luma.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? '#000000' : '#ffffff'
}

/** Hit tests run in screen space, which is why grabbing works at any zoom. */
export function hitHandle(rect: ScreenRect, screenPoint: Point): HandleId | null {
  for (const id of HANDLE_IDS) {
    const point = handlePoint(rect, id)
    if (
      Math.abs(screenPoint.x - point.x) <= HANDLE_HIT_RADIUS &&
      Math.abs(screenPoint.y - point.y) <= HANDLE_HIT_RADIUS
    ) {
      return id
    }
  }
  return null
}

export function hitBox(rect: ScreenRect, screenPoint: Point): boolean {
  const left = Math.min(rect.x, rect.x + rect.width)
  const top = Math.min(rect.y, rect.y + rect.height)
  return (
    screenPoint.x >= left &&
    screenPoint.x <= left + Math.abs(rect.width) &&
    screenPoint.y >= top &&
    screenPoint.y <= top + Math.abs(rect.height)
  )
}
