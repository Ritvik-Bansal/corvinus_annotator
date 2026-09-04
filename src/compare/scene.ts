// What the comparison page draws. Supplied to the SAME renderer the annotator
// uses, so the frame loop, dirty flags, DPR handling and image layer are shared
// rather than forked.
//
// Treatment is by AGREEMENT STATUS, not by class: colour says matched / A-only /
// B-only, and line style says which file a box came from. That is the question
// this page exists to answer.

import { bboxToScreen, drawBox } from '../canvas/draw.ts'
import type { Scene } from '../canvas/renderer.ts'
import type { MatchResult, Pair } from './agreement.ts'
import type { BboxGeometry, Viewport } from '../state/types.ts'

export const STATUS_COLORS = {
  matched: '#00c020',
  onlyA: '#ff8c00',
  onlyB: '#c060ff',
} as const

export interface CompareSceneDeps {
  getBitmap(): ImageBitmap | null
  getViewport(): Viewport
  getResult(): MatchResult | null
  /** Pair selected in the list, drawn emphasised on the overlay. */
  getSelectedPairId(): string | null
}

/** A pair is identified by both ids, since neither alone is unique across files. */
export function pairId(pair: Pair): string {
  return `${pair.a.id}::${pair.b.id}`
}

export function createCompareScene(deps: CompareSceneDeps): Scene {
  function stroke(
    ctx: CanvasRenderingContext2D,
    geometry: BboxGeometry,
    viewport: Viewport,
    color: string,
    dashed: boolean,
    emphasis = false,
  ): void {
    drawBox(ctx, bboxToScreen(geometry, viewport), color, {
      dashed,
      selected: emphasis,
    })
  }

  return {
    getBitmap: deps.getBitmap,
    getViewport: deps.getViewport,

    drawAnnotations(ctx: CanvasRenderingContext2D): void {
      const result = deps.getResult()
      if (result === null) return
      const viewport = deps.getViewport()

      // Both halves of a matched pair are drawn, because seeing the offset
      // between them is the whole point — collapsing them to one box would
      // hide the disagreement being measured.
      for (const pair of result.matched) {
        stroke(ctx, pair.a.geometry, viewport, STATUS_COLORS.matched, false)
        stroke(ctx, pair.b.geometry, viewport, STATUS_COLORS.matched, true)
      }
      for (const boxRef of result.onlyA) {
        stroke(ctx, boxRef.geometry, viewport, STATUS_COLORS.onlyA, false)
      }
      for (const boxRef of result.onlyB) {
        stroke(ctx, boxRef.geometry, viewport, STATUS_COLORS.onlyB, true)
      }
    },

    drawOverlay(ctx: CanvasRenderingContext2D): void {
      const result = deps.getResult()
      const selected = deps.getSelectedPairId()
      if (result === null || selected === null) return
      const pair = result.matched.find((p) => pairId(p) === selected)
      if (pair === undefined) return

      const viewport = deps.getViewport()
      stroke(ctx, pair.a.geometry, viewport, STATUS_COLORS.matched, false, true)
      stroke(ctx, pair.b.geometry, viewport, STATUS_COLORS.matched, true, true)

      // A line between the two centres, so a small offset is visible even when
      // the boxes nearly coincide.
      const a = bboxToScreen(pair.a.geometry, viewport)
      const b = bboxToScreen(pair.b.geometry, viewport)
      ctx.save()
      ctx.strokeStyle = STATUS_COLORS.matched
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(a.x + a.width / 2, a.y + a.height / 2)
      ctx.lineTo(b.x + b.width / 2, b.y + b.height / 2)
      ctx.stroke()
      ctx.restore()
    },
  }
}
