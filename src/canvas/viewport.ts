// The ONLY place coordinate math happens.
//
// Model: screen = image * scale + offset
//   - `scale` is CSS pixels per image pixel.
//   - `offsetX/offsetY` are CSS pixels: where image pixel (0,0) sits on screen.
//   - devicePixelRatio is deliberately NOT part of this. It is a rendering
//     detail applied at draw time, so it can never leak into stored geometry.
//
// Every function here is pure: same inputs, same output, no DOM, no store.
// That is what makes it unit-testable without a browser.

import type { Point, Viewport } from '../state/types.ts'

export const MIN_SCALE = 0.02
export const MAX_SCALE = 64

/** CSS pixels of breathing room left around a fitted image. */
const FIT_PADDING = 24

export interface Size {
  width: number
  height: number
}

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

export function imageToScreen(point: Point, viewport: Viewport): Point {
  return {
    x: point.x * viewport.scale + viewport.offsetX,
    y: point.y * viewport.scale + viewport.offsetY,
  }
}

/** Exact inverse of imageToScreen. */
export function screenToImage(point: Point, viewport: Viewport): Point {
  return {
    x: (point.x - viewport.offsetX) / viewport.scale,
    y: (point.y - viewport.offsetY) / viewport.scale,
  }
}

/** Translate by a screen-space delta. Scale is untouched, so this is a pure shift. */
export function panBy(viewport: Viewport, dxScreen: number, dyScreen: number): Viewport {
  return {
    scale: viewport.scale,
    offsetX: viewport.offsetX + dxScreen,
    offsetY: viewport.offsetY + dyScreen,
  }
}

/**
 * Zoom by `factor` while keeping whatever image pixel is under `screenPoint`
 * pinned to that same screen position.
 *
 * Solve imageToScreen(anchor, next) === screenPoint for the new offset:
 *   anchor * newScale + newOffset = screenPoint
 *   newOffset = screenPoint - anchor * newScale
 */
export function zoomAt(viewport: Viewport, screenPoint: Point, factor: number): Viewport {
  const anchor = screenToImage(screenPoint, viewport)
  const scale = clampScale(viewport.scale * factor)
  return {
    scale,
    offsetX: screenPoint.x - anchor.x * scale,
    offsetY: screenPoint.y - anchor.y * scale,
  }
}

/** Scale the image down to fit, then centre it. Never scales a small image up past 1:1. */
export function fitToViewport(image: Size, viewportSize: Size): Viewport {
  const available = {
    width: Math.max(1, viewportSize.width - FIT_PADDING * 2),
    height: Math.max(1, viewportSize.height - FIT_PADDING * 2),
  }
  const scale = clampScale(
    Math.min(1, Math.min(available.width / image.width, available.height / image.height)),
  )
  return {
    scale,
    offsetX: (viewportSize.width - image.width * scale) / 2,
    offsetY: (viewportSize.height - image.height * scale) / 2,
  }
}
