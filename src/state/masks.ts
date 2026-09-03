// Deriving the per-class view of the stroke list.
//
// Masks are SEMANTIC, not per-instance: three pipette-tip boxes are three
// annotations with their own attributes, but every pixel painted as Microplate
// is one Microplate mask. That is why these derive a row per CLASS rather than
// per stroke, and why masks carry no attributes of their own.

import type { ReadonlyDocument } from './types.ts'

export interface MaskBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * Classes with at least one PAINT stroke, in the order they were first painted.
 *
 * Erase strokes are ignored deliberately. If someone erases every pixel of a
 * class the row stays, because deciding otherwise would mean scanning a 12MP
 * bitmap every time the list renders — not worth it for a cosmetic difference.
 */
export function maskedLabelIds(document: ReadonlyDocument): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const stroke of document.strokes) {
    if (stroke.mode !== 'paint') continue
    if (seen.has(stroke.labelId)) continue
    seen.add(stroke.labelId)
    order.push(stroke.labelId)
  }
  return order
}

/**
 * Image-space extent of each class's paint strokes, brush radius included.
 * Derived from the stroke geometry rather than from mask pixels, for the same
 * reason as above. Used to anchor the class-name chip and the hover highlight.
 */
export function maskBounds(document: ReadonlyDocument): Map<string, MaskBounds> {
  const bounds = new Map<string, MaskBounds>()
  for (const stroke of document.strokes) {
    if (stroke.mode !== 'paint') continue
    let box = bounds.get(stroke.labelId)
    if (box === undefined) {
      box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
      bounds.set(stroke.labelId, box)
    }
    for (const point of stroke.points) {
      box.minX = Math.min(box.minX, point.x - stroke.radius)
      box.minY = Math.min(box.minY, point.y - stroke.radius)
      box.maxX = Math.max(box.maxX, point.x + stroke.radius)
      box.maxY = Math.max(box.maxY, point.y + stroke.radius)
    }
  }
  return bounds
}
