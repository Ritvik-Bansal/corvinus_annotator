import { panBy } from '../canvas/viewport.ts'
import type { Tool, ToolContext } from './types.ts'
import type { Point, Viewport } from '../state/types.ts'

export function createPanTool(setViewport: (viewport: Viewport) => void): Tool {
  let lastScreen: Point | null = null

  return {
    id: 'pan',
    cursor: 'grab',
    onPointerDown(ctx: ToolContext): void {
      lastScreen = ctx.screen
    },
    onPointerMove(ctx: ToolContext): void {
      if (lastScreen === null) return
      // Pan is a screen-space drag, so the delta is taken in screen space.
      setViewport(panBy(ctx.viewport, ctx.screen.x - lastScreen.x, ctx.screen.y - lastScreen.y))
      lastScreen = ctx.screen
    },
    onPointerUp(): void {
      lastScreen = null
    },
    drawOverlay(): void {},
    hiddenAnnotationId: () => null,
    cancel(): void {
      lastScreen = null
    },
  }
}
