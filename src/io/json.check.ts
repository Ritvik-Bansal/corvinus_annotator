// Verification for the file format. Run with: npm run check
// Pure, so the whole round trip and every refusal is testable without a browser.

import { exportFileName, parseDocument, serializeDocument } from './json.ts'
import { createActions } from '../state/actions.ts'
import { createStore } from '../state/store.ts'
import type { ImageMeta, ReadonlyDocument } from '../state/types.ts'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ok    ${label}`)
  else {
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `  -> ${JSON.stringify(detail)}`}`)
    failures += 1
  }
}

const IMAGE: ImageMeta = { fileName: 'bench_run_04.png', width: 3024, height: 4032 }

/** exportedAt is stamped at export time, so it is excluded from identity. */
function withoutTimestamp(document: ReadonlyDocument): string {
  return JSON.stringify({ ...document, exportedAt: '' })
}

function populated() {
  const store = createStore()
  const actions = createActions(store)
  actions.openImage(IMAGE)

  const custom = actions.addLabel({
    name: 'Petri Dish',
    color: '#ff8c00',
    attributes: [
      { key: 'colonyCount', name: 'Colony Count', type: 'number', min: 0, max: 500 },
      { key: 'medium', name: 'Medium', type: 'enum', options: ['LB', 'Agar'] },
      { key: 'contaminated', name: 'Contaminated', type: 'boolean', default: false },
      { key: 'notes', name: 'Notes', type: 'text' },
    ],
  })
  const box = actions.addAnnotation({
    type: 'bbox',
    labelId: 'label_reagent_bottle',
    geometry: { x: 412, y: 233, width: 180, height: 460 },
  })
  actions.setAttribute(box, 'capState', 'Open')
  actions.addAnnotation({
    type: 'polygon',
    labelId: 'label_pipette_tip',
    geometry: { points: [{ x: 1204, y: 830 }, { x: 1268, y: 830 }, { x: 1240, y: 1102 }] },
  })
  actions.addAnnotation({
    type: 'polygon',
    labelId: custom,
    geometry: { points: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }, { x: 10, y: 90 }] },
  })
  return { store, actions, custom }
}

console.log('\nexported shape')
{
  const { store } = populated()
  const text = serializeDocument(store.getDocument())
  const wire = JSON.parse(text)

  check('top-level keys are the agreed six, in order',
    JSON.stringify(Object.keys(wire)) ===
      JSON.stringify(['version', 'exportedAt', 'image', 'labels', 'annotations', 'strokes']),
    Object.keys(wire))
  check('version is the string "1.0"', wire.version === '1.0', wire.version)
  check('exportedAt is an ISO timestamp', !Number.isNaN(Date.parse(wire.exportedAt)))
  check('image carries fileName, width, height',
    JSON.stringify(wire.image) === JSON.stringify(IMAGE), wire.image)
  check('strokes is an empty array for now', Array.isArray(wire.strokes) && wire.strokes.length === 0)

  check('annotation keys are in the documented order',
    JSON.stringify(Object.keys(wire.annotations[0])) ===
      JSON.stringify(['id', 'type', 'labelId', 'attributes', 'geometry', 'createdAt', 'updatedAt']),
    Object.keys(wire.annotations[0]))
  check('label keys are in the documented order',
    JSON.stringify(Object.keys(wire.labels[0])) ===
      JSON.stringify(['id', 'index', 'name', 'color', 'attributes']),
    Object.keys(wire.labels[0]))
  check('bbox geometry is x/y/width/height',
    JSON.stringify(wire.annotations[0].geometry) ===
      JSON.stringify({ x: 412, y: 233, width: 180, height: 460 }))
  check('polygon points are [x, y] pairs on disk',
    JSON.stringify(wire.annotations[1].geometry.points) ===
      JSON.stringify([[1204, 830], [1268, 830], [1240, 1102]]),
    wire.annotations[1].geometry.points)
  check('attribute values are carried', wire.annotations[0].attributes.capState === 'Open')

  check('output is pretty printed, not minified',
    text.includes('\n  "version"') && text.includes('\n    "fileName"'))
  check('file ends with a newline', text.endsWith('\n'))
  check('polygon points stay on one line each',
    text.includes('[1204, 830]') && text.includes('[1240, 1102]'),
    text.split('\n').filter((l) => l.includes('1204'))[0])
  check('inlining does not touch enum option arrays',
    text.includes('"Open",') && text.includes('"Closed"'))
  check('a two-number array is still valid JSON after inlining',
    JSON.parse(text).annotations[1].geometry.points.length === 3)

  const enumDef = wire.labels[0].attributes.find((a: { type: string }) => a.type === 'enum')
  check('enum options survive export', JSON.stringify(enumDef.options) === JSON.stringify(['Open', 'Closed']), enumDef)
  const numberDef = wire.labels[0].attributes.find((a: { type: string }) => a.type === 'number')
  check('number min/max/unit survive export',
    numberDef.min === 0 && numberDef.max === 100 && numberDef.unit === '%', numberDef)
}

console.log('\nround trip')
{
  const { store, custom } = populated()
  const before = store.getDocument()
  const text = serializeDocument(before)
  const result = parseDocument(text, IMAGE)
  check('a freshly exported file imports', result.ok, result.ok ? '' : result.message)
  if (result.ok) {
    check('the document is identical apart from exportedAt',
      withoutTimestamp(result.document) === withoutTimestamp(before))
    check('polygon points are objects again in memory',
      JSON.stringify(result.document.annotations[1].geometry) ===
        JSON.stringify({ points: [{ x: 1204, y: 830 }, { x: 1268, y: 830 }, { x: 1240, y: 1102 }] }))

    const petri = result.document.labels.find((l) => l.id === custom)
    check('the custom class survives', petri?.name === 'Petri Dish', petri?.name)
    check('all four of its attribute definitions survive', petri?.attributes.length === 4)
    check('its enum options survive',
      JSON.stringify(petri?.attributes.find((a) => a.type === 'enum')) ===
        JSON.stringify({ key: 'medium', name: 'Medium', type: 'enum', options: ['LB', 'Agar'] }))
    check('its number bounds survive',
      JSON.stringify(petri?.attributes.find((a) => a.type === 'number')) ===
        JSON.stringify({ key: 'colonyCount', name: 'Colony Count', type: 'number', min: 0, max: 500 }))
    check('the annotation drawn with it still resolves',
      result.document.annotations.some((a) => a.labelId === custom))
  }

  // Export the imported document again: byte-identical except the timestamp.
  if (result.ok) {
    const again = JSON.parse(serializeDocument(result.document))
    const first = JSON.parse(text)
    again.exportedAt = first.exportedAt
    check('a second export is byte-identical to the first',
      JSON.stringify(again) === JSON.stringify(first))
  }
}

console.log('\nrefusals')
{
  const { store } = populated()
  const good = serializeDocument(store.getDocument())

  const junk = parseDocument('not json at all {{{', IMAGE)
  check('junk refuses instead of throwing', !junk.ok)
  check('and says what to do', !junk.ok && junk.message.includes('exported by this app'), !junk.ok ? junk.message : '')

  const array = parseDocument('[1,2,3]', IMAGE)
  check('a top-level array refuses', !array.ok && array.message.includes('array'), !array.ok ? array.message : '')

  const noVersion = parseDocument(JSON.stringify({ image: IMAGE, labels: [], annotations: [], strokes: [] }), IMAGE)
  check('a file with no version refuses', !noVersion.ok)
  check('and names the missing field', !noVersion.ok && noVersion.message.includes('"version"'), !noVersion.ok ? noVersion.message : '')

  const otherSize = parseDocument(good, { fileName: 'other.png', width: 4032, height: 3024 })
  check('a file for a different sized image refuses', !otherSize.ok)
  check('and states the file size vs the open size',
    !otherSize.ok && otherSize.message.includes('3024 x 4032') && otherSize.message.includes('4032 x 3024'),
    !otherSize.ok ? otherSize.message : '')
  check('and promises no rescaling',
    !otherSize.ok && otherSize.message.includes('never rescaled'))

  const noImage = parseDocument(good, { fileName: '', width: 0, height: 0 })
  check('importing with no image open refuses', !noImage.ok && noImage.message.includes('Open an image first'),
    !noImage.ok ? noImage.message : '')

  const wire = JSON.parse(good)
  wire.annotations[0].labelId = 'label_does_not_exist'
  const danglingLabel = parseDocument(JSON.stringify(wire), IMAGE)
  check('an unresolvable labelId refuses', !danglingLabel.ok)
  check('and names both the annotation and the class',
    !danglingLabel.ok && danglingLabel.message.includes('label_does_not_exist') &&
      danglingLabel.message.includes(wire.annotations[0].id),
    !danglingLabel.ok ? danglingLabel.message : '')

  const wire2 = JSON.parse(good)
  wire2.annotations[1].geometry.points = [[1, 2], [3, 'four']]
  const badPoints = parseDocument(JSON.stringify(wire2), IMAGE)
  check('a malformed point pair refuses', !badPoints.ok, !badPoints.ok ? badPoints.message : '')

  const wire3 = JSON.parse(good)
  wire3.annotations[0].geometry.width = -50
  const negative = parseDocument(JSON.stringify(wire3), IMAGE)
  check('a negative width refuses rather than being repaired',
    !negative.ok && negative.message.includes('never repaired'), !negative.ok ? negative.message : '')

  const wire4 = JSON.parse(good)
  delete wire4.labels
  check('a file with no labels array refuses', !parseDocument(JSON.stringify(wire4), IMAGE).ok)

  const wire5 = JSON.parse(good)
  wire5.strokes = [{ id: 's1', mode: 'erase', labelId: 'label_reagent_bottle', radius: 4, points: [[1, 1]] }]
  const badErase = parseDocument(JSON.stringify(wire5), IMAGE)
  check('an erase stroke naming a class refuses (erase is global)',
    !badErase.ok && badErase.message.includes('null'), !badErase.ok ? badErase.message : '')
}

console.log('\nfile naming')
{
  check('extension is swapped', exportFileName('bench_run_04.png') === 'bench_run_04.json')
  check('dots in the name are kept', exportFileName('run.2026.01.jpeg') === 'run.2026.01.json')
  check('a name with no extension still works', exportFileName('scan') === 'scan.json')
  check('no image falls back to a sensible name', exportFileName('') === 'annotations.json')
}

console.log('')
if (failures > 0) throw new Error(`${failures} check(s) failed`)
console.log('all json checks passed\n')
