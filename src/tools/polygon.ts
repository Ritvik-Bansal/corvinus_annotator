import {
  HANDLE_HIT_RADIUS,
  drawPointHandles,
  drawPolygon,
  polygonToScreen,
} from '../canvas/draw.ts'
import { imageToScreen } from '../canvas/viewport.ts'
import type { Tool, ToolContext, ToolView } from './types.ts'
import type { Point, PolygonGeometry } from '../state/types.ts'

/** Fewer than three vertices is not a shape. */
const MIN_VERTICES = 3

export interface PolygonDeps {
  addAnnotation(labelId: string, geometry: PolygonGeometry): string
  select(id: string): void
  labelColor(labelId: string): string
  getActiveLabelId(): string | null
}

export function createPolygonTool(deps: PolygonDeps): Tool {
  // Vertices live here in IMAGE space until the shape closes, so an abandoned
  // polygon never reaches the store and a finished one is a single undo entry.
  let vertices: Point[] = []
  let cursor: Point | null = null
  /** Set while the pointer is over the first vertex, so the UI can show it. */
  let overFirst = false

  function close(): void {
    if (vertices.length < MIN_VERTICES) return
    const labelId = deps.getActiveLabelId()
    if (labelId === null) return
    const geometry: PolygonGeometry = { points: [...vertices] }
    vertices = []
    cursor = null
    overFirst = false
    deps.select(deps.addAnnotation(labelId, geometry))
  }

  function nearFirstVertex(ctx: ToolContext): boolean {
    if (vertices.length < MIN_VERTICES) return false
    const first = imageToScreen(vertices[0], ctx.viewport)
    return (
      Math.abs(ctx.screen.x - first.x) <= HANDLE_HIT_RADIUS &&
      Math.abs(ctx.screen.y - first.y) <= HANDLE_HIT_RADIUS
    )
  }

  return {
    id: 'polygon',
    cursor: 'crosshair',

    onPointerDown(ctx: ToolContext): void {
      // Clicking the first vertex closes the shape, same as pressing Enter.
      if (nearFirstVertex(ctx)) {
        close()
        return
      }
      vertices.push(ctx.image)
      cursor = ctx.image
    },

    onPointerMove(ctx: ToolContext): void {
      // Fires with no button held, which is what lets the rubber-band segment
      // follow the cursor between clicks.
      cursor = ctx.image
      overFirst = nearFirstVertex(ctx)
    },

    onPointerUp(): void {},

    /** Enter. */
    commit(): void {
      close()
    },

    drawOverlay(ctx: CanvasRenderingContext2D, view: ToolView): void {
      if (vertices.length === 0) return
      const color = deps.labelColor(view.session.activeLabelId ?? '')
      const screenPoints = polygonToScreen({ points: vertices }, view.viewport)

      // The rubber-band segment is part of the same open polyline, so there is
      // no separate line-drawing path to keep in sync.
      const path =
        cursor === null ? screenPoints : [...screenPoints, imageToScreen(cursor, view.viewport)]
      drawPolygon(ctx, path, color, { open: true, dashed: true })
      // Emphasising vertex 0 while hovering is what makes "click the first
      // vertex to close" discoverable at all.
      drawPointHandles(ctx, screenPoints, color, overFirst ? 0 : -1)
    },

    hiddenAnnotationId: () => null,

    cancel(): void {
      vertices = []
      cursor = null
      overFirst = false
    },
  }
}
