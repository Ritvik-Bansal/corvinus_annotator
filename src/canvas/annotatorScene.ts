// What the annotator draws on its two vector layers.
//
// Lifted out of the renderer so the renderer owns only the frame loop, the
// dirty flags and the image layer. The comparison page supplies a different
// Scene against the same loop rather than forking it.

import {
  bboxToScreen,
  drawBox,
  drawLabelChip,
  drawPolygon,
  polygonToScreen,
  screenBounds,
} from './draw.ts'
import { MASK_OPACITY, type Mask } from './mask.ts'
import type { Scene } from './renderer.ts'
import type { Tool } from '../tools/types.ts'
import type { ReadonlyDocument, SessionState, Viewport } from '../state/types.ts'

const FALLBACK_COLOR = '#8b93a1'

export interface AnnotatorSceneDeps {
  getMask(): Mask
  getBitmap(): ImageBitmap | null
  getViewport(): Viewport
  getDocument(): ReadonlyDocument
  getSession(): SessionState
  getActiveTool(): Tool | null
}

export function createAnnotatorScene(deps: AnnotatorSceneDeps): Scene {
  return {
    getBitmap: deps.getBitmap,
    getViewport: deps.getViewport,

    drawAnnotations(ctx: CanvasRenderingContext2D, dpr: number): void {
      const document = deps.getDocument()
      const viewport = deps.getViewport()
      const selectedId = deps.getSession().selectedAnnotationId
      // Suppressed because a tool is drawing a live version of it on the overlay.
      const hidden = deps.getActiveTool()?.hiddenAnnotationId() ?? null

      // The mask goes down first so boxes and polygons read on top of it. It is
      // an image-space bitmap, so it is blitted through the viewport transform
      // exactly like the photo, then the transform is restored to screen space.
      const mask = deps.getMask()
      mask.sync(document)
      if (mask.hasContent()) {
        ctx.save()
        const s = viewport.scale * dpr
        ctx.setTransform(s, 0, 0, s, viewport.offsetX * dpr, viewport.offsetY * dpr)
        ctx.globalAlpha = MASK_OPACITY
        ctx.imageSmoothingEnabled = viewport.scale < 1
        ctx.drawImage(mask.canvas, 0, 0)
        ctx.restore()
      }

      // One chip per painted class, anchored to that class's painted extent.
      const highlighted = deps.getSession().highlightedMaskLabelId
      for (const [labelId, box] of mask.getClassBounds()) {
        const label = document.labels.find((l) => l.id === labelId)
        if (label === undefined) continue
        const rect = bboxToScreen(
          { x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY },
          viewport,
        )
        if (labelId === highlighted) {
          ctx.save()
          ctx.strokeStyle = label.color
          ctx.lineWidth = 1.5
          ctx.setLineDash([6, 4])
          ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
          ctx.restore()
        }
        drawLabelChip(ctx, { x: rect.x, y: rect.y }, label.name, label.color)
      }

      for (const annotation of document.annotations) {
        if (annotation.id === hidden) continue
        const label = document.labels.find((l) => l.id === annotation.labelId)
        const color = label?.color ?? FALLBACK_COLOR
        const name = label?.name ?? 'Unknown'
        const selected = annotation.id === selectedId

        if (annotation.type === 'bbox') {
          const rect = bboxToScreen(annotation.geometry, viewport)
          drawBox(ctx, rect, color, { selected })
          drawLabelChip(
            ctx,
            { x: Math.min(rect.x, rect.x + rect.width), y: Math.min(rect.y, rect.y + rect.height) },
            name,
            color,
          )
        } else {
          const points = polygonToScreen(annotation.geometry, viewport)
          drawPolygon(ctx, points, color, { selected })
          drawLabelChip(ctx, screenBounds(points), name, color)
        }
      }
    },

    drawOverlay(ctx: CanvasRenderingContext2D): void {
      deps.getActiveTool()?.drawOverlay(ctx, {
        viewport: deps.getViewport(),
        document: deps.getDocument(),
        session: deps.getSession(),
      })
    },
  }
}
