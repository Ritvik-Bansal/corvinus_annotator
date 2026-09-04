// Wiring only. This file owns no logic — it connects the store, the canvas
// layers, the render loop, the tools, input, and the DOM chrome.

import './style.css'
import { actions } from './state/actions.ts'
import { store } from './state/store.ts'
import { createInteractions } from './canvas/interactions.ts'
import { createLayers } from './canvas/layers.ts'
import { createMask } from './canvas/mask.ts'
import { maskedLabelIds } from './state/masks.ts'
import { createAnnotatorScene } from './canvas/annotatorScene.ts'
import { createRenderer } from './canvas/renderer.ts'
import { loadImageFile } from './canvas/image.ts'
import { fitToViewport } from './canvas/viewport.ts'
import { createTools } from './tools/index.ts'
import { createBrushControl, createStatusBar, createTopBar } from './ui/chrome.ts'
import { downloadText, readTextFile } from './io/file.ts'
import { exportFileName, parseDocument, serializeDocument } from './io/json.ts'
import { createKeyboard } from './ui/keyboard.ts'
import { createRail } from './ui/rail.ts'
import { createSidebar } from './ui/sidebar.ts'
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

// The one image-sized buffer the brush adds. Strokes remain the source of
// truth; this is a cache replayed from them and safe to throw away.
const mask = createMask()

const MIN_BRUSH = 1
const MAX_BRUSH = 300

function labelColor(labelId: string): string {
  return store.getDocument().labels.find((l) => l.id === labelId)?.color ?? FALLBACK_COLOR
}

// Tools reach the store only through these — never through commit() — so undo
// covers every shape change by construction.
const tools = createTools({
  setViewport: (viewport) => store.setSession({ viewport }),
  select: (selectedAnnotationId) => store.setSession({ selectedAnnotationId }),
  addAnnotation: (labelId, geometry) => actions.addAnnotation({ type: 'bbox', labelId, geometry }),
  addPolygon: (labelId, geometry) => actions.addAnnotation({ type: 'polygon', labelId, geometry }),
  updateGeometry: (id, geometry) => actions.updateAnnotationGeometry(id, geometry),
  getActiveLabelId: () => store.getSession().activeLabelId,
  labelColor,
  // A brush stroke is one action, so a whole drag is one undo entry.
  addStroke: (mode, labelId, radius, points) =>
    mode === 'paint'
      ? actions.addStroke({ mode: 'paint', labelId, radius, points })
      : actions.addStroke({ mode: 'erase', radius, points }),
  // The mask draws on the annotations layer, so live painting must dirty it.
  markAnnotationsDirty: () => renderer.markDirty('annotations'),
  mask,
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

const renderer = createRenderer(
  layers,
  createAnnotatorScene({
    getMask: () => mask,
    getBitmap: () => bitmap,
    getViewport: () => store.getSession().viewport,
    getDocument: () => store.getDocument(),
    getSession: () => store.getSession(),
    getActiveTool: activeTool,
  }),
)

const interactions = createInteractions(canvasArea, {
  getViewport: () => store.getSession().viewport,
  setViewport: (viewport) => store.setSession({ viewport }),
  getDocument: () => store.getDocument(),
  getSession: () => store.getSession(),
  getActiveTool: activeTool,
  markOverlayDirty: () => renderer.markDirty('overlay'),
})

const rail = createRail(need<HTMLElement>('#toolrail'), setTool)

const sidebar = createSidebar(
  {
    classList: need<HTMLElement>('#class-list'),
    addClassButton: need<HTMLButtonElement>('#add-class'),
    classForm: need<HTMLFormElement>('#class-form'),
    classNameInput: need<HTMLInputElement>('#class-name'),
    classSwatches: need<HTMLElement>('#class-swatches'),
    classAttrRows: need<HTMLElement>('#class-attrs'),
    addAttrButton: need<HTMLButtonElement>('#add-attr'),
    cancelClassButton: need<HTMLButtonElement>('#cancel-class'),
    annotationList: need<HTMLElement>('#annotation-list'),
    attributeFields: need<HTMLElement>('#attribute-fields'),
  },
  {
    getDocument: () => store.getDocument(),
    getSession: () => store.getSession(),
    setActiveLabel: (activeLabelId) => store.setSession({ activeLabelId }),
    highlightMask: (highlightedMaskLabelId) => store.setSession({ highlightedMaskLabelId }),
    selectAnnotation: (selectedAnnotationId) => store.setSession({ selectedAnnotationId }),
    // Every sidebar edit goes through an action, so undo covers all of them.
    addLabel: (name, color, attributes) => actions.addLabel({ name, color, attributes }),
    removeLabel: (labelId, cascade) => actions.removeLabel(labelId, { cascade }),
    setAttribute: (id, key, value) => actions.setAttribute(id, key, value),
  },
)

const canvasEmpty = need<HTMLElement>('#canvas-empty')

const brushControl = createBrushControl(
  need<HTMLElement>('#brush-size'),
  need<HTMLInputElement>('#brush-size-input'),
  need<HTMLElement>('#brush-size-value'),
  (brushRadius) => store.setSession({ brushRadius }),
)

createKeyboard({
  setTool,
  adjustBrush: (direction) => {
    const current = store.getSession().brushRadius
    // Proportional step, so [ and ] feel the same at 4px and at 200px.
    const step = Math.max(1, Math.round(current * 0.15))
    const next = Math.min(MAX_BRUSH, Math.max(MIN_BRUSH, current + direction * step))
    store.setSession({ brushRadius: next })
  },
  setActiveLabelByPosition: (position) => {
    const label = store.getDocument().labels[position - 1]
    if (label !== undefined) store.setSession({ activeLabelId: label.id })
  },
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
  commitGesture: () => {
    activeTool()?.commit()
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
  need<HTMLElement>('#io-message'),
  handleFile,
)

// --- export / import -------------------------------------------------------

need<HTMLButtonElement>('#export-json').addEventListener('click', () => {
  const document_ = store.getDocument()
  downloadText(exportFileName(document_.image.fileName), serializeDocument(document_))
  topBar.showMessage(`Exported ${exportFileName(document_.image.fileName)}`, false)
})

const importInput = need<HTMLInputElement>('#import-file')
need<HTMLButtonElement>('#import-json').addEventListener('click', () => importInput.click())

importInput.addEventListener('change', () => {
  const file = importInput.files?.[0]
  importInput.value = '' // so picking the same file twice still fires
  if (file === undefined) return
  void handleImport(file)
})

async function handleImport(file: File): Promise<void> {
  const text = await readTextFile(file)
  // Validated against the open image; never rescaled or repaired.
  const result = parseDocument(text, store.getDocument().image)
  if (!result.ok) {
    topBar.showMessage(result.message, true)
    return
  }
  actions.replaceDocument(result.document)
  // Imported strokes are a wholesale replacement, so replay from scratch.
  mask.invalidate()
  renderer.markDirty('annotations')
  const count = result.document.annotations.length
  topBar.showMessage(`Imported ${count} annotation${count === 1 ? '' : 's'} from ${file.name}`, false)
}

// The store notification only ever sets flags. Drawing happens exclusively in
// the animation frame, so a burst of pointer events costs one repaint, not N.
store.subscribe((kind) => {
  if (kind === 'session') {
    // Viewport moved, tool changed or selection changed: every layer is stale.
    renderer.markAllDirty()
    rail.update(store.getSession().activeTool)
    brushControl.update(store.getSession().activeTool, store.getSession().brushRadius)
  } else {
    renderer.markDirty('annotations', 'overlay')
    topBar.update(store.getDocument().image)
    canvasEmpty.hidden = store.getDocument().image.fileName !== ''
  }
  // The sidebar decides for itself whether this change concerns it. A
  // viewport-only 'session' change returns from here without touching the DOM.
  sidebar.handleChange(kind)
})

renderer.start(() => {
  statusBar.update(
    {
      annotations: store.getDocument().annotations.length,
      masks: maskedLabelIds(store.getDocument()).length,
    },
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
    // A different image means a differently sized mask and no strokes.
    mask.setImageSize(next.width, next.height)
    topBar.showMessage('', false)
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
sidebar.renderAll()
brushControl.update(store.getSession().activeTool, store.getSession().brushRadius)
canvasEmpty.hidden = store.getDocument().image.fileName !== ''
canvasArea.style.cursor = activeTool()?.cursor ?? 'default'
