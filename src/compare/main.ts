// Comparison page wiring. Reuses the annotator's layers, viewport, renderer,
// image decoding and JSON validation — nothing here is a fork of them.

import '../style.css'
import { createInteractions } from '../canvas/interactions.ts'
import { createLayers } from '../canvas/layers.ts'
import { createRenderer } from '../canvas/renderer.ts'
import { loadImageFile } from '../canvas/image.ts'
import { fitToViewport } from '../canvas/viewport.ts'
import { createPanTool } from '../tools/pan.ts'
import { readTextFile } from '../io/file.ts'
import { parseDocument } from '../io/json.ts'
import { maskedLabelIds } from '../state/masks.ts'
import { boxesOf, matchBoxes, summarize } from './agreement.ts'
import { createCompareScene, pairId } from './scene.ts'
import { createPanel } from './panel.ts'
import type { MatchResult, NotCompared } from './agreement.ts'
import type { AnnotationDocument, ImageMeta, ReadonlyDocument, Viewport } from '../state/types.ts'

function need<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (element === null) throw new Error(`Missing element: ${selector}`)
  return element
}

const canvasArea = need<HTMLDivElement>('#canvas-area')
const canvasEmpty = need<HTMLElement>('#canvas-empty')
const messageEl = need<HTMLElement>('#cmp-message')
const loadedEl = need<HTMLElement>('#cmp-loaded')
const statusEl = need<HTMLElement>('#cmp-status')
const thresholdInput = need<HTMLInputElement>('#cmp-threshold')
const thresholdValue = need<HTMLElement>('#cmp-threshold-value')

// --- state ------------------------------------------------------------------
// This page has no store: it has no undo, no editing and nothing to export, so
// a handful of module-scoped values is the honest amount of machinery.
let bitmap: ImageBitmap | null = null
let image: ImageMeta | null = null
let docA: AnnotationDocument | null = null
let docB: AnnotationDocument | null = null
let result: MatchResult | null = null
let selectedPairId: string | null = null
let viewport: Viewport = { scale: 1, offsetX: 0, offsetY: 0 }

const EMPTY_DOCUMENT: ReadonlyDocument = {
  version: '1.0',
  exportedAt: '',
  image: { fileName: '', width: 0, height: 0 },
  labels: [],
  annotations: [],
  strokes: [],
}

const layers = createLayers(canvasArea, {
  image: need<HTMLCanvasElement>('#layer-image'),
  annotations: need<HTMLCanvasElement>('#layer-annotations'),
  overlay: need<HTMLCanvasElement>('#layer-overlay'),
})

const renderer = createRenderer(
  layers,
  createCompareScene({
    getBitmap: () => bitmap,
    getViewport: () => viewport,
    getResult: () => result,
    getSelectedPairId: () => selectedPairId,
  }),
)

// The annotator's pan tool, reused verbatim, so dragging works here too.
const panTool = createPanTool((next) => {
  viewport = next
  renderer.markAllDirty()
})

createInteractions(canvasArea, {
  getViewport: () => viewport,
  setViewport: (next) => {
    viewport = next
    renderer.markAllDirty()
  },
  // Panning and zooming are the only interactions here. The pan tool reads only
  // the screen point and the viewport from its context, so the document and
  // session below exist to satisfy the type and are otherwise unused.
  getDocument: () => EMPTY_DOCUMENT,
  getSession: () => ({
    viewport,
    activeTool: 'pan' as const,
    activeLabelId: null,
    brushRadius: 1,
    selectedAnnotationId: null,
    highlightedMaskLabelId: null,
  }),
  getActiveTool: () => panTool,
  markOverlayDirty: () => renderer.markDirty('overlay'),
})

const panel = createPanel({
  legend: need<HTMLElement>('#cmp-legend'),
  summary: need<HTMLElement>('#cmp-summary'),
  pairs: need<HTMLElement>('#cmp-pairs'),
}, (id) => {
  selectedPairId = id
  renderer.markDirty('overlay')
  redrawPanel()
})
panel.renderLegend()

// --- loading ----------------------------------------------------------------

need<HTMLInputElement>('#cmp-image').addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file !== undefined) void handleImage(file)
})
need<HTMLInputElement>('#cmp-a').addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file !== undefined) void handleJson(file, 'A')
})
need<HTMLInputElement>('#cmp-b').addEventListener('change', (event) => {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file !== undefined) void handleJson(file, 'B')
})

async function handleImage(file: File): Promise<void> {
  try {
    const next = await loadImageFile(file)
    bitmap?.close()
    bitmap = next
    image = { fileName: file.name, width: next.width, height: next.height }
    // A different image invalidates both files: their coordinates were checked
    // against the old one.
    docA = null
    docB = null
    viewport = fitToViewport(next, layers.getSize())
    recompute()
    say(`Loaded ${file.name}`, false)
  } catch (error) {
    say(error instanceof Error ? error.message : 'Could not load that image.', true)
  }
}

async function handleJson(file: File, side: 'A' | 'B'): Promise<void> {
  if (image === null) {
    say('Load the image first. Coordinates are checked against it and never rescaled.', true)
    return
  }
  const parsed = parseDocument(await readTextFile(file), image)
  if (!parsed.ok) {
    say(`${side}: ${parsed.message}`, true)
    return
  }

  // Both files are validated against the same image, so agreeing with it means
  // agreeing with each other. Checked explicitly anyway, for a clearer message.
  const other = side === 'A' ? docB : docA
  if (
    other !== null &&
    (other.image.width !== parsed.document.image.width ||
      other.image.height !== parsed.document.image.height)
  ) {
    say(
      `The two files are for different image sizes: ` +
        `${parsed.document.image.width} x ${parsed.document.image.height} vs ` +
        `${other.image.width} x ${other.image.height}. They cannot be compared.`,
      true,
    )
    return
  }

  if (side === 'A') docA = parsed.document
  else docB = parsed.document
  recompute()
  say(`${side}: ${file.name}`, false)
}

// --- comparison -------------------------------------------------------------

thresholdInput.addEventListener('input', () => {
  thresholdValue.textContent = Number(thresholdInput.value).toFixed(2)
  // Live: the matching is pure and cheap, so it simply reruns on every drag tick.
  recompute()
})

function recompute(): void {
  canvasEmpty.hidden = bitmap !== null
  if (docA === null || docB === null) {
    result = null
    selectedPairId = null
    redrawPanel()
    renderer.markAllDirty()
    statusEl.textContent = image === null ? 'No files loaded' : waitingFor()
    return
  }

  result = matchBoxes(boxesOf(docA), boxesOf(docB), Number(thresholdInput.value))
  if (selectedPairId !== null && !result.matched.some((p) => pairId(p) === selectedPairId)) {
    selectedPairId = null // the selected pair may not survive a threshold change
  }
  redrawPanel()
  renderer.markAllDirty()

  const totals = summarize(result)
  statusEl.textContent =
    `${totals.matched} matched  ·  ${totals.onlyA} A only  ·  ${totals.onlyB} B only  ·  ` +
    `mean IoU ${totals.matched === 0 ? '-' : totals.meanIoU.toFixed(3)}`
}

function redrawPanel(): void {
  const labels = docA?.labels ?? docB?.labels ?? []
  panel.render(result, labels, notCompared(), selectedPairId)
  loadedEl.textContent = [
    image === null ? null : `${image.fileName} ${image.width}x${image.height}`,
    docA === null ? null : 'A',
    docB === null ? null : 'B',
  ]
    .filter((part) => part !== null)
    .join('  ·  ')
}

/** Counted so the page states what it ignored instead of ignoring it silently. */
function notCompared(): NotCompared {
  const polygons = (doc: AnnotationDocument | null): number =>
    doc === null ? 0 : doc.annotations.filter((a) => a.type === 'polygon').length
  const masks = (doc: AnnotationDocument | null): number =>
    doc === null ? 0 : maskedLabelIds(doc).length
  return {
    polygonsA: polygons(docA),
    polygonsB: polygons(docB),
    maskClassesA: masks(docA),
    maskClassesB: masks(docB),
  }
}

function waitingFor(): string {
  const missing = [docA === null ? 'A' : null, docB === null ? 'B' : null].filter((x) => x !== null)
  return `Waiting for ${missing.join(' and ')}`
}

function say(message: string, isError: boolean): void {
  messageEl.textContent = message
  messageEl.classList.toggle('is-error', isError)
}

renderer.start(() => {})
thresholdValue.textContent = Number(thresholdInput.value).toFixed(2)
redrawPanel()
