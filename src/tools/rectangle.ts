import { bboxToScreen, drawBox } from '../canvas/draw.ts'
import { normalizeBbox } from '../state/geometry.ts'
import type { Tool, ToolContext, ToolView } from './types.ts'
import type { BboxGeometry, Point } from '../state/types.ts'

/** A drag shorter than this in CSS pixels is treated as a stray click. */
const MIN_DRAG_PX = 3

export interface RectangleDeps {
  addAnnotation(labelId: string, geometry: BboxGeometry): string
  select(id: string): void
  labelColor(labelId: string): string
}

export function createRectangleTool(deps: RectangleDeps): Tool {
  // The in-progress box lives here, NOT in the store. It only becomes an
  // annotation on pointer-up, which is what makes one drag one undo entry.
  let start: Point | null = null
  let current: Point | null = null

  function geometry(): BboxGeometry | null {
    if (start === null || current === null) return null
    return normalizeBbox({
      x: start.x,
      y: start.y,
      width: current.x - start.x,
      height: current.y - start.y,
    })
  }

  return {
    id: 'bbox',
    cursor: 'crosshair',

    onPointerDown(ctx: ToolContext): void {
      start = ctx.image
      current = ctx.image
    },

    onPointerMove(ctx: ToolContext): void {
      if (start === null) return
      current = ctx.image
    },

    onPointerUp(ctx: ToolContext): void {
      const box = geometry()
      start = null
      current = null
      if (box === null) return

      // Threshold in screen space so it means the same thing at every zoom.
      const onScreen = bboxToScreen(box, ctx.viewport)
      if (Math.abs(onScreen.width) < MIN_DRAG_PX || Math.abs(onScreen.height) < MIN_DRAG_PX) return

      const labelId = ctx.session.activeLabelId
      if (labelId === null) return
      deps.select(deps.addAnnotation(labelId, box))
    },

    commit(): void {}, // nothing multi-step to finish

    drawOverlay(ctx: CanvasRenderingContext2D, view: ToolView): void {
      const box = geometry()
      if (box === null) return
      const labelId = view.session.activeLabelId
      drawBox(ctx, bboxToScreen(box, view.viewport), deps.labelColor(labelId ?? ''), {
        dashed: true,
      })
    },

    hiddenAnnotationId: () => null,

    cancel(): void {
      start = null
      current = null
    },
  }
}
