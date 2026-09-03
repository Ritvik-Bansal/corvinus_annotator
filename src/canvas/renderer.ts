// The single requestAnimationFrame loop. Nothing else in the app draws.
//
// Contract: everywhere else marks layers dirty and returns immediately. Pointer
// events can fire many times between two frames; coalescing them here means we
// draw at most once per display refresh no matter how noisy the input is.

import { CANVAS_BACKGROUND, type Layers } from './layers.ts'
import { bboxToScreen, drawBox } from './draw.ts'
import type { Tool } from '../tools/types.ts'
import type { ReadonlyDocument, SessionState, Viewport } from '../state/types.ts'

/** Everything the renderer needs to read. It pulls; nothing pushes to it. */
export interface Scene {
  getBitmap(): ImageBitmap | null
  getViewport(): Viewport
  getDocument(): ReadonlyDocument
  getSession(): SessionState
  getActiveTool(): Tool | null
}

const FALLBACK_COLOR = '#8b93a1'

export type LayerName = 'image' | 'annotations' | 'overlay'

/** Samples kept for each rolling median. ~1 second at 60Hz. */
const TIMING_WINDOW = 60

export interface Renderer {
  markDirty(...layers: LayerName[]): void
  markAllDirty(): void
  /**
   * Rolling median interval between consecutive animation frames, in ms.
   * This is the real end-to-end frame cost: it includes GPU compositing and
   * anything else on the main thread, and it is what "smooth" actually means.
   * ~16.7 on a healthy 60Hz display.
   */
  getFrameIntervalMs(): number
  /**
   * Rolling median time our own draw code spends issuing commands, in ms.
   * This EXCLUDES GPU work, so it is always far smaller than the frame
   * interval. It answers "how much of the frame budget is ours", not "how
   * fast are we".
   */
  getDrawMs(): number
  /** Starts the loop. `onFrame` runs once per frame, after drawing. */
  start(onFrame: () => void): void
}

/** Median is used instead of a mean so one stalled frame cannot skew the readout. */
function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function pushSample(samples: number[], value: number): void {
  samples.push(value)
  if (samples.length > TIMING_WINDOW) samples.shift()
}

export function createRenderer(layers: Layers, scene: Scene): Renderer {
  const dirty: Record<LayerName, boolean> = { image: true, annotations: true, overlay: true }
  const frameIntervals: number[] = []
  const drawTimes: number[] = []
  let lastTimestamp = 0
  let started = false

  function markDirty(...names: LayerName[]): void {
    for (const name of names) dirty[name] = true
  }

  function markAllDirty(): void {
    markDirty('image', 'annotations', 'overlay')
  }

  function drawImageLayer(): void {
    const ctx = layers.ctx.image
    const dpr = layers.getDpr()
    const { width, height } = layers.getSize()
    const viewport = scene.getViewport()

    // Reset to device pixels to paint the background. The layer is opaque, so
    // this fill (not clearRect) is what defines the empty area.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = CANVAS_BACKGROUND
    ctx.fillRect(0, 0, width * dpr, height * dpr)

    const bitmap = scene.getBitmap()
    if (bitmap === null) return

    // The viewport transform, with dpr folded in only here. Stored coordinates
    // stay in image pixel space and never learn about the display density.
    const s = viewport.scale * dpr
    ctx.setTransform(s, 0, 0, s, viewport.offsetX * dpr, viewport.offsetY * dpr)

    // Past 1:1 show real pixels rather than a blur — this is an annotation tool,
    // and the pixel boundary is what the user is aiming at.
    ctx.imageSmoothingEnabled = viewport.scale < 1
    ctx.drawImage(bitmap, 0, 0)
  }

  /**
   * Prepares a vector layer: clears it, then leaves the transform as a plain
   * dpr scale so callers draw in CSS pixels. Positions come from imageToScreen,
   * which is why nothing here compensates for zoom.
   */
  function prepareVectorLayer(ctx: CanvasRenderingContext2D): void {
    const dpr = layers.getDpr()
    const { width, height } = layers.getSize()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, width * dpr, height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  function labelColor(document: ReadonlyDocument, labelId: string): string {
    return document.labels.find((l) => l.id === labelId)?.color ?? FALLBACK_COLOR
  }

  function drawAnnotationsLayer(): void {
    const ctx = layers.ctx.annotations
    prepareVectorLayer(ctx)

    const document = scene.getDocument()
    const viewport = scene.getViewport()
    const selectedId = scene.getSession().selectedAnnotationId
    // Suppressed because a tool is drawing a live version of it on the overlay.
    const hidden = scene.getActiveTool()?.hiddenAnnotationId() ?? null

    for (const annotation of document.annotations) {
      if (annotation.id === hidden) continue
      if (annotation.type !== 'bbox') continue // polygon lands in a later phase
      drawBox(
        ctx,
        bboxToScreen(annotation.geometry, viewport),
        labelColor(document, annotation.labelId),
        { selected: annotation.id === selectedId },
      )
    }
  }

  function drawOverlayLayer(): void {
    const ctx = layers.ctx.overlay
    prepareVectorLayer(ctx)
    scene.getActiveTool()?.drawOverlay(ctx, {
      viewport: scene.getViewport(),
      document: scene.getDocument(),
      session: scene.getSession(),
    })
  }

  function frame(timestamp: number, onFrame: () => void): void {
    // The interval between consecutive rAF callbacks. The browser hands us the
    // frame timestamp, so this is measured, not estimated.
    if (lastTimestamp !== 0) pushSample(frameIntervals, timestamp - lastTimestamp)
    lastTimestamp = timestamp

    // A resize changes every backing store, so everything must be repainted.
    if (layers.sync()) markAllDirty()

    const drawStart = performance.now()
    let drew = false

    if (dirty.image) {
      drawImageLayer()
      dirty.image = false
      drew = true
    }
    if (dirty.annotations) {
      drawAnnotationsLayer()
      dirty.annotations = false
      drew = true
    }
    if (dirty.overlay) {
      drawOverlayLayer()
      dirty.overlay = false
      drew = true
    }

    if (drew) pushSample(drawTimes, performance.now() - drawStart)

    onFrame()
    requestAnimationFrame((next) => frame(next, onFrame))
  }

  return {
    markDirty,
    markAllDirty,
    getFrameIntervalMs: () => median(frameIntervals),
    getDrawMs: () => median(drawTimes),
    start(onFrame: () => void): void {
      if (started) return
      started = true
      requestAnimationFrame((timestamp) => frame(timestamp, onFrame))
    },
  }
}
