// Tool registry. Adding polygon or brush later means a new file and one entry.

import { createBrushTool } from './brush.ts'
import { createPanTool } from './pan.ts'
import { createPolygonTool } from './polygon.ts'
import { createRectangleTool } from './rectangle.ts'
import { createSelectTool } from './select.ts'
import type { Tool } from './types.ts'
import type { Mask } from '../canvas/mask.ts'
import type {
  BboxGeometry,
  Point,
  PolygonGeometry,
  StrokeMode,
  ToolId,
  Viewport,
} from '../state/types.ts'

/** Tools with an implementation. The rail shows the rest, disabled. */
export const ENABLED_TOOLS: readonly ToolId[] = ['select', 'bbox', 'polygon', 'brush', 'erase', 'pan']

export interface ToolDeps {
  setViewport(viewport: Viewport): void
  select(id: string | null): void
  addAnnotation(labelId: string, geometry: BboxGeometry): string
  addPolygon(labelId: string, geometry: PolygonGeometry): string
  updateGeometry(id: string, geometry: BboxGeometry | PolygonGeometry): void
  labelColor(labelId: string): string
  getActiveLabelId(): string | null
  addStroke(mode: StrokeMode, labelId: string, radius: number, points: Point[]): string
  markAnnotationsDirty(): void
  mask: Mask
}

export type ToolRegistry = Partial<Record<ToolId, Tool>>

export function createTools(deps: ToolDeps): ToolRegistry {
  return {
    select: createSelectTool(deps),
    bbox: createRectangleTool(deps),
    polygon: createPolygonTool({
      addAnnotation: deps.addPolygon,
      select: deps.select,
      labelColor: deps.labelColor,
      getActiveLabelId: deps.getActiveLabelId,
    }),
    brush: createBrushTool('paint', deps),
    erase: createBrushTool('erase', deps),
    pan: createPanTool(deps.setViewport),
  }
}
