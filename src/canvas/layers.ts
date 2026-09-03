// Three stacked canvases sharing one coordinate space.
//
// Why three instead of one: each can be invalidated independently. Drawing a
// shape in progress repaints only the overlay, leaving the 12MP image bitmap
// and the committed annotations untouched. This phase only draws the image
// layer; the other two exist and stay empty.

/** Retina is worth it; 3x phone displays are not worth 2.25x the pixels. */
export const MAX_DPR = 2

/** Must match --canvas-bg in style.css. The image layer is opaque (see below). */
export const CANVAS_BACKGROUND = '#14161a'

export interface LayerContexts {
  image: CanvasRenderingContext2D
  annotations: CanvasRenderingContext2D
  overlay: CanvasRenderingContext2D
}

export interface Layers {
  ctx: LayerContexts
  /** CSS pixel size of the canvas area. */
  getSize(): { width: number; height: number }
  getDpr(): number
  /** Resizes backing stores if needed. Returns true when anything changed. */
  sync(): boolean
}

export function createLayers(
  container: HTMLElement,
  canvases: { image: HTMLCanvasElement; annotations: HTMLCanvasElement; overlay: HTMLCanvasElement },
): Layers {
  // alpha:false on the bottom layer lets the compositor skip per-pixel blending
  // for the largest draw in the app. The upper two must stay transparent.
  const ctx: LayerContexts = {
    image: get2d(canvases.image, { alpha: false }),
    annotations: get2d(canvases.annotations),
    overlay: get2d(canvases.overlay),
  }

  let width = 0
  let height = 0
  let dpr = 1

  function sync(): boolean {
    const rect = container.getBoundingClientRect()
    const nextWidth = Math.max(1, Math.round(rect.width))
    const nextHeight = Math.max(1, Math.round(rect.height))
    const nextDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)

    if (nextWidth === width && nextHeight === height && nextDpr === dpr) return false

    width = nextWidth
    height = nextHeight
    dpr = nextDpr

    for (const canvas of [canvases.image, canvases.annotations, canvases.overlay]) {
      // Backing store in device pixels, CSS box in layout pixels.
      // Assigning .width also resets the context state, which is fine because
      // every draw calls setTransform first.
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
    }
    return true
  }

  sync()

  return {
    ctx,
    getSize: () => ({ width, height }),
    getDpr: () => dpr,
    sync,
  }
}

function get2d(
  canvas: HTMLCanvasElement,
  options?: CanvasRenderingContext2DSettings,
): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', options)
  if (context === null) throw new Error('2D canvas context is unavailable')
  return context
}
