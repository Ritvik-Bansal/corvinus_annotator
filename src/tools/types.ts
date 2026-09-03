// The tool contract. Every tool is the same shape, so adding polygon or brush
// later is a new file plus one registry entry — not a change to the dispatcher.

import type { ReadonlyDocument, Point, SessionState, ToolId, Viewport } from '../state/types.ts'

/** What a tool is handed on every pointer event. */
export interface ToolContext {
  /** Pointer in IMAGE pixel space. Produced by screenToImage in the dispatcher. */
  image: Point
  /** Pointer in screen (CSS pixel) space, relative to the canvas area. */
  screen: Point
  viewport: Viewport
  document: ReadonlyDocument
  session: SessionState
  event: PointerEvent
}

/** What a tool is handed when it draws its overlay. */
export interface ToolView {
  viewport: Viewport
  document: ReadonlyDocument
  session: SessionState
}

export interface Tool {
  readonly id: ToolId
  /** CSS cursor shown while this tool is active. */
  readonly cursor: string

  onPointerDown(ctx: ToolContext): void
  onPointerMove(ctx: ToolContext): void
  onPointerUp(ctx: ToolContext): void

  /**
   * Draws onto the overlay layer in SCREEN space (already scaled for dpr, so
   * work in CSS pixels). Called once per frame while the overlay is dirty.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: ToolView): void

  /**
   * Id of an annotation the annotations layer must skip because this tool is
   * currently drawing a live version of it on the overlay. Without this you
   * would see the old and dragged positions at once.
   */
  hiddenAnnotationId(): string | null

  /** Finish a multi-step gesture early (Enter). No-op for one-drag tools. */
  commit(): void

  /** Abandon any gesture in progress (tool switch, Escape, pointer cancel). */
  cancel(): void
}
