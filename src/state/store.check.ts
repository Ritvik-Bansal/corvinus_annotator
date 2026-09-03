// Verification for the state module. Run with: npm run check
// Uses no Node APIs on purpose, so it needs no @types/node dependency.
// Never imported by main.ts, so it is not part of the shipped bundle.

import { createStore } from './store.ts'
import { createEmptyDocument, createId } from './defaults.ts'
import type { AnnotationDocument, BboxAnnotation, EraseStroke, PaintStroke } from './types.ts'

let failures = 0

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok    ${label}`)
  } else {
    console.log(`  FAIL  ${label}`)
    failures += 1
  }
}

// Deep compare via JSON. Key order is deterministic here because every document
// in a lineage is built by the same code path, so this is a valid identity test.
function same(a: AnnotationDocument, b: AnnotationDocument): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function makeBbox(): BboxAnnotation {
  const now = new Date().toISOString()
  return {
    id: createId('ann'),
    type: 'bbox',
    labelId: 'label_reagent_bottle',
    attributes: { liquidLevel: 50, capState: 'Open' },
    geometry: { x: 100, y: 120, width: 240, height: 380 },
    createdAt: now,
    updatedAt: now,
  }
}

console.log('\ndocument shape')
{
  const doc = createEmptyDocument()
  const keys = Object.keys(doc).sort()
  check(
    'has exactly the six top-level keys',
    JSON.stringify(keys) ===
      JSON.stringify(['annotations', 'exportedAt', 'image', 'labels', 'strokes', 'version']),
  )
  check('seeds three labels', doc.labels.length === 3)
  check(
    'seed labels are indexed 1,2,3',
    JSON.stringify(doc.labels.map((l) => l.index)) === JSON.stringify([1, 2, 3]),
  )
  check(
    'seed label names',
    JSON.stringify(doc.labels.map((l) => l.name)) ===
      JSON.stringify(['Reagent Bottle', 'Pipette Tip', 'Microplate']),
  )
  check('every seed label defines attributes', doc.labels.every((l) => l.attributes.length > 0))

  const other = createEmptyDocument()
  other.labels[0].name = 'Mutated'
  check('documents do not share label objects', createEmptyDocument().labels[0].name === 'Reagent Bottle')
}

console.log('\nsubscribe / notify')
{
  const store = createStore()
  const seen: string[] = []
  const unsubscribe = store.subscribe((kind) => seen.push(kind))

  store.commit((d) => d.annotations.push(makeBbox()))
  check("commit notifies with 'document'", JSON.stringify(seen) === JSON.stringify(['document']))

  store.setSession({ viewport: { scale: 2, offsetX: 10, offsetY: 10 } })
  check(
    "setSession notifies with 'session'",
    JSON.stringify(seen) === JSON.stringify(['document', 'session']),
  )

  unsubscribe()
  store.commit((d) => d.annotations.push(makeBbox()))
  check('unsubscribe stops delivery', seen.length === 2)
}

console.log('\nundo / redo round trip')
{
  const store = createStore()
  const before = structuredClone(store.getDocument())
  check('nothing to undo on a fresh store', store.canUndo() === false)
  check('undo on empty history returns false', store.undo() === false)

  store.commit((d) => d.annotations.push(makeBbox()))
  const after = structuredClone(store.getDocument())
  check('annotation was added', store.getDocument().annotations.length === 1)
  check('canUndo is now true', store.canUndo() === true)

  check('undo returns true', store.undo() === true)
  check('undo restores identical state', same(store.getDocument(), before))
  check('annotation is gone', store.getDocument().annotations.length === 0)

  check('redo returns true', store.redo() === true)
  check('redo restores identical state', same(store.getDocument(), after))
}

console.log('\nredo branch invalidation')
{
  const store = createStore()
  store.commit((d) => d.annotations.push(makeBbox()))
  store.undo()
  check('redo available after undo', store.canRedo() === true)
  store.commit((d) => d.annotations.push(makeBbox()))
  check('a new edit clears the redo branch', store.canRedo() === false)
}

console.log('\nsession state is not undoable')
{
  const store = createStore()
  store.setSession({ viewport: { scale: 4, offsetX: 50, offsetY: 60 } })
  store.setSession({ activeTool: 'brush' })
  store.setSession({ brushRadius: 80 })
  check('viewport change adds no undo entry', store.canUndo() === false)
  check('session actually changed', store.getSession().viewport.scale === 4)
  check('tool actually changed', store.getSession().activeTool === 'brush')

  const doc = store.getDocument()
  check('session is absent from the document', !('viewport' in doc) && !('activeTool' in doc))
}

console.log('\nundo cap')
{
  const store = createStore()
  for (let i = 0; i < 45; i += 1) {
    store.commit((d) => d.annotations.push(makeBbox()))
  }
  check('45 annotations committed', store.getDocument().annotations.length === 45)

  let undone = 0
  while (store.undo()) undone += 1
  check('undo depth is capped at 40', undone === 40)
  check('oldest 5 edits survive as the floor', store.getDocument().annotations.length === 5)
}

console.log('\nstroke list')
{
  const store = createStore()
  const paint: PaintStroke = {
    id: createId('stroke'),
    mode: 'paint',
    labelId: 'label_pipette_tip',
    radius: 24,
    points: [{ x: 10, y: 10 }, { x: 20, y: 22 }],
  }
  const erase: EraseStroke = {
    id: createId('stroke'),
    mode: 'erase',
    labelId: null, // the type system forbids naming a label here
    radius: 40,
    points: [{ x: 15, y: 15 }],
  }
  store.commit((d) => d.strokes.push(paint))
  store.commit((d) => d.strokes.push(erase))

  const strokes = store.getDocument().strokes
  check('strokes live in one ordered list', strokes.length === 2)
  check('authored order is preserved', strokes[0].mode === 'paint' && strokes[1].mode === 'erase')
  check('erase stroke owns no label', strokes[1].labelId === null)
}

console.log('')
if (failures > 0) {
  throw new Error(`${failures} check(s) failed`)
}
console.log('all checks passed\n')
