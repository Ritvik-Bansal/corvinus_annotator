// Wiring only. This file owns no logic — it connects the store, the canvas
// layers, the render loop, the tools, input, and the DOM chrome.

import './style.css'
import { actions } from './state/actions.ts'
import { store } from './state/store.ts'
import { createInteractions } from './canvas/interactions.ts'
import { createLayers } from './canvas/layers.ts'
import { createRenderer } from './canvas/renderer.ts'
import { loadImageFile } from './canvas/image.ts'
import { fitToViewport } from './canvas/viewport.ts'
import { createTools } from './tools/index.ts'
import { createStatusBar, createTopBar } from './ui/chrome.ts'
import { createKeyboard } from './ui/keyboard.ts'
import { createRail } from './ui/rail.ts'
import type { Tool } from './tools/types.ts'
import type { ToolId } from './state/types.ts'

/** Throws early with a useful message rather than failing later on null. */
function need<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (element === null) throw new Error(`Missing element: ${selector}`)
  return element
}

const canvasArea = need<HTMLDivElement>('#canvas-area')

const layers = createLayers(canvasArea, {
  image: need<HTMLCanvasElement>('#layer-image'),
  annotations: need<HTMLCanvasElement>('#layer-annotations'),
  overlay: need<HTMLCanvasElement>('#layer-overlay'),
})

// The decoded bitmap is session-scoped, not document data: it is not
// serializable and never appears in an export.
let bitmap: ImageBitmap | null = null

const FALLBACK_COLOR = '#8b93a1'

// Tools reach the store only through these — never through commit() — so undo
// covers every shape change by construction.
const tools = createTools({
  setViewport: (viewport) => store.setSession({ viewport }),
  select: (selectedAnnotationId) => store.setSession({ selectedAnnotationId }),
  addAnnotation: (labelId, geometry) => actions.addAnnotation({ type: 'bbox', labelId, geometry }),
  updateGeometry: (id, geometry) => actions.updateAnnotationGeometry(id, geometry),
  labelColor: (labelId) =>
    store.getDocument().labels.find((l) => l.id === labelId)?.color ?? FALLBACK_COLOR,
})

function activeTool(): Tool | null {
  return tools[store.getSession().activeTool] ?? null
}

function setTool(id: ToolId): void {
  if (id === store.getSession().activeTool) return
  activeTool()?.cancel() // abandon any gesture the outgoing tool was mid-way through
  store.setSession({ activeTool: id })
  canvasArea.style.cursor = tools[id]?.cursor ?? 'default'
}

const renderer = createRenderer(layers, {
  getBitmap: () => bitmap,
  getViewport: () => store.getSession().viewport,
  getDocument: () => store.getDocument(),
  getSession: () => store.getSession(),
  getActiveTool: activeTool,
})

const interactions = createInteractions(canvasArea, {
  getViewport: () => store.getSession().viewport,
  setViewport: (viewport) => store.setSession({ viewport }),
  getDocument: () => store.getDocument(),
  getSession: () => store.getSession(),
  getActiveTool: activeTool,
  markOverlayDirty: () => renderer.markDirty('overlay'),
})

const rail = createRail(need<HTMLElement>('#toolrail'), setTool)

createKeyboard({
  setTool,
  deleteSelected: () => {
    const id = store.getSession().selectedAnnotationId
    if (id !== null) actions.removeAnnotation(id)
  },
  undo: () => store.undo(),
  redo: () => store.redo(),
  cancelGesture: () => {
    activeTool()?.cancel()
    renderer.markDirty('overlay')
  },
})

const statusBar = createStatusBar(
  need<HTMLElement>('#status-count'),
  need<HTMLElement>('#status-zoom'),
  need<HTMLElement>('#status-cursor'),
  need<HTMLElement>('#status-frame'),
)

const topBar = createTopBar(
  need<HTMLInputElement>('#file-input'),
  need<HTMLElement>('#image-name'),
  handleFile,
)

// The store notification only ever sets flags. Drawing happens exclusively in
// the animation frame, so a burst of pointer events costs one repaint, not N.
store.subscribe((kind) => {
  if (kind === 'session') {
    // Viewport moved, tool changed or selection changed: every layer is stale.
    renderer.markAllDirty()
    rail.update(store.getSession().activeTool)
  } else {
    renderer.markDirty('annotations', 'overlay')
    topBar.update(store.getDocument().image)
  }
})

renderer.start(() => {
  statusBar.update(
    store.getDocument().annotations.length,
    store.getSession().viewport,
    interactions.getCursorImagePoint(),
    { intervalMs: renderer.getFrameIntervalMs(), drawMs: renderer.getDrawMs() },
  )
})

async function handleFile(file: File): Promise<void> {
  try {
    const next = await loadImageFile(file)
    // Release the previous decode; a 12MP bitmap is ~48MB of pixels.
    bitmap?.close()
    bitmap = next

    // Resets the document and clears undo history (see actions.openImage).
    actions.openImage({ fileName: file.name, width: next.width, height: next.height })
    store.setSession({
      viewport: fitToViewport(next, layers.getSize()),
      selectedAnnotationId: null,
    })
    renderer.markAllDirty()
  } catch (error) {
    topBar.showError(error instanceof Error ? error.message : 'Could not load that image.')
  }
}

topBar.update(store.getDocument().image)
rail.update(store.getSession().activeTool)
canvasArea.style.cursor = activeTool()?.cursor ?? 'default'
