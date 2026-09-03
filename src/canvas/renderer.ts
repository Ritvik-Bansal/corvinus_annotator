// The single requestAnimationFrame loop. Nothing else in the app draws.
//
// Contract: everywhere else marks layers dirty and returns immediately. Pointer
// events can fire many times between two frames; coalescing them here means we
// draw at most once per display refresh no matter how noisy the input is.

import { CANVAS_BACKGROUND, type Layers } from './layers.ts'
import type { Viewport } from '../state/types.ts'

export type LayerName = 'image' | 'annotations' | 'overlay'

export interface Renderer {
  markDirty(...layers: LayerName[]): void
  markAllDirty(): void
  /** Smoothed cost of our draw work, in milliseconds. */
  getFrameMs(): number
  /** Starts the loop. `onFrame` runs once per frame, after drawing. */
  start(onFrame: () => void): void
}

export function createRenderer(
  layers: Layers,
  getBitmap: () => ImageBitmap | null,
  getViewport: () => Viewport,
): Renderer {
  const dirty: Record<LayerName, boolean> = { image: true, annotations: true, overlay: true }
  let frameMs = 0
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
    const viewport = getViewport()

    // Reset to device pixels to paint the background. The layer is opaque, so
    // this fill (not clearRect) is what defines the empty area.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = CANVAS_BACKGROUND
    ctx.fillRect(0, 0, width * dpr, height * dpr)

    const bitmap = getBitmap()
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

  function clearLayer(ctx: CanvasRenderingContext2D): void {
    const dpr = layers.getDpr()
    const { width, height } = layers.getSize()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, width * dpr, height * dpr)
  }

  function frame(onFrame: () => void): void {
    // A resize changes every backing store, so everything must be repainted.
    if (layers.sync()) markAllDirty()

    const drawStart = performance.now()
    let drew = false

    if (dirty.image) {
      drawImageLayer()
      dirty.image = false
      drew = true
    }
    // These two are intentionally empty this phase. The plumbing is exercised
    // so that adding tools later is a draw call, not a refactor.
    if (dirty.annotations) {
      clearLayer(layers.ctx.annotations)
      dirty.annotations = false
      drew = true
    }
    if (dirty.overlay) {
      clearLayer(layers.ctx.overlay)
      dirty.overlay = false
      drew = true
    }

    if (drew) {
      const elapsed = performance.now() - drawStart
      // Exponential moving average, so the readout is legible instead of jittery.
      frameMs = frameMs === 0 ? elapsed : frameMs * 0.85 + elapsed * 0.15
    }

    onFrame()
    requestAnimationFrame(() => frame(onFrame))
  }

  return {
    markDirty,
    markAllDirty,
    getFrameMs: () => frameMs,
    start(onFrame: () => void): void {
      if (started) return
      started = true
      requestAnimationFrame(() => frame(onFrame))
    },
  }
}
