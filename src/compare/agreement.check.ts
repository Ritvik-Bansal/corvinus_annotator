// Verification for IoU and matching. Run with: npm run check
// This is the part of the comparison page that has to be right, so it is the
// part with unit checks.

import {
  alignTaxonomies,
  applyTaxonomy,
  area,
  boxesOf,
  intersectionArea,
  iou,
  matchBoxes,
  summarize,
  summarizeByClass,
  worstFirst,
} from './agreement.ts'
import { createActions } from '../state/actions.ts'
import { createStore } from '../state/store.ts'
import type { BoxRef } from './agreement.ts'

let failures = 0
function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) console.log(`  ok    ${label}`)
  else {
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `  -> ${JSON.stringify(detail)}`}`)
    failures += 1
  }
}
const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) < tol

const box = (id: string, labelId: string, x: number, y: number, w: number, h: number): BoxRef => ({
  id,
  labelId,
  geometry: { x, y, width: w, height: h },
})
const G = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h })

console.log('\nIoU')
{
  check('identical boxes score 1', iou(G(0, 0, 10, 10), G(0, 0, 10, 10)) === 1)
  check('disjoint boxes score 0', iou(G(0, 0, 10, 10), G(50, 50, 10, 10)) === 0)
  check('boxes that only touch score 0', iou(G(0, 0, 10, 10), G(10, 0, 10, 10)) === 0)

  // Half-overlap: intersection 50, union 150.
  check('half overlap is 1/3', near(iou(G(0, 0, 10, 10), G(5, 0, 10, 10)), 50 / 150))
  // Contained: intersection 25, union 100.
  check('a box inside another is 1/4', near(iou(G(0, 0, 10, 10), G(0, 0, 5, 5)), 25 / 100))
  check('IoU is symmetric', near(iou(G(3, 4, 9, 7), G(6, 1, 5, 12)), iou(G(6, 1, 5, 12), G(3, 4, 9, 7))))
  check('a zero-area box scores 0 rather than NaN', iou(G(0, 0, 0, 0), G(0, 0, 0, 0)) === 0)
  check('a slightly shifted box scores high',
    iou(G(100, 100, 200, 200), G(105, 103, 200, 200)) > 0.9,
    iou(G(100, 100, 200, 200), G(105, 103, 200, 200)))

  check('area is width times height', area(G(3, 4, 6, 7)) === 42)
  check('negative sizes contribute no area', area(G(0, 0, -5, 10)) === 0)
  check('intersection of nested boxes is the inner area',
    intersectionArea(G(0, 0, 100, 100), G(10, 10, 20, 30)) === 600)
}

console.log('\nmatching')
{
  const A = [box('a1', 'cls', 100, 100, 200, 200)]
  const B = [box('b1', 'cls', 105, 103, 200, 200)]
  const result = matchBoxes(A, B, 0.5)
  check('ACCEPTANCE: a slightly shifted box matches', result.matched.length === 1)
  check('with a high IoU', result.matched[0].iou > 0.9, result.matched[0]?.iou)
  check('and nothing is left over', result.onlyA.length === 0 && result.onlyB.length === 0)
}

console.log('\nextra and missing boxes')
{
  const A = [box('a1', 'cls', 0, 0, 100, 100), box('a2', 'cls', 500, 500, 100, 100)]
  const B = [box('b1', 'cls', 2, 2, 100, 100)]
  const result = matchBoxes(A, B, 0.5)
  check('ACCEPTANCE: an extra box in A shows as A-only', result.onlyA.length === 1)
  check('and it is the right one', result.onlyA[0].id === 'a2', result.onlyA[0]?.id)
  check('the overlapping pair still matched', result.matched.length === 1)
  check('nothing is B-only', result.onlyB.length === 0)

  const flipped = matchBoxes(B, A, 0.5)
  check('the mirror case shows as B-only', flipped.onlyB.length === 1 && flipped.onlyA.length === 0)
}

console.log('\nthreshold')
{
  // Intersection 50, union 150 -> IoU 1/3. Borderline around 0.33.
  const A = [box('a1', 'cls', 0, 0, 10, 10)]
  const B = [box('b1', 'cls', 5, 0, 10, 10)]
  check('above the threshold there is no match', matchBoxes(A, B, 0.5).matched.length === 0)
  check('ACCEPTANCE: dropping the threshold makes the borderline pair match',
    matchBoxes(A, B, 0.3).matched.length === 1)
  check('and it is reported as A-only and B-only while unmatched',
    matchBoxes(A, B, 0.5).onlyA.length === 1 && matchBoxes(A, B, 0.5).onlyB.length === 1)
  check('a threshold of 0 still refuses non-overlapping boxes',
    matchBoxes([box('a1', 'cls', 0, 0, 10, 10)], [box('b1', 'cls', 90, 90, 10, 10)], 0).matched.length === 0)
}

console.log('\nclass and greediness rules')
{
  const A = [box('a1', 'reagent', 0, 0, 100, 100)]
  const B = [box('b1', 'pipette', 0, 0, 100, 100)]
  const result = matchBoxes(A, B, 0.5)
  check('identical boxes of DIFFERENT classes never match', result.matched.length === 0)
  check('they show as a disagreement on both sides',
    result.onlyA.length === 1 && result.onlyB.length === 1)

  // b1 overlaps a1 more than b2 does; greedy must take the better pair first.
  const A2 = [box('a1', 'cls', 0, 0, 100, 100)]
  const B2 = [box('b_far', 'cls', 40, 0, 100, 100), box('b_near', 'cls', 5, 0, 100, 100)]
  const greedy = matchBoxes(A2, B2, 0.3)
  check('greedy takes the highest-scoring pair first',
    greedy.matched.length === 1 && greedy.matched[0].b.id === 'b_near', greedy.matched[0]?.b.id)
  check('the loser is left over as B-only',
    greedy.onlyB.length === 1 && greedy.onlyB[0].id === 'b_far')

  check('one box can never be matched twice',
    matchBoxes(A2, B2, 0.01).matched.length === 1)
}

console.log('\ndeterminism')
{
  // Two identical candidates: the tie must break the same way every run.
  const A = [box('a1', 'cls', 0, 0, 10, 10)]
  const B = [box('b2', 'cls', 0, 0, 10, 10), box('b1', 'cls', 0, 0, 10, 10)]
  const first = matchBoxes(A, B, 0.5).matched[0].b.id
  for (let i = 0; i < 20; i += 1) {
    if (matchBoxes(A, B, 0.5).matched[0].b.id !== first) {
      check('tied pairs resolve deterministically', false)
      break
    }
  }
  check('tied pairs resolve deterministically', true)
  check('and the tie breaks on id', first === 'b1', first)
}

console.log('\nsummaries')
{
  const A = [
    box('a1', 'reagent', 0, 0, 100, 100),
    box('a2', 'reagent', 500, 0, 100, 100),
    box('a3', 'pipette', 0, 500, 100, 100),
  ]
  const B = [
    box('b1', 'reagent', 5, 0, 100, 100),
    box('b2', 'pipette', 40, 500, 100, 100),
    box('b3', 'pipette', 900, 900, 100, 100),
  ]
  const result = matchBoxes(A, B, 0.4)
  const summary = summarize(result)
  check('summary counts matched pairs', summary.matched === 2, summary)
  check('summary counts A-only', summary.onlyA === 1, summary)
  check('summary counts B-only', summary.onlyB === 1, summary)
  check('mean IoU is the mean over matched pairs',
    near(summary.meanIoU, result.matched.reduce((s, p) => s + p.iou, 0) / 2), summary.meanIoU)
  check('mean IoU is 0 when nothing matched',
    summarize({ matched: [], onlyA: [], onlyB: [] }).meanIoU === 0)

  const byClass = summarizeByClass(result)
  check('per-class breakdown has one entry per class involved', byClass.size === 2, [...byClass.keys()])
  check('reagent: 1 matched, 1 A-only, 0 B-only',
    JSON.stringify({ ...byClass.get('reagent'), meanIoU: 0 }) ===
      JSON.stringify({ matched: 1, onlyA: 1, onlyB: 0, meanIoU: 0 }), byClass.get('reagent'))
  check('pipette: 1 matched, 0 A-only, 1 B-only',
    JSON.stringify({ ...byClass.get('pipette'), meanIoU: 0 }) ===
      JSON.stringify({ matched: 1, onlyA: 0, onlyB: 1, meanIoU: 0 }), byClass.get('pipette'))

  const sorted = worstFirst(result)
  check('pairs are sorted worst agreement first',
    sorted.length === 2 && sorted[0].iou <= sorted[1].iou, sorted.map((p) => p.iou))
}

console.log('\ntaxonomy alignment')
{
  const cls = (id: string, name: string) => ({ id, name, color: '#fff' })

  // Both files carry the seed classes: aligned on id, no fallback needed.
  const seedsA = [cls('label_reagent_bottle', 'Reagent Bottle'), cls('label_pipette_tip', 'Pipette Tip')]
  const seedsB = [cls('label_reagent_bottle', 'Reagent Bottle'), cls('label_pipette_tip', 'Pipette Tip')]
  const plain = alignTaxonomies(seedsA, seedsB)
  check('identical ids align with no name fallback', plain.nameFallbacks.length === 0)
  check('and nothing is reported as one-sided',
    plain.onlyInA.length === 0 && plain.onlyInB.length === 0)
  check('ids map to themselves', plain.keys.get('label_pipette_tip') === 'label_pipette_tip')

  // The real case: each annotator created "Petri Dish" independently.
  const a = [...seedsA, cls('label_uuid_a', 'Petri Dish')]
  const b = [...seedsB, cls('label_uuid_b', 'Petri Dish')]
  const aligned = alignTaxonomies(a, b)
  check('a class with matching name but different ids aligns by name',
    aligned.keys.get('label_uuid_a') === aligned.keys.get('label_uuid_b'),
    [aligned.keys.get('label_uuid_a'), aligned.keys.get('label_uuid_b')])
  check('the name fallback is REPORTED, not silent',
    aligned.nameFallbacks.length === 1 && aligned.nameFallbacks[0].name === 'Petri Dish',
    aligned.nameFallbacks)
  check('the fallback names both ids', 
    aligned.nameFallbacks[0].idA === 'label_uuid_a' && aligned.nameFallbacks[0].idB === 'label_uuid_b')
  check('names differing only in case and spacing still align',
    alignTaxonomies([cls('x', 'Petri  Dish')], [cls('y', 'petri dish')]).nameFallbacks.length === 1)

  // ACCEPTANCE: boxes on that class now match.
  const boxesA = applyTaxonomy([box('a1', 'label_uuid_a', 0, 0, 100, 100)], aligned)
  const boxesB = applyTaxonomy([box('b1', 'label_uuid_b', 5, 5, 100, 100)], aligned)
  const matched = matchBoxes(boxesA, boxesB, 0.5)
  check('two boxes on the same-named custom class now match', matched.matched.length === 1,
    { matched: matched.matched.length, onlyA: matched.onlyA.length, onlyB: matched.onlyB.length })

  // Id is authoritative: it wins over a name match.
  const idWins = alignTaxonomies(
    [cls('shared', 'Bottle'), cls('other_a', 'Tip')],
    [cls('shared', 'Renamed Bottle'), cls('other_b', 'Tip')],
  )
  check('a shared id aligns even when the names differ',
    idWins.keys.get('shared') === 'shared' && idWins.nameFallbacks.length === 1, idWins.nameFallbacks)

  // Classes in only one taxonomy.
  const lopsided = alignTaxonomies([...seedsA, cls('a_only', 'Petri Dish')], [...seedsB, cls('b_only', 'Slide')])
  check('a class only A has is reported',
    lopsided.onlyInA.length === 1 && lopsided.onlyInA[0].name === 'Petri Dish', lopsided.onlyInA)
  check('a class only B has is reported',
    lopsided.onlyInB.length === 1 && lopsided.onlyInB[0].name === 'Slide', lopsided.onlyInB)
  check('a one-sided class still gets a display entry, so it never renders as a raw id',
    lopsided.display.get('b_only')?.name === 'Slide', lopsided.display.get('b_only'))

  // A duplicated name cannot claim two partners.
  const dup = alignTaxonomies([cls('a1', 'Dish'), cls('a2', 'Dish')], [cls('b1', 'Dish')])
  check('a duplicated name only claims one partner', dup.nameFallbacks.length === 1, dup.nameFallbacks)
  check('and the loser is reported as one-sided', dup.onlyInA.length === 1, dup.onlyInA)
}

console.log('\npolygons are excluded, not approximated')
{
  const store = createStore()
  const actions = createActions(store)
  actions.openImage({ fileName: 'x.png', width: 1000, height: 1000 })
  actions.addAnnotation({ type: 'bbox', labelId: 'label_reagent_bottle', geometry: G(0, 0, 10, 10) })
  actions.addAnnotation({
    type: 'polygon',
    labelId: 'label_pipette_tip',
    geometry: { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }] },
  })
  const boxes = boxesOf(store.getDocument())
  check('ACCEPTANCE: polygons are skipped by the box extractor', boxes.length === 1, boxes.length)
  check('the bbox survives', boxes[0].labelId === 'label_reagent_bottle')
  check('and the document still holds both', store.getDocument().annotations.length === 2)
}

console.log('')
if (failures > 0) throw new Error(`${failures} check(s) failed`)
console.log('all agreement checks passed\n')
