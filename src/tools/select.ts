import { bboxToScreen, drawBox, drawHandles, hitBox, hitHandle } from '../canvas/draw.ts'
import { normalizeBbox } from '../state/geometry.ts'
import type { HandleId } from '../canvas/draw.ts'
import type { Tool, ToolContext, ToolView } from './types.ts'
import type { BboxGeometry, Point, ReadonlyDocument } from '../state/types.ts'

/**
 * A drag is one of three things, and the union means the move branch can never
 * read a handle id or vice versa.
 */
type Drag =
  | { kind: 'none' }
  | { kind: 'move'; id: string; grabbedAt: Point; original: BboxGeometry }
  | { kind: 'resize'; id: string; handle: HandleId; original: BboxGeometry }

export interface SelectDeps {
  select(id: string | null): void
  updateGeometry(id: string, geometry: BboxGeometry): void
  labelColor(labelId: string): string
}

export function createSelectTool(deps: SelectDeps): Tool {
  let drag: Drag = { kind: 'none' }
  // The geometry being dragged, kept out of the store until pointer-up so that
  // a whole drag collapses into a single undo entry.
  let live: BboxGeometry | null = null

  function findBbox(document: ReadonlyDocument, id: string): BboxGeometry | null {
    const annotation = document.annotations.find((a) => a.id === id)
    if (annotation === undefined || annotation.type !== 'bbox') return null
    return { ...annotation.geometry }
  }

  /** Recomputes a box from the corner opposite the grabbed handle. */
  function resized(original: BboxGeometry, handle: HandleId, pointer: Point): BboxGeometry {
    let left = original.x
    let top = original.y
    let right = original.x + original.width
    let bottom = original.y + original.height

    if (handle === 'nw' || handle === 'sw') left = pointer.x
    if (handle === 'ne' || handle === 'se') right = pointer.x
    if (handle === 'nw' || handle === 'ne') top = pointer.y
    if (handle === 'sw' || handle === 'se') bottom = pointer.y

    // Dragging a handle past the opposite edge flips the box; normalize fixes it.
    return normalizeBbox({ x: left, y: top, width: right - left, height: bottom - top })
  }

  return {
    id: 'select',
    cursor: 'default',

    onPointerDown(ctx: ToolContext): void {
      const selectedId = ctx.session.selectedAnnotationId

      // Handles of the current selection are tested first, so a handle sitting
      // on top of another box still resizes rather than selecting through it.
      if (selectedId !== null) {
        const geometry = findBbox(ctx.document, selectedId)
        if (geometry !== null) {
          const handle = hitHandle(bboxToScreen(geometry, ctx.viewport), ctx.screen)
          if (handle !== null) {
            drag = { kind: 'resize', id: selectedId, handle, original: geometry }
            live = geometry
            return
          }
        }
      }

      // Topmost first: later annotations draw on top, so they win a click.
      for (let i = ctx.document.annotations.length - 1; i >= 0; i -= 1) {
        const annotation = ctx.document.annotations[i]
        if (annotation.type !== 'bbox') continue
        const geometry = { ...annotation.geometry }
        if (!hitBox(bboxToScreen(geometry, ctx.viewport), ctx.screen)) continue
        deps.select(annotation.id)
        drag = { kind: 'move', id: annotation.id, grabbedAt: ctx.image, original: geometry }
        live = geometry
        return
      }

      deps.select(null)
      drag = { kind: 'none' }
      live = null
    },

    onPointerMove(ctx: ToolContext): void {
      if (drag.kind === 'move') {
        // Both endpoints came through screenToImage, so the delta is exact.
        live = normalizeBbox({
          x: drag.original.x + (ctx.image.x - drag.grabbedAt.x),
          y: drag.original.y + (ctx.image.y - drag.grabbedAt.y),
          width: drag.original.width,
          height: drag.original.height,
        })
      } else if (drag.kind === 'resize') {
        live = resized(drag.original, drag.handle, ctx.image)
      }
    },

    onPointerUp(): void {
      // One action for the whole gesture — this is the one-drag-one-undo rule.
      if (drag.kind !== 'none' && live !== null) {
        const changed = JSON.stringify(live) !== JSON.stringify(drag.original)
        if (changed) deps.updateGeometry(drag.id, live)
      }
      drag = { kind: 'none' }
      live = null
    },

    drawOverlay(ctx: CanvasRenderingContext2D, view: ToolView): void {
      const selectedId = view.session.selectedAnnotationId
      if (selectedId === null) return

      const annotation = view.document.annotations.find((a) => a.id === selectedId)
      if (annotation === undefined || annotation.type !== 'bbox') return

      // While dragging, the live geometry is authoritative and the annotations
      // layer is suppressing the stored one.
      const geometry = drag.kind !== 'none' && live !== null ? live : { ...annotation.geometry }
      const rect = bboxToScreen(geometry, view.viewport)
      const color = deps.labelColor(annotation.labelId)
      drawBox(ctx, rect, color, { selected: true })
      drawHandles(ctx, rect, color)
    },

    hiddenAnnotationId: () => (drag.kind === 'none' ? null : drag.id),

    cancel(): void {
      drag = { kind: 'none' }
      live = null
    },
  }
}
