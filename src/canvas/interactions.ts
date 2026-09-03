// The single entry point for pointer and wheel input.
//
// This module converts DOM events into a ToolContext and dispatches to whichever
// tool is active. It never draws and never touches a canvas context. Wheel
// handling stays here rather than in a tool because zoom and pan are properties
// of the viewport, not of whatever you happen to be drawing with.

import { panBy, screenToImage, zoomAt } from './viewport.ts'
import type { Tool, ToolContext } from '../tools/types.ts'
import type { Point, ReadonlyDocument, SessionState, Viewport } from '../state/types.ts'

/** Wheel sensitivity. Exponential so zoom feels the same at every scale. */
const ZOOM_SENSITIVITY = 0.0015

export interface InteractionDeps {
  getViewport(): Viewport
  setViewport(viewport: Viewport): void
  getDocument(): ReadonlyDocument
  getSession(): SessionState
  getActiveTool(): Tool | null
  /** Called after every dispatched event so the overlay repaints next frame. */
  markOverlayDirty(): void
}

export interface Interactions {
  /** Image-space point under the cursor, or null when the pointer has left. */
  getCursorImagePoint(): Point | null
}

export function createInteractions(target: HTMLElement, deps: InteractionDeps): Interactions {
  let cursorImagePoint: Point | null = null
  let gestureActive = false

  /** Event coordinates are viewport-relative; convert to canvas-area-relative. */
  function toLocal(event: PointerEvent | WheelEvent): Point {
    const rect = target.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  /** The one place screen coordinates become image coordinates for tools. */
  function contextFor(event: PointerEvent): ToolContext {
    const screen = toLocal(event)
    const viewport = deps.getViewport()
    return {
      screen,
      image: screenToImage(screen, viewport),
      viewport,
      document: deps.getDocument(),
      session: deps.getSession(),
      event,
    }
  }

  target.addEventListener('pointerdown', (event: PointerEvent) => {
    if (event.button !== 0) return
    const tool = deps.getActiveTool()
    if (tool === null) return
    // Pointer capture keeps a fast drag alive if the cursor leaves the element.
    target.setPointerCapture(event.pointerId)
    gestureActive = true
    tool.onPointerDown(contextFor(event))
    deps.markOverlayDirty()
  })

  target.addEventListener('pointermove', (event: PointerEvent) => {
    const screen = toLocal(event)
    cursorImagePoint = screenToImage(screen, deps.getViewport())
    if (!gestureActive) return
    deps.getActiveTool()?.onPointerMove(contextFor(event))
    deps.markOverlayDirty()
  })

  function endGesture(event: PointerEvent): void {
    if (!gestureActive) return
    gestureActive = false
    target.releasePointerCapture(event.pointerId)
    deps.getActiveTool()?.onPointerUp(contextFor(event))
    deps.markOverlayDirty()
  }

  target.addEventListener('pointerup', endGesture)
  target.addEventListener('pointercancel', (event: PointerEvent) => {
    if (!gestureActive) return
    gestureActive = false
    target.releasePointerCapture(event.pointerId)
    deps.getActiveTool()?.cancel()
    deps.markOverlayDirty()
  })

  target.addEventListener('pointerleave', () => {
    cursorImagePoint = null
  })

  target.addEventListener(
    'wheel',
    (event: WheelEvent) => {
      event.preventDefault() // otherwise the page scrolls instead of acting
      const local = toLocal(event)
      // deltaMode 1 means the delta is in lines, not pixels. Normalize.
      const unit = event.deltaMode === 1 ? 16 : 1

      // A trackpad pinch arrives as a wheel event with ctrlKey set; a plain
      // two-finger scroll does not. Matching Figma/Photoshop: pinch zooms,
      // two-finger scroll pans.
      if (event.ctrlKey) {
        const factor = Math.exp(-event.deltaY * unit * ZOOM_SENSITIVITY)
        deps.setViewport(zoomAt(deps.getViewport(), local, factor))
      } else {
        // Scrolling down moves the content up, hence the negation.
        deps.setViewport(panBy(deps.getViewport(), -event.deltaX * unit, -event.deltaY * unit))
      }
      cursorImagePoint = screenToImage(local, deps.getViewport())
    },
    // preventDefault is only permitted on a non-passive listener, and browsers
    // default wheel listeners to passive.
    { passive: false },
  )

  return {
    getCursorImagePoint: () => cursorImagePoint,
  }
}
