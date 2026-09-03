import { DOCUMENT_VERSION } from './types.ts'
// `import type` imports something used ONLY as a type. It disappears entirely at
// build time. Our tsconfig has verbatimModuleSyntax, which requires this form.
import type { AnnotationDocument, Label, SessionState } from './types.ts'

/**
 * Ids are prefixed so raw JSON stays readable ("ann_9f2c…" vs a bare uuid).
 * `?.` = "call this only if it exists"; `??` = "use the right side if the left
 * is null/undefined". crypto.randomUUID needs a secure context (https or
 * localhost), so it is undefined if you ever open the dev server over a plain
 * http LAN address — hence the fallback.
 */
export function createId(prefix: string): string {
  const unique =
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2, 12)
  return `${prefix}_${unique}`
}

/**
 * Seeded labels use stable hand-written ids rather than generated ones, so a
 * JSON file exported today still resolves its labels when imported next week.
 * User-created labels get createId('label').
 */
export const SEED_LABELS: Label[] = [
  {
    id: 'label_reagent_bottle',
    index: 1,
    name: 'Reagent Bottle',
    color: '#2060ff',
    attributes: [
      {
        key: 'liquidLevel',
        name: 'Liquid Level',
        type: 'number',
        min: 0,
        max: 100,
        unit: '%',
        default: 50,
      },
      {
        key: 'capState',
        name: 'State',
        type: 'enum',
        options: ['Open', 'Closed'],
        default: 'Closed',
      },
      { key: 'contents', name: 'Contents', type: 'text' },
    ],
  },
  {
    id: 'label_pipette_tip',
    index: 2,
    name: 'Pipette Tip',
    color: '#00c020',
    attributes: [
      {
        key: 'volume',
        name: 'Volume',
        type: 'enum',
        options: ['10 uL', '200 uL', '1000 uL'],
        default: '200 uL',
      },
      { key: 'attached', name: 'Attached to Pipette', type: 'boolean', default: false },
      { key: 'hasLiquid', name: 'Contains Liquid', type: 'boolean', default: false },
    ],
  },
  {
    id: 'label_microplate',
    index: 3,
    name: 'Microplate',
    color: '#ff2020',
    attributes: [
      {
        key: 'format',
        name: 'Plate Format',
        type: 'enum',
        options: ['6-well', '24-well', '96-well', '384-well'],
        default: '96-well',
      },
      { key: 'lidPresent', name: 'Lid Present', type: 'boolean', default: true },
      { key: 'occupiedWells', name: 'Occupied Wells', type: 'number', min: 0, max: 384 },
    ],
  },
]

/** Colours offered to user-created classes, in order, skipping ones in use. */
/**
 * Saturated, not pastel. These sit on top of unpredictable photo content, and a
 * washed-out colour disappears over a busy image — the same reason the chrome
 * is deliberately colourless.
 */
export const LABEL_PALETTE: readonly string[] = [
  '#ff8c00', // orange
  '#a020ff', // purple
  '#00c8d7', // cyan
  '#e0b000', // amber
  '#ff00a0', // magenta
  '#80e000', // lime
  '#00b090', // teal
  '#ff5555', // salmon
]

/** First palette colour not already taken, so new classes stay distinguishable. */
export function nextLabelColor(used: readonly string[]): string {
  return LABEL_PALETTE.find((c) => !used.includes(c)) ?? LABEL_PALETTE[0]
}

export function createEmptyDocument(): AnnotationDocument {
  return {
    version: DOCUMENT_VERSION,
    exportedAt: new Date().toISOString(),
    image: { fileName: '', width: 0, height: 0 },
    // Cloned so that editing a label in one document can never reach back and
    // mutate the shared SEED_LABELS constant.
    labels: structuredClone(SEED_LABELS),
    annotations: [],
    strokes: [],
  }
}

export function createInitialSession(): SessionState {
  return {
    viewport: { scale: 1, offsetX: 0, offsetY: 0 },
    activeTool: 'select',
    activeLabelId: SEED_LABELS[0].id,
    brushRadius: 24,
    selectedAnnotationId: null,
  }
}
