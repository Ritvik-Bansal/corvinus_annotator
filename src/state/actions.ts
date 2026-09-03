// Domain actions: the operations the app actually performs.
// Tools and UI call these, never store.commit() directly, so that every user-
// visible change is undoable and validated in exactly one place.

import { createId } from './defaults.ts'
import { store as sharedStore } from './store.ts'
import type { Store } from './store.ts'
import type {
  Annotation,
  AnnotationDocument,
  AttributeDef,
  AttributeValue,
  AttributeValues,
  BboxGeometry,
  ImageMeta,
  Label,
  Point,
  PolygonGeometry,
} from './types.ts'

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Geometry follows from `type`, same discriminated-union trick as Annotation. */
export type NewAnnotationInput =
  | { type: 'bbox'; labelId: string; geometry: BboxGeometry; attributes?: AttributeValues }
  | { type: 'polygon'; labelId: string; geometry: PolygonGeometry; attributes?: AttributeValues }

/** An erase stroke takes no labelId at all — the caller literally cannot supply one. */
export type NewStrokeInput =
  | { mode: 'paint'; labelId: string; radius: number; points: Point[] }
  | { mode: 'erase'; radius: number; points: Point[] }

export interface NewLabelInput {
  name: string
  color: string
  attributes?: AttributeDef[]
}

/**
 * Pick<T, K> = "an object with only these fields of T". Partial<> then makes each
 * optional. `id` and `index` are deliberately absent: index is the exported class
 * id, so changing it would silently reinterpret every annotation already drawn.
 */
export type LabelPatch = Partial<Pick<Label, 'name' | 'color' | 'attributes'>>

/** Discriminated on `removed`, so the caller is forced to handle the refusal case. */
export type RemoveLabelResult =
  | { removed: false; reason: 'not-found' }
  | { removed: false; reason: 'in-use'; annotations: number; strokes: number }
  | { removed: true; removedAnnotations: number; removedStrokes: number }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Dragging up or left yields negative width/height; store the top-left form. */
function normalizeBbox(g: BboxGeometry): BboxGeometry {
  return {
    x: g.width < 0 ? g.x + g.width : g.x,
    y: g.height < 0 ? g.y + g.height : g.y,
    width: Math.abs(g.width),
    height: Math.abs(g.height),
  }
}

/**
 * `g is BboxGeometry` is a "type predicate": returning true tells TypeScript the
 * argument really is that type, so it narrows the union at the call site.
 */
function isBboxGeometry(g: BboxGeometry | PolygonGeometry): g is BboxGeometry {
  return 'width' in g
}

/** Only defs that actually declare a default contribute a value. */
function defaultAttributeValues(label: Label): AttributeValues {
  const values: AttributeValues = {}
  for (const def of label.attributes) {
    if (def.default !== undefined) values[def.key] = def.default
  }
  return values
}

function findLabel(doc: AnnotationDocument, labelId: string): Label | undefined {
  return doc.labels.find((l) => l.id === labelId)
}

function findAnnotation(doc: AnnotationDocument, id: string): Annotation | undefined {
  return doc.annotations.find((a) => a.id === id)
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function createActions(store: Store) {
  /** 1-based, and never reuses a removed index, so exported class ids stay stable. */
  function nextLabelIndex(doc: AnnotationDocument): number {
    return doc.labels.reduce((max, l) => Math.max(max, l.index), 0) + 1
  }

  return {
    /** Returns the new annotation's id. Label defaults are applied automatically. */
    addAnnotation(input: NewAnnotationInput): string {
      const id = createId('ann')
      store.commit((draft) => {
        const label = findLabel(draft, input.labelId)
        if (label === undefined) {
          throw new Error(`addAnnotation: unknown labelId "${input.labelId}"`)
        }
        const now = new Date().toISOString()
        const attributes: AttributeValues = {
          ...defaultAttributeValues(label), // label defaults first...
          ...input.attributes, // ...explicit values from the caller win
        }
        const base = { id, labelId: input.labelId, attributes, createdAt: now, updatedAt: now }
        // Each branch is built whole. Assigning `type` and `geometry` separately
        // would break the union — TypeScript could no longer prove they agree.
        draft.annotations.push(
          input.type === 'bbox'
            ? { ...base, type: 'bbox', geometry: normalizeBbox(input.geometry) }
            : { ...base, type: 'polygon', geometry: { points: [...input.geometry.points] } },
        )
      })
      return id
    },

    /** False if no such annotation. Also clears selection, which is session state. */
    removeAnnotation(id: string): boolean {
      if (!store.getDocument().annotations.some((a) => a.id === id)) return false
      store.commit((draft) => {
        draft.annotations = draft.annotations.filter((a) => a.id !== id)
      })
      if (store.getSession().selectedAnnotationId === id) {
        store.setSession({ selectedAnnotationId: null })
      }
      return true
    },

    /** Throws if the geometry kind doesn't match the annotation's type. */
    updateAnnotationGeometry(id: string, geometry: BboxGeometry | PolygonGeometry): boolean {
      const existing = store.getDocument().annotations.find((a) => a.id === id)
      if (existing === undefined) return false
      if (existing.type === 'bbox' && !isBboxGeometry(geometry)) {
        throw new Error(`updateAnnotationGeometry: "${id}" is a bbox but got polygon geometry`)
      }
      if (existing.type === 'polygon' && isBboxGeometry(geometry)) {
        throw new Error(`updateAnnotationGeometry: "${id}" is a polygon but got bbox geometry`)
      }

      store.commit((draft) => {
        const annotation = findAnnotation(draft, id)! // existence checked above
        annotation.updatedAt = new Date().toISOString()
        // Narrowing both sides together lets this typecheck with no casts.
        if (annotation.type === 'bbox' && isBboxGeometry(geometry)) {
          annotation.geometry = normalizeBbox(geometry)
        } else if (annotation.type === 'polygon' && !isBboxGeometry(geometry)) {
          annotation.geometry = { points: [...geometry.points] }
        }
      })
      return true
    },

    /** Sets one key/value pair. Keys need not be declared by the label. */
    setAttribute(annotationId: string, key: string, value: AttributeValue): boolean {
      if (!store.getDocument().annotations.some((a) => a.id === annotationId)) return false
      store.commit((draft) => {
        const annotation = findAnnotation(draft, annotationId)! // checked above
        annotation.attributes[key] = value
        annotation.updatedAt = new Date().toISOString()
      })
      return true
    },

    /** Returns the new stroke's id. Always appended: replay order is the mask. */
    addStroke(input: NewStrokeInput): string {
      const id = createId('stroke')
      store.commit((draft) => {
        if (input.mode === 'paint' && findLabel(draft, input.labelId) === undefined) {
          throw new Error(`addStroke: unknown labelId "${input.labelId}"`)
        }
        draft.strokes.push(
          input.mode === 'paint'
            ? {
                id,
                mode: 'paint',
                labelId: input.labelId,
                radius: input.radius,
                points: [...input.points],
              }
            : { id, mode: 'erase', labelId: null, radius: input.radius, points: [...input.points] },
        )
      })
      return id
    },

    addLabel(input: NewLabelInput): string {
      const id = createId('label')
      store.commit((draft) => {
        draft.labels.push({
          id,
          index: nextLabelIndex(draft),
          name: input.name,
          color: input.color,
          attributes: input.attributes ?? [],
        })
      })
      return id
    },

    /**
     * Refuses by default if anything still uses the label, reporting the counts
     * so the UI can confirm. Pass { cascade: true } to delete the dependents too.
     * See the note in the phase summary for why refuse-then-confirm, not silent
     * cascade: undo is capped at 40, so a silent cascade can be unrecoverable.
     *
     * Erase strokes carry labelId null, so they are never counted or removed —
     * an erasure is global and stays meaningful after its class is gone.
     */
    removeLabel(id: string, options: { cascade?: boolean } = {}): RemoveLabelResult {
      const doc = store.getDocument()
      if (!doc.labels.some((l) => l.id === id)) return { removed: false, reason: 'not-found' }

      const annotations = doc.annotations.filter((a) => a.labelId === id).length
      const strokes = doc.strokes.filter((s) => s.labelId === id).length

      if ((annotations > 0 || strokes > 0) && options.cascade !== true) {
        return { removed: false, reason: 'in-use', annotations, strokes }
      }

      store.commit((draft) => {
        draft.labels = draft.labels.filter((l) => l.id !== id)
        draft.annotations = draft.annotations.filter((a) => a.labelId !== id)
        draft.strokes = draft.strokes.filter((s) => s.labelId !== id)
      })

      if (store.getSession().activeLabelId === id) {
        const remaining = store.getDocument().labels
        store.setSession({ activeLabelId: remaining.length > 0 ? remaining[0].id : null })
      }
      return { removed: true, removedAnnotations: annotations, removedStrokes: strokes }
    },

    updateLabel(id: string, patch: LabelPatch): boolean {
      if (!store.getDocument().labels.some((l) => l.id === id)) return false
      store.commit((draft) => {
        const label = draft.labels.find((l) => l.id === id)! // checked above
        // Explicit rather than Object.assign so passing an undefined field is a no-op.
        if (patch.name !== undefined) label.name = patch.name
        if (patch.color !== undefined) label.color = patch.color
        if (patch.attributes !== undefined) label.attributes = structuredClone(patch.attributes)
      })
      return true
    },

    /**
     * Records which image is open. Goes through commit() like everything else.
     * The decoded ImageBitmap is NOT stored here — it is not serializable and
     * has no business in an exported document.
     */
    setImage(image: ImageMeta): void {
      store.commit((draft) => {
        draft.image = { ...image }
      })
    },

    /**
     * Swaps the entire document. Import will call this. It goes through commit(),
     * so importing the wrong file is one Ctrl+Z away. Validation of untrusted JSON
     * belongs in io/, not here.
     */
    replaceDocument(next: AnnotationDocument): void {
      const incoming = structuredClone(next) // don't alias the caller's object
      store.commit((draft) => {
        draft.version = incoming.version
        draft.exportedAt = incoming.exportedAt
        draft.image = incoming.image
        draft.labels = incoming.labels
        draft.annotations = incoming.annotations
        draft.strokes = incoming.strokes
      })
      // Session may still point at things that no longer exist.
      const labels = store.getDocument().labels
      const active = store.getSession().activeLabelId
      store.setSession({
        selectedAnnotationId: null,
        activeLabelId:
          active !== null && labels.some((l) => l.id === active)
            ? active
            : labels.length > 0
              ? labels[0].id
              : null,
      })
    },
  }
}

export type Actions = ReturnType<typeof createActions>

/** Bound to the shared store, matching `store` in store.ts. */
export const actions = createActions(sharedStore)
