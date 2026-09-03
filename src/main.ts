// Wiring only. This file owns no logic — it connects the store, the canvas
// layers, the render loop, input, and the DOM chrome, then gets out of the way.

import './style.css'
import { actions } from './state/actions.ts'
import { store } from './state/store.ts'
import { createInteractions } from './canvas/interactions.ts'
import { createLayers } from './canvas/layers.ts'
import { createRenderer } from './canvas/renderer.ts'
import { loadImageFile } from './canvas/image.ts'
import { fitToViewport } from './canvas/viewport.ts'
import { createStatusBar, createTopBar } from './ui/chrome.ts'

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

const renderer = createRenderer(
  layers,
  () => bitmap,
  () => store.getSession().viewport,
)

const interactions = createInteractions(
  canvasArea,
  () => store.getSession().viewport,
  (viewport) => store.setSession({ viewport }),
)

const statusBar = createStatusBar(
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
    // Viewport moved: every layer is stale, because all of them are drawn
    // through the same transform.
    renderer.markAllDirty()
  } else {
    renderer.markDirty('annotations')
    topBar.update(store.getDocument().image)
  }
})

renderer.start(() => {
  statusBar.update(
    store.getSession().viewport,
    interactions.getCursorImagePoint(),
    renderer.getFrameMs(),
  )
})

async function handleFile(file: File): Promise<void> {
  try {
    const next = await loadImageFile(file)
    // Release the previous decode; a 12MP bitmap is ~48MB of pixels.
    bitmap?.close()
    bitmap = next

    actions.setImage({ fileName: file.name, width: next.width, height: next.height })
    store.setSession({ viewport: fitToViewport(next, layers.getSize()) })
    renderer.markAllDirty()
  } catch (error) {
    topBar.showError(error instanceof Error ? error.message : 'Could not load that image.')
  }
}

topBar.update(store.getDocument().image)
