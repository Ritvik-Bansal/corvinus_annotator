// Verification for the domain actions. Run with: npm run check
// No Node APIs, so no @types/node dependency. Never imported by main.ts.

import { createActions } from './actions.ts'
import { createStore } from './store.ts'
import { createEmptyDocument } from './defaults.ts'
import type { AnnotationDocument, BboxGeometry, ReadonlyDocument } from './types.ts'

let failures = 0

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok    ${label}`)
  } else {
    console.log(`  FAIL  ${label}`)
    failures += 1
  }
}

function same(a: ReadonlyDocument, b: ReadonlyDocument): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Fresh isolated store + actions for each block. */
function setup() {
  const store = createStore()
  return { store, actions: createActions(store) }
}

const BOX: BboxGeometry = { x: 100, y: 120, width: 240, height: 380 }
const REAGENT = 'label_reagent_bottle'
const PIPETTE = 'label_pipette_tip'

console.log('\nattribute defaults')
{
  const { store, actions } = setup()
  const id = actions.addAnnotation({ type: 'bbox', labelId: REAGENT, geometry: BOX })
  const created = store.getDocument().annotations.find((a) => a.id === id)!

  check('liquidLevel default applied without being set', created.attributes.liquidLevel === 50)
  check('capState default applied without being set', created.attributes.capState === 'Closed')
  check(
    'a def with no default contributes no key',
    !('contents' in created.attributes),
  )

  const id2 = actions.addAnnotation({
    type: 'bbox',
    labelId: REAGENT,
    geometry: BOX,
    attributes: { liquidLevel: 12 },
  })
  const created2 = store.getDocument().annotations.find((a) => a.id === id2)!
  check('explicit value overrides the default', created2.attributes.liquidLevel === 12)
  check('other defaults still fill in', created2.attributes.capState === 'Closed')

  const id3 = actions.addAnnotation({ type: 'polygon', labelId: PIPETTE, geometry: { points: [{ x: 1, y: 2 }] } })
  const created3 = store.getDocument().annotations.find((a) => a.id === id3)!
  check('a different class gets its own defaults', created3.attributes.volume === '200 uL')
  check('boolean defaults apply', created3.attributes.attached === false)
}

console.log('\nbbox normalization')
{
  const { store, actions } = setup()
  const id = actions.addAnnotation({
    type: 'bbox',
    labelId: REAGENT,
    geometry: { x: 100, y: 100, width: -40, height: -20 },
  })
  const a = store.getDocument().annotations.find((x) => x.id === id)!
  const g = a.type === 'bbox' ? a.geometry : null
  check('negative drag is normalized to top-left form', JSON.stringify(g) === JSON.stringify({ x: 60, y: 80, width: 40, height: 20 }))
}

console.log('\nvalidation does not corrupt history')
{
  const { store, actions } = setup()
  const before = structuredClone(store.getDocument())
  let threw = false
  try {
    actions.addAnnotation({ type: 'bbox', labelId: 'label_does_not_exist', geometry: BOX })
  } catch {
    threw = true
  }
  check('unknown labelId throws', threw)
  check('no undo entry was left behind', store.canUndo() === false)
  check('document is untouched after the throw', same(store.getDocument(), before))
}

console.log('\nannotation actions')
{
  const { store, actions } = setup()
  const id = actions.addAnnotation({ type: 'bbox', labelId: REAGENT, geometry: BOX })

  check('setAttribute sets a declared key', actions.setAttribute(id, 'capState', 'Open') === true)
  check('value landed', store.getDocument().annotations[0].attributes.capState === 'Open')
  check('setAttribute accepts an undeclared custom key', actions.setAttribute(id, 'operator', 'RB') === true)
  check('custom value landed', store.getDocument().annotations[0].attributes.operator === 'RB')
  check('setAttribute on a missing annotation returns false', actions.setAttribute('nope', 'k', 1) === false)

  check(
    'updateAnnotationGeometry works',
    actions.updateAnnotationGeometry(id, { x: 0, y: 0, width: 10, height: 10 }) === true,
  )
  let mismatch = false
  try {
    actions.updateAnnotationGeometry(id, { points: [{ x: 1, y: 1 }] })
  } catch {
    mismatch = true
  }
  check('passing polygon geometry to a bbox throws', mismatch)
  check('geometry update on a missing annotation returns false', actions.updateAnnotationGeometry('nope', BOX) === false)

  check('removeAnnotation returns true', actions.removeAnnotation(id) === true)
  check('annotation is gone', store.getDocument().annotations.length === 0)
  check('removeAnnotation on a missing id returns false', actions.removeAnnotation(id) === false)
}

console.log('\nstroke actions')
{
  const { store, actions } = setup()
  actions.addStroke({ mode: 'paint', labelId: REAGENT, radius: 20, points: [{ x: 1, y: 1 }] })
  actions.addStroke({ mode: 'erase', radius: 40, points: [{ x: 2, y: 2 }] })
  const strokes = store.getDocument().strokes

  check('both strokes are in one list', strokes.length === 2)
  check('authored order preserved', strokes[0].mode === 'paint' && strokes[1].mode === 'erase')
  check('paint stroke keeps its label', strokes[0].labelId === REAGENT)
  check('erase stroke owns no label', strokes[1].labelId === null)

  let threw = false
  try {
    actions.addStroke({ mode: 'paint', labelId: 'nope', radius: 5, points: [] })
  } catch {
    threw = true
  }
  check('paint stroke with unknown label throws', threw)
}

console.log('\nlabel actions')
{
  const { store, actions } = setup()
  const id = actions.addLabel({ name: 'Petri Dish', color: '#f58231' })
  const added = store.getDocument().labels.find((l) => l.id === id)!
  check('new label appended', store.getDocument().labels.length === 4)
  check('index continues from the seeds', added.index === 4)
  check('name set', added.name === 'Petri Dish')

  check('updateLabel returns true', actions.updateLabel(id, { color: '#000000' }) === true)
  check('color changed', store.getDocument().labels[3].color === '#000000')
  check('name untouched by a partial patch', store.getDocument().labels[3].name === 'Petri Dish')
  check('updateLabel on a missing id returns false', actions.updateLabel('nope', { name: 'x' }) === false)
}

console.log('\nremoveLabel: refuse, then cascade on request')
{
  const { store, actions } = setup()
  // Narrowing on `removed` first is required — that is the union forcing the
  // caller to handle the refusal case before reading refusal-only fields.
  const missing = actions.removeLabel('nope')
  check(
    'removing a missing label reports not-found',
    missing.removed === false && missing.reason === 'not-found',
  )

  const unusedId = actions.addLabel({ name: 'Unused', color: '#fff' })
  check('an unused label removes cleanly', actions.removeLabel(unusedId).removed === true)

  actions.addAnnotation({ type: 'bbox', labelId: REAGENT, geometry: BOX })
  actions.addAnnotation({ type: 'bbox', labelId: REAGENT, geometry: BOX })
  actions.addStroke({ mode: 'paint', labelId: REAGENT, radius: 10, points: [] })
  actions.addStroke({ mode: 'erase', radius: 10, points: [] })

  const refused = actions.removeLabel(REAGENT)
  check('an in-use label is refused', refused.removed === false)
  if (refused.removed === false && refused.reason === 'in-use') {
    check('refusal reports annotation count', refused.annotations === 2)
    check('refusal reports paint-stroke count', refused.strokes === 1)
  }
  check('nothing was removed by the refusal', store.getDocument().labels.length === 3)

  const forced = actions.removeLabel(REAGENT, { cascade: true })
  check('cascade removes the label', forced.removed === true)
  check('cascade removed its annotations', store.getDocument().annotations.length === 0)
  check('cascade removed its paint strokes', store.getDocument().strokes.length === 1)
  check('cascade KEPT the global erase stroke', store.getDocument().strokes[0].mode === 'erase')
  check('active label moved off the deleted one', store.getSession().activeLabelId !== REAGENT)
  check('active label points at a surviving label', store.getDocument().labels.some((l) => l.id === store.getSession().activeLabelId))
}

console.log('\nreplaceDocument')
{
  const { store, actions } = setup()
  actions.addAnnotation({ type: 'bbox', labelId: REAGENT, geometry: BOX })
  const beforeImport = structuredClone(store.getDocument())

  const incoming: AnnotationDocument = createEmptyDocument()
  incoming.image = { fileName: 'plate.jpg', width: 4000, height: 3000 }
  actions.replaceDocument(incoming)

  check('document was swapped', store.getDocument().image.fileName === 'plate.jpg')
  check('previous annotations are gone', store.getDocument().annotations.length === 0)
  check('selection was cleared', store.getSession().selectedAnnotationId === null)

  incoming.image.width = 1 // mutate the caller's object afterwards
  check('store did not alias the caller object', store.getDocument().image.width === 4000)

  check('replaceDocument is undoable', store.undo() === true)
  check('undo restores the pre-import document', same(store.getDocument(), beforeImport))
}

console.log('\nevery action is undoable, one commit each')
{
  const { store, actions } = setup()
  const start = structuredClone(store.getDocument())

  const annId = actions.addAnnotation({ type: 'bbox', labelId: REAGENT, geometry: BOX })
  actions.setAttribute(annId, 'capState', 'Open')
  actions.updateAnnotationGeometry(annId, { x: 5, y: 5, width: 50, height: 50 })
  actions.addStroke({ mode: 'paint', labelId: REAGENT, radius: 10, points: [] })
  actions.addStroke({ mode: 'erase', radius: 10, points: [] })
  const labelId = actions.addLabel({ name: 'Temp', color: '#fff' })
  actions.updateLabel(labelId, { name: 'Temp2' })
  actions.removeLabel(labelId)
  actions.removeAnnotation(annId)
  actions.replaceDocument(createEmptyDocument())

  let depth = 0
  while (store.undo()) depth += 1
  check('10 actions produced exactly 10 undo steps', depth === 10)
  check('undoing everything returns the starting document', same(store.getDocument(), start))
}

console.log('')
if (failures > 0) {
  throw new Error(`${failures} check(s) failed`)
}
console.log('all action checks passed\n')
