import type { BboxGeometry } from './types.ts'

/**
 * Dragging up or left produces negative width/height. Every path that writes a
 * bbox runs it through here, so a negative-size box can never reach the store.
 */
export function normalizeBbox(g: BboxGeometry): BboxGeometry {
  return {
    x: g.width < 0 ? g.x + g.width : g.x,
    y: g.height < 0 ? g.y + g.height : g.y,
    width: Math.abs(g.width),
    height: Math.abs(g.height),
  }
}
