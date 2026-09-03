// Verification for the per-class mask derivations. Run with: npm run check

import { maskBounds, maskedLabelIds } from './masks.ts'
import { createActions } from './actions.ts'
import { createStore } from './store.ts'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ok    ${label}`)
  else {
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `  -> ${JSON.stringify(detail)}`}`)
    failures += 1
  }
}

const REAGENT = 'label_reagent_bottle'
const PIPETTE = 'label_pipette_tip'

function setup() {
  const store = createStore()
  const actions = createActions(store)
  actions.openImage({ fileName: 'x.png', width: 4032, height: 3024 })
  return { store, actions }
}

console.log('\none row per painted class')
{
  const { store, actions } = setup()
  check('no strokes means no mask rows', maskedLabelIds(store.getDocument()).length === 0)

  actions.addStroke({ mode: 'paint', labelId: REAGENT, radius: 20, points: [{ x: 100, y: 100 }] })
  actions.addStroke({ mode: 'paint', labelId: PIPETTE, radius: 20, points: [{ x: 400, y: 400 }] })
  check('painting two classes gives two rows',
    JSON.stringify(maskedLabelIds(store.getDocument())) === JSON.stringify([REAGENT, PIPETTE]),
    maskedLabelIds(store.getDocument()))

  for (let i = 0; i < 5; i += 1) {
    actions.addStroke({ mode: 'paint', labelId: PIPETTE, radius: 20, points: [{ x: 500 + i, y: 500 }] })
  }
  check('five more strokes of one class is still one row for that class',
    maskedLabelIds(store.getDocument()).length === 2,
    maskedLabelIds(store.getDocument()))
  check('and the document really does hold seven strokes', store.getDocument().strokes.length === 7)

  check('rows are in first-painted order',
    JSON.stringify(maskedLabelIds(store.getDocument())) === JSON.stringify([REAGENT, PIPETTE]))
}

console.log('\nundo updates the list')
{
  const { store, actions } = setup()
  actions.addStroke({ mode: 'paint', labelId: REAGENT, radius: 20, points: [{ x: 100, y: 100 }] })
  actions.addStroke({ mode: 'paint', labelId: PIPETTE, radius: 20, points: [{ x: 400, y: 400 }] })
  check('two rows before undo', maskedLabelIds(store.getDocument()).length === 2)
  store.undo()
  check('undoing the only pipette stroke drops its row',
    JSON.stringify(maskedLabelIds(store.getDocument())) === JSON.stringify([REAGENT]),
    maskedLabelIds(store.getDocument()))
  store.undo()
  check('undoing the last stroke leaves no rows', maskedLabelIds(store.getDocument()).length === 0)
  store.redo()
  store.redo()
  check('redo brings both rows back', maskedLabelIds(store.getDocument()).length === 2)
}

console.log('\nerase strokes do not create or remove rows')
{
  const { store, actions } = setup()
  actions.addStroke({ mode: 'erase', radius: 20, points: [{ x: 10, y: 10 }] })
  check('an erase alone creates no row', maskedLabelIds(store.getDocument()).length === 0)

  actions.addStroke({ mode: 'paint', labelId: REAGENT, radius: 20, points: [{ x: 100, y: 100 }] })
  actions.addStroke({ mode: 'erase', radius: 400, points: [{ x: 100, y: 100 }] })
  check('erasing over a painted class keeps its row (no pixel scan)',
    JSON.stringify(maskedLabelIds(store.getDocument())) === JSON.stringify([REAGENT]))
}

console.log('\nclass deletion')
{
  const { store, actions } = setup()
  actions.addStroke({ mode: 'paint', labelId: REAGENT, radius: 20, points: [{ x: 100, y: 100 }] })
  actions.addStroke({ mode: 'paint', labelId: PIPETTE, radius: 20, points: [{ x: 400, y: 400 }] })
  actions.removeLabel(REAGENT, { cascade: true })
  check('deleting a class removes its mask row too',
    JSON.stringify(maskedLabelIds(store.getDocument())) === JSON.stringify([PIPETTE]),
    maskedLabelIds(store.getDocument()))
}

console.log('\nbounds anchor the chip')
{
  const { store, actions } = setup()
  actions.addStroke({ mode: 'paint', labelId: REAGENT, radius: 10, points: [{ x: 100, y: 200 }, { x: 300, y: 260 }] })
  actions.addStroke({ mode: 'paint', labelId: REAGENT, radius: 30, points: [{ x: 50, y: 500 }] })
  actions.addStroke({ mode: 'paint', labelId: PIPETTE, radius: 5, points: [{ x: 900, y: 900 }] })

  const bounds = maskBounds(store.getDocument())
  check('one bounds entry per painted class', bounds.size === 2, bounds.size)
  const reagent = bounds.get(REAGENT)
  check('bounds span every stroke of the class and include the brush radius',
    JSON.stringify(reagent) === JSON.stringify({ minX: 20, minY: 190, maxX: 310, maxY: 530 }),
    reagent)
  const pipette = bounds.get(PIPETTE)
  check('a single dot has bounds of its own diameter',
    JSON.stringify(pipette) === JSON.stringify({ minX: 895, minY: 895, maxX: 905, maxY: 905 }),
    pipette)

  const { store: s2, actions: a2 } = setup()
  a2.addStroke({ mode: 'erase', radius: 50, points: [{ x: 0, y: 0 }] })
  check('erase strokes contribute no bounds', maskBounds(s2.getDocument()).size === 0)
}

console.log('')
if (failures > 0) throw new Error(`${failures} check(s) failed`)
console.log('all mask checks passed\n')
