// Brush and eraser. One factory, two registry entries — they differ only in
// compositing mode and in whether the stroke owns a class.

import { imageToScreen } from '../canvas/viewport.ts'
import type { Mask } from '../canvas/mask.ts'
import type { Tool, ToolContext, ToolView } from './types.ts'
import type { Point, StrokeMode, ToolId } from '../state/types.ts'

/** Colour of the eraser's cursor ring; the brush uses its class colour. */
const ERASER_RING = '#d8d8dc'

export interface BrushDeps {
  mask: Mask
  addStroke(mode: StrokeMode, labelId: string, radius: number, points: Point[]): string
  labelColor(labelId: string): string
  getActiveLabelId(): string | null
  /** The mask lives on the annotations layer, so live painting must dirty it. */
  markAnnotationsDirty(): void
}

export function createBrushTool(mode: StrokeMode, deps: BrushDeps): Tool {
  // The stroke being drawn. It is NOT in the store until pointer-up, which is
  // what makes one drag one undo entry.
  let points: Point[] = []
  let drawing = false
  /** Cursor position in image space, for the size ring. Null when off-canvas. */
  let cursor: Point | null = null
  /** Colour this stroke started with, so a class change mid-drag cannot split it. */
  let strokeColor = ERASER_RING

  function reset(): void {
    points = []
    drawing = false
  }

  return {
    id: (mode === 'paint' ? 'brush' : 'erase') satisfies ToolId,
    cursor: 'none', // the ring on the overlay IS the cursor

    onPointerDown(ctx: ToolContext): void {
      const labelId = deps.getActiveLabelId()
      if (mode === 'paint' && labelId === null) return

      drawing = true
      points = [ctx.image]
      cursor = ctx.image
      strokeColor = mode === 'paint' && labelId !== null ? deps.labelColor(labelId) : ERASER_RING

      // A click with no drag still leaves a dot.
      deps.mask.drawSegment(mode, strokeColor, ctx.session.brushRadius, ctx.image, ctx.image)
      deps.markAnnotationsDirty()
    },

    onPointerMove(ctx: ToolContext): void {
      cursor = ctx.image
      if (!drawing) return
      const previous = points[points.length - 1]
      points.push(ctx.image)
      // Painted straight onto the mask as the pointer moves, so an erase is seen
      // cutting while you drag rather than only when you let go. Only the new
      // segment is drawn, so cost per frame is constant however long the stroke.
      deps.mask.drawSegment(mode, strokeColor, ctx.session.brushRadius, previous, ctx.image)
      deps.markAnnotationsDirty()
    },

    onPointerUp(ctx: ToolContext): void {
      if (!drawing) return
      const committed = points
      reset()
      if (committed.length === 0) return

      const labelId = deps.getActiveLabelId()
      if (mode === 'paint' && labelId === null) {
        deps.mask.invalidate() // nothing was stored, so undo what was drawn live
        deps.markAnnotationsDirty()
        return
      }

      deps.addStroke(mode, labelId ?? '', ctx.session.brushRadius, committed)
      // Throw away the live pixels and let the next sync replay from the stroke
      // list. The live path draws separate segments and the replay draws one
      // polyline, which differ slightly on antialiased edges — replaying makes
      // the on-screen mask exactly what a re-import of this file would produce.
      // Measured at 0.1-3 ms even with 1000 strokes.
      deps.mask.invalidate()
    },

    commit(): void {},

    cancel(): void {
      if (!drawing) return
      reset()
      // Live pixels were drawn for a stroke that will never be stored.
      deps.mask.invalidate()
      deps.markAnnotationsDirty()
    },

    drawOverlay(ctx: CanvasRenderingContext2D, view: ToolView): void {
      if (cursor === null) return
      const centre = imageToScreen(cursor, view.viewport)
      // The radius goes through imageToScreen too, rather than being multiplied
      // by scale here — the ring is then correct at any zoom by construction.
      const edge = imageToScreen(
        { x: cursor.x + view.session.brushRadius, y: cursor.y },
        view.viewport,
      )
      const screenRadius = Math.max(1, edge.x - centre.x)

      const labelId = view.session.activeLabelId
      const color = mode === 'paint' && labelId !== null ? deps.labelColor(labelId) : ERASER_RING

      ctx.save()
      ctx.beginPath()
      ctx.arc(centre.x, centre.y, screenRadius, 0, Math.PI * 2)
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      if (mode === 'erase') ctx.setLineDash([4, 3])
      ctx.stroke()
      ctx.restore()
    },

    hiddenAnnotationId: () => null,
  }
}
