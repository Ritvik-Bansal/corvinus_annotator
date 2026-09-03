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

export function drawHandles(ctx: CanvasRenderingContext2D, rect: ScreenRect, color: string): void {
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  const half = HANDLE_SIZE / 2
  for (const id of HANDLE_IDS) {
    const point = handlePoint(rect, id)
    ctx.fillRect(point.x - half, point.y - half, HANDLE_SIZE, HANDLE_SIZE)
    ctx.strokeRect(point.x - half, point.y - half, HANDLE_SIZE, HANDLE_SIZE)
  }
  ctx.restore()
}

/**
 * Class name in a filled chip above the box. Drawn in screen space like
 * everything else on this layer, so the text stays legible at every zoom
 * instead of scaling with the image.
 */
export function drawBoxLabel(
  ctx: CanvasRenderingContext2D,
  rect: ScreenRect,
  text: string,
  color: string,
): void {
  ctx.save()
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
  ctx.textBaseline = 'middle'

  const paddingX = 5
  const height = 15
  const width = ctx.measureText(text).width + paddingX * 2
  const left = Math.min(rect.x, rect.x + rect.width)
  const top = Math.min(rect.y, rect.y + rect.height)
  // Flip below the top edge when the chip would sit off the top of the canvas.
  const y = top - height - 2 < 0 ? top + 2 : top - height - 2

  ctx.fillStyle = color
  ctx.fillRect(left, y, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillText(text, left + paddingX, y + height / 2)
  ctx.restore()
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
