// Tool registry. Adding polygon or brush later means a new file and one entry.

import { createPanTool } from './pan.ts'
import { createRectangleTool } from './rectangle.ts'
import { createSelectTool } from './select.ts'
import type { Tool } from './types.ts'
import type { BboxGeometry, ToolId, Viewport } from '../state/types.ts'

/** Tools with an implementation. The rail shows the rest, disabled. */
export const ENABLED_TOOLS: readonly ToolId[] = ['select', 'bbox', 'pan']

export interface ToolDeps {
  setViewport(viewport: Viewport): void
  select(id: string | null): void
  addAnnotation(labelId: string, geometry: BboxGeometry): string
  updateGeometry(id: string, geometry: BboxGeometry): void
  labelColor(labelId: string): string
}

export type ToolRegistry = Partial<Record<ToolId, Tool>>

export function createTools(deps: ToolDeps): ToolRegistry {
  return {
    select: createSelectTool(deps),
    bbox: createRectangleTool(deps),
    pan: createPanTool(deps.setViewport),
  }
}
