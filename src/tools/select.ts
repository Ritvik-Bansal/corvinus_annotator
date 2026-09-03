import {
  bboxToScreen,
  drawBox,
  drawPointHandles,
  drawPolygon,
  hitBox,
  hitHandle,
  hitPolygon,
  hitVertex,
  polygonToScreen,
  rectHandlePoints,
} from '../canvas/draw.ts'
import { normalizeBbox } from '../state/geometry.ts'
import type { HandleId } from '../canvas/draw.ts'
import type { Tool, ToolContext, ToolView } from './types.ts'
import type { BboxGeometry, Point, PolygonGeometry, ReadonlyDocument } from '../state/types.ts'

/**
 * Every kind of drag this tool supports. The union means the vertex branch can
 * never read a corner handle, and the box branch can never read a vertex index.
 */
type Drag =
  | { kind: 'none' }
  | { kind: 'move-bbox'; id: string; grabbedAt: Point; original: BboxGeometry }
  | { kind: 'resize-bbox'; id: string; handle: HandleId; original: BboxGeometry }
  | { kind: 'move-polygon'; id: string; grabbedAt: Point; original: PolygonGeometry }
  | { kind: 'move-vertex'; id: string; index: number; original: PolygonGeometry }

type Geometry = BboxGeometry | PolygonGeometry

export interface SelectDeps {
  select(id: string | null): void
  updateGeometry(id: string, geometry: Geometry): void
  labelColor(labelId: string): string
}

export function createSelectTool(deps: SelectDeps): Tool {
  let drag: Drag = { kind: 'none' }
  // The geometry being dragged, kept out of the store until pointer-up so that
  // a whole drag collapses into a single undo entry.
  let live: Geometry | null = null

  function findGeometry(document: ReadonlyDocument, id: string): Geometry | null {
    const annotation = document.annotations.find((a) => a.id === id)
    if (annotation === undefined) return null
    return annotation.type === 'bbox'
      ? { ...annotation.geometry }
      : { points: annotation.geometry.points.map((p) => ({ ...p })) }
  }

  function isBbox(geometry: Geometry): geometry is BboxGeometry {
    return 'width' in geometry
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
      // on top of another shape still resizes rather than selecting through it.
      if (selectedId !== null) {
        const geometry = findGeometry(ctx.document, selectedId)
        if (geometry !== null && isBbox(geometry)) {
          const handle = hitHandle(bboxToScreen(geometry, ctx.viewport), ctx.screen)
          if (handle !== null) {
            drag = { kind: 'resize-bbox', id: selectedId, handle, original: geometry }
            live = geometry
            return
          }
        } else if (geometry !== null) {
          const index = hitVertex(polygonToScreen(geometry, ctx.viewport), ctx.screen)
          if (index !== null) {
            drag = { kind: 'move-vertex', id: selectedId, index, original: geometry }
            live = geometry
            return
          }
        }
      }

      // Topmost first: later annotations draw on top, so they win a click.
      for (let i = ctx.document.annotations.length - 1; i >= 0; i -= 1) {
        const annotation = ctx.document.annotations[i]

        if (annotation.type === 'bbox') {
          const geometry: BboxGeometry = { ...annotation.geometry }
          if (!hitBox(bboxToScreen(geometry, ctx.viewport), ctx.screen)) continue
          deps.select(annotation.id)
          drag = { kind: 'move-bbox', id: annotation.id, grabbedAt: ctx.image, original: geometry }
          live = geometry
          return
        }

        const geometry: PolygonGeometry = {
          points: annotation.geometry.points.map((p) => ({ ...p })),
        }
        // The real outline, not its bounding box: the hollow of a concave shape
        // is genuinely outside it and must not select.
        if (!hitPolygon(polygonToScreen(geometry, ctx.viewport), ctx.screen)) continue
        deps.select(annotation.id)
        drag = { kind: 'move-polygon', id: annotation.id, grabbedAt: ctx.image, original: geometry }
        live = geometry
        return
      }

      deps.select(null)
      drag = { kind: 'none' }
      live = null
    },

    onPointerMove(ctx: ToolContext): void {
      if (drag.kind === 'move-bbox') {
        // Both endpoints came through screenToImage, so the delta is exact.
        live = normalizeBbox({
          x: drag.original.x + (ctx.image.x - drag.grabbedAt.x),
          y: drag.original.y + (ctx.image.y - drag.grabbedAt.y),
          width: drag.original.width,
          height: drag.original.height,
        })
      } else if (drag.kind === 'resize-bbox') {
        live = resized(drag.original, drag.handle, ctx.image)
      } else if (drag.kind === 'move-polygon') {
        const dx = ctx.image.x - drag.grabbedAt.x
        const dy = ctx.image.y - drag.grabbedAt.y
        live = { points: drag.original.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
      } else if (drag.kind === 'move-vertex') {
        // Captured out of `drag` first: inside the callback TypeScript can no
        // longer prove the narrowing holds, because `drag` is a mutable let.
        const { index, original } = drag
        live = { points: original.points.map((p, i) => (i === index ? ctx.image : { ...p })) }
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

    commit(): void {}, // nothing multi-step to finish

    drawOverlay(ctx: CanvasRenderingContext2D, view: ToolView): void {
      const selectedId = view.session.selectedAnnotationId
      if (selectedId === null) return

      const annotation = view.document.annotations.find((a) => a.id === selectedId)
      if (annotation === undefined) return

      // While dragging, the live geometry is authoritative and the annotations
      // layer is suppressing the stored one.
      const stored = findGeometry(view.document, selectedId)
      if (stored === null) return
      const geometry = drag.kind !== 'none' && live !== null ? live : stored
      const color = deps.labelColor(annotation.labelId)

      if (isBbox(geometry)) {
        const rect = bboxToScreen(geometry, view.viewport)
        drawBox(ctx, rect, color, { selected: true })
        drawPointHandles(ctx, rectHandlePoints(rect), color)
        return
      }
      const points = polygonToScreen(geometry, view.viewport)
      drawPolygon(ctx, points, color, { selected: true })
      drawPointHandles(ctx, points, color)
    },

    hiddenAnnotationId: () => (drag.kind === 'none' ? null : drag.id),

    cancel(): void {
      drag = { kind: 'none' }
      live = null
    },
  }
}
