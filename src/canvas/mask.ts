// The brush mask: ONE offscreen canvas, image-sized, holding every class.
//
// MEMORY: exactly one image-sized RGBA buffer exists. At 12MP that is
// 4032 * 3024 * 4 = 48.8 MB. Deliberately NOT one canvas per class, which would
// be 48.8 MB x N. The cost is that a pixel belongs to one class at a time —
// painting class B over class A replaces those pixels — which is the same
// property that lets a single destination-out erase cut every class at once.
//
// STROKES ARE THE TRUTH. This canvas is a cache, never a source. It is produced
// by replaying document.strokes in order, and can always be thrown away and
// rebuilt. Nothing is ever read back out of it.
//
// COST CONTROL. Never replayed per frame — only when the stroke list actually
// changes. An append draws just the new stroke. A full replay is measured at
// 0.1-3 ms even for 1000 strokes, well inside one frame, which is why finishing
// a stroke can afford to replay rather than keep its live pixels (see below).
//
// EXACTNESS. Live segments drawn during a drag are N round-capped segments,
// whereas a replay draws one round-joined polyline. Those differ by a hair of
// alpha on antialiased edges. So on commit the live pixels are thrown away and
// replayed, which makes what you see while painting identical to what you get
// after an export/import round trip.

import type { ReadonlyDocument } from '../state/types.ts'

/** How strongly the mask reads over the photo. */
export const MASK_OPACITY = 0.5

const FALLBACK_COLOR = '#8b93a1'

type ReadonlyStroke = ReadonlyDocument['strokes'][number]

export interface Mask {
  /** Draw this with the viewport transform, exactly like the source image. */
  readonly canvas: HTMLCanvasElement
  /** Resize and clear. Called when a different image is opened. */
  setImageSize(width: number, height: number): void
  /** Bring the mask in line with the stroke list. Cheap when nothing changed. */
  sync(document: ReadonlyDocument): void
  /**
   * Draw one segment of a stroke that is still in progress, straight onto the
   * mask. This is what makes an erase visibly cut as you drag it rather than
   * only on release, and it costs no extra memory because there is no separate
   * preview buffer.
   */
  drawSegment(
    mode: 'paint' | 'erase',
    color: string,
    radius: number,
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): void
  /** Clears the cache; the next sync replays every stroke from scratch. */
  invalidate(): void
  hasContent(): boolean
}

export function createMask(): Mask {
  const canvas = document.createElement('canvas')
  // No willReadFrequently: we never read pixels back, so the GPU-backed
  // default is the faster choice.
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('2D canvas context is unavailable for the mask')
  // Re-bound non-nullable: the helpers below are hoisted, so TypeScript will not
  // carry the narrowing from the check above into them.
  const ctx: CanvasRenderingContext2D = context

  /** Ids currently drawn on the canvas, in order. The cache key. */
  let renderedIds: string[] = []
  let width = 0
  let height = 0

  function setImageSize(nextWidth: number, nextHeight: number): void {
    if (nextWidth === width && nextHeight === height) return
    width = nextWidth
    height = nextHeight
    // Assigning width/height also clears the canvas.
    canvas.width = Math.max(1, nextWidth)
    canvas.height = Math.max(1, nextHeight)
    renderedIds = []
  }

  function begin(mode: 'paint' | 'erase', color: string, radius: number): void {
    // destination-out removes coverage wherever the path is drawn, regardless of
    // what class put it there. That single line is the whole global-eraser rule.
    ctx.globalCompositeOperation = mode === 'erase' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = radius * 2
    // Round caps and joins ARE the interpolation between pointer samples: a fast
    // drag that reports two far-apart points still produces a continuous band.
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }

  function drawStroke(stroke: ReadonlyStroke, color: string): void {
    if (stroke.points.length === 0) return
    ctx.save()
    begin(stroke.mode, color, stroke.radius)
    if (stroke.points.length === 1) {
      // A click rather than a drag: a lone dot has no segment to stroke.
      const point = stroke.points[0]
      ctx.beginPath()
      ctx.arc(point.x, point.y, stroke.radius, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
      for (let i = 1; i < stroke.points.length; i += 1) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
      }
      ctx.stroke()
    }
    ctx.restore()
  }

  function colorFor(document: ReadonlyDocument, stroke: ReadonlyStroke): string {
    if (stroke.mode === 'erase') return FALLBACK_COLOR // unused by destination-out
    return document.labels.find((l) => l.id === stroke.labelId)?.color ?? FALLBACK_COLOR
  }

  return {
    canvas,
    setImageSize,

    sync(document: ReadonlyDocument): void {
      const strokes = document.strokes
      const drawn = renderedIds.length

      // Fast path, taken on every pan and zoom frame: same length and same end
      // ids means nothing changed. Our actions only append, filter, or replace
      // wholesale, so a change can never leave both length and endpoints intact.
      if (
        strokes.length === drawn &&
        (drawn === 0 ||
          (strokes[0].id === renderedIds[0] && strokes[drawn - 1].id === renderedIds[drawn - 1]))
      ) {
        return
      }

      // `drawn > 0` matters: with an empty cache there is nothing to append to,
      // and skipping the clear would composite the replay on top of whatever
      // live segments are still on the canvas.
      const isAppend =
        drawn > 0 && strokes.length > drawn && renderedIds.every((id, i) => strokes[i]?.id === id)

      if (!isAppend) {
        ctx.save()
        ctx.globalCompositeOperation = 'source-over'
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.restore()
        renderedIds = []
      }

      for (let i = renderedIds.length; i < strokes.length; i += 1) {
        drawStroke(strokes[i], colorFor(document, strokes[i]))
        renderedIds.push(strokes[i].id)
      }
    },

    drawSegment(mode, color, radius, from, to): void {
      ctx.save()
      begin(mode, color, radius)
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
      ctx.restore()
    },

    invalidate(): void {
      renderedIds = []
      ctx.save()
      ctx.globalCompositeOperation = 'source-over'
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.restore()
    },

    hasContent: () => renderedIds.length > 0,
  }
}
