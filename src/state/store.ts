import { createEmptyDocument, createInitialSession } from './defaults.ts'
import type { AnnotationDocument, SessionState } from './types.ts'

/** How many document snapshots to keep. Oldest is dropped past this. */
const UNDO_LIMIT = 40

/**
 * Which half of the state changed. Listeners get this so the DOM sidebar can
 * ignore 'session' churn: panning fires continuously, and re-rendering the
 * label list on every pointermove would be a real performance problem.
 */
export type ChangeKind = 'document' | 'session'

// A Listener is any function taking a ChangeKind and returning nothing.
type Listener = (kind: ChangeKind) => void

export function createStore(
  initialDocument: AnnotationDocument = createEmptyDocument(),
  initialSession: SessionState = createInitialSession(),
) {
  let doc = initialDocument
  let session = initialSession

  /**
   * Past and future document snapshots.
   * Invariant: exactly ONE document object is live (`doc`) and is the only one
   * ever mutated. Everything sitting in these two arrays is inert. That is what
   * lets undo/redo below move objects between stacks without re-cloning.
   */
  let undoStack: AnnotationDocument[] = []
  let redoStack: AnnotationDocument[] = []

  const listeners = new Set<Listener>()

  function notify(kind: ChangeKind): void {
    for (const listener of listeners) listener(kind)
  }

  function pushUndo(snapshot: AnnotationDocument): void {
    undoStack.push(snapshot)
    if (undoStack.length > UNDO_LIMIT) undoStack.shift() // drop the oldest
  }

  return {
    /**
     * The live document. Treat as read-only: every write goes through commit().
     * Also don't cache this across a commit — undo/redo swap the object.
     */
    getDocument: (): AnnotationDocument => doc,

    getSession: (): SessionState => session,

    /**
     * The ONLY way to change the document. Snapshots, mutates, notifies.
     * You mutate the draft directly, which keeps call sites readable:
     *   store.commit(d => { d.annotations.push(annotation) })
     */
    commit(mutate: (draft: AnnotationDocument) => void): void {
      pushUndo(structuredClone(doc))
      redoStack = [] // a fresh edit invalidates any redo branch
      mutate(doc)
      notify('document')
    },

    /**
     * Session changes: viewport, active tool, selection. Notifies so the canvas
     * can redraw, but never touches the undo stack and never reaches the export.
     * Partial<T> means "any subset of T's fields".
     */
    setSession(patch: Partial<SessionState>): void {
      session = { ...session, ...patch } // copy old fields, then override
      notify('session')
    },

    /** Returns false when there is nothing to undo. */
    undo(): boolean {
      const previous = undoStack.pop()
      if (previous === undefined) return false
      // No clone needed: `doc` stops being the live object on the next line,
      // and nothing ever mutates a stack entry.
      redoStack.push(doc)
      doc = previous
      notify('document')
      return true
    },

    redo(): boolean {
      const next = redoStack.pop()
      if (next === undefined) return false
      pushUndo(doc)
      doc = next
      notify('document')
      return true
    },

    canUndo: (): boolean => undoStack.length > 0,
    canRedo: (): boolean => redoStack.length > 0,

    /** Returns an unsubscribe function — call it to stop listening. */
    subscribe(listener: Listener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

// "The Store type is whatever createStore returns" — saves writing the shape twice.
export type Store = ReturnType<typeof createStore>

/** One image at a time is an explicit product constraint, so one shared store. */
export const store = createStore()
