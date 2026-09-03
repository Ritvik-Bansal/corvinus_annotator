// ===========================================================================
// COORDINATE RULE (applies to every number in this file):
// all geometry is in IMAGE PIXEL SPACE, never screen space. The viewport
// scale/offset lives in session state and is applied at draw time only.
// That is what makes exported coordinates resolution-independent.
// ===========================================================================

// ---------------------------------------------------------------------------
// DOCUMENT STATE — the six top-level keys.
// This is exactly what gets exported to JSON and exactly what undo/redo
// operates on. If it isn't in here, it isn't in the export.
// ---------------------------------------------------------------------------

/** Bumped whenever the JSON shape changes, so an importer can reject old files. */
export const DOCUMENT_VERSION = '1.0'

export interface AnnotationDocument {
  version: string
  exportedAt: string // ISO 8601; refreshed at export time
  image: ImageMeta
  labels: Label[]
  annotations: Annotation[]
  /**
   * ONE ordered list for the whole image, NOT per annotation.
   * Order is load-bearing: an erase stroke removes pixels from every class,
   * so the mask is only correct if every stroke is replayed in authored order.
   */
  strokes: Stroke[]
}

export interface ImageMeta {
  fileName: string
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

// ---------------------------------------------------------------------------
// LABELS — the class list. Each label carries the *definitions* of its
// key/value fields; the actual typed-in values live on annotations.
// ---------------------------------------------------------------------------

export interface Label {
  id: string
  index: number // stable 1-based class index for ML export
  name: string
  color: string // hex, used for the overlay
  attributes: AttributeDef[]
}

/**
 * A "discriminated union": four shapes that all carry a different `type` value.
 * TypeScript reads `type` to know which of the four you're holding, so after
 * `if (def.type === 'number')` it knows `def.min` exists and `def.options` doesn't.
 */
export type AttributeDef =
  | TextAttributeDef
  | NumberAttributeDef
  | BooleanAttributeDef
  | EnumAttributeDef

interface AttributeDefBase {
  key: string // machine name; this is the key used in exported JSON
  name: string // human label shown in the sidebar
}

// `extends` on an interface means "everything in AttributeDefBase, plus these".
export interface TextAttributeDef extends AttributeDefBase {
  type: 'text' // a literal type: the ONLY allowed value is the string "text"
  default?: string // the ? makes the field optional
}

export interface NumberAttributeDef extends AttributeDefBase {
  type: 'number'
  min?: number
  max?: number
  unit?: string // e.g. "%" so the UI can render "Liquid Level: 50%"
  default?: number
}

export interface BooleanAttributeDef extends AttributeDefBase {
  type: 'boolean'
  default?: boolean
}

export interface EnumAttributeDef extends AttributeDefBase {
  type: 'enum'
  options: string[]
  default?: string
}

// ---------------------------------------------------------------------------
// ANNOTATIONS — one per drawn shape.
// ---------------------------------------------------------------------------

export type AttributeValue = string | number | boolean

/**
 * The actual key/value data on one annotation, keyed by AttributeDef.key.
 * Record<K, V> is TypeScript for "an object with keys K and values V".
 * Keys the label never defined are still allowed — that's the "custom" half
 * of the dynamic key/value requirement.
 */
export type AttributeValues = Record<string, AttributeValue>

export type AnnotationType = 'bbox' | 'polygon'

/** Another discriminated union: `geometry` follows from `type`. */
export type Annotation = BboxAnnotation | PolygonAnnotation

interface AnnotationBase {
  id: string
  labelId: string
  attributes: AttributeValues
  createdAt: string
  updatedAt: string
}

export interface BboxAnnotation extends AnnotationBase {
  type: 'bbox'
  geometry: BboxGeometry
}

export interface PolygonAnnotation extends AnnotationBase {
  type: 'polygon'
  geometry: PolygonGeometry
}

/** Top-left origin. Width/height are always positive (normalize on commit). */
export interface BboxGeometry {
  x: number
  y: number
  width: number
  height: number
}

export interface PolygonGeometry {
  points: Point[] // implicitly closed; do not repeat the first point
}

// ---------------------------------------------------------------------------
// STROKES — the brush/erase mask, as vectors rather than pixels.
// Kept as stroke lists so the JSON stays small and round-trips exactly;
// rasterize by replaying in order.
// ---------------------------------------------------------------------------

export type StrokeMode = 'paint' | 'erase'

/**
 * A union that makes the global-eraser rule impossible to get wrong:
 * a paint stroke MUST name a label, an erase stroke MUST NOT. You cannot
 * construct an erase stroke that claims to belong to one class.
 */
export type Stroke = PaintStroke | EraseStroke

interface StrokeBase {
  id: string
  radius: number // image pixels
  points: Point[] // the polyline the pointer traced
}

export interface PaintStroke extends StrokeBase {
  mode: 'paint'
  labelId: string
}

export interface EraseStroke extends StrokeBase {
  mode: 'erase'
  labelId: null // erase cuts through every class, so it owns no label
}

// ---------------------------------------------------------------------------
// SESSION STATE — NOT exported, NOT undoable.
// Everything here is "where the user is looking / what they're holding",
// which nobody wants in their dataset and nobody wants in their undo history.
// ---------------------------------------------------------------------------

export interface Viewport {
  scale: number
  offsetX: number
  offsetY: number
}

export type ToolId = 'select' | 'bbox' | 'polygon' | 'brush' | 'erase' | 'pan'

export interface SessionState {
  viewport: Viewport
  activeTool: ToolId
  activeLabelId: string | null
  brushRadius: number
  selectedAnnotationId: string | null
}

// ---------------------------------------------------------------------------
// READ-ONLY VIEW — what the store hands out to readers.
// ---------------------------------------------------------------------------

/**
 * Recursively marks every field and every array as readonly.
 * - `T extends (infer U)[]` means "if T is an array, call its element type U".
 * - The conditional distributes over unions automatically, so a discriminated
 *   union like Stroke stays a union of two readonly shapes and narrowing on
 *   `.mode` still works.
 * - `{ readonly [K in keyof T]: ... }` is a "mapped type": rebuild T field by
 *   field, adding readonly to each.
 */
export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T

export type ReadonlyDocument = DeepReadonly<AnnotationDocument>

/**
 * structuredClone always returns a fresh, fully mutable object — only the
 * static type carries the input's readonly-ness. This is the single sanctioned
 * place that cast happens, so it can be found by grepping for one word.
 * Call with an explicit type argument: thaw<Label[]>(doc.labels).
 */
export function thaw<T>(value: DeepReadonly<T>): T {
  return structuredClone(value) as T
}
