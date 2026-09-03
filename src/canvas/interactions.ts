// Pointer and wheel input. This module never draws and never touches a canvas
// context — it converts events into viewport changes and lets the store's
// notification wake the render loop.

import { panBy, screenToImage, zoomAt } from './viewport.ts'
import type { Point, Viewport } from '../state/types.ts'

/** Wheel sensitivity. Exponential so zoom feels the same at every scale. */
const ZOOM_SENSITIVITY = 0.0015

export interface Interactions {
  /** Image-space point under the cursor, or null when the pointer has left. */
  getCursorImagePoint(): Point | null
  isPanning(): boolean
}

export function createInteractions(
  target: HTMLElement,
  getViewport: () => Viewport,
  setViewport: (viewport: Viewport) => void,
): Interactions {
  let cursorImagePoint: Point | null = null
  let panning = false
  let lastScreenPoint: Point = { x: 0, y: 0 }

  /** Event coordinates are viewport-relative; convert to canvas-area-relative. */
  function toLocal(event: PointerEvent | WheelEvent): Point {
    const rect = target.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  target.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0) return
    // Pointer capture keeps the drag alive if the cursor leaves the element,
    // so a fast pan doesn't strand the canvas mid-gesture.
    target.setPointerCapture(event.pointerId)
    panning = true
    lastScreenPoint = toLocal(event)
    target.classList.add('is-panning')
  })

  target.addEventListener('pointermove', (event: PointerEvent) => {
    const local = toLocal(event)
    cursorImagePoint = screenToImage(local, getViewport())
    if (!panning) return
    setViewport(panBy(getViewport(), local.x - lastScreenPoint.x, local.y - lastScreenPoint.y))
    lastScreenPoint = local
  })

  function endPan(event: PointerEvent): void {
    if (!panning) return
    panning = false
    target.releasePointerCapture(event.pointerId)
    target.classList.remove('is-panning')
  }

  target.addEventListener('pointerup', endPan)
  target.addEventListener('pointercancel', endPan)

  target.addEventListener('pointerleave', () => {
    cursorImagePoint = null
  })

  target.addEventListener(
    'wheel',
    (event: WheelEvent) => {
      event.preventDefault() // otherwise the page scrolls instead of zooming
      // deltaMode 1 means the delta is in lines, not pixels. Normalize.
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      const factor = Math.exp(-delta * ZOOM_SENSITIVITY)
      const local = toLocal(event)
      setViewport(zoomAt(getViewport(), local, factor))
      cursorImagePoint = screenToImage(local, getViewport())
    },
    // preventDefault is only permitted on a non-passive listener, and browsers
    // default wheel listeners to passive.
    { passive: false },
  )

  return {
    getCursorImagePoint: () => cursorImagePoint,
    isPanning: () => panning,
  }
}
