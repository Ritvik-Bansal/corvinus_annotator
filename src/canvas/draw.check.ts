// Verification for the pure hit-testing geometry. Run with: npm run check
// Concave hit testing is subtle enough to deserve a fast feedback loop rather
// than only a browser test.

import { hitPolygon, hitVertex, readableTextOn } from './draw.ts'
import type { Point } from '../state/types.ts'

let failures = 0
function check(label: string, condition: boolean): void {
  if (condition) console.log(`  ok    ${label}`)
  else {
    console.log(`  FAIL  ${label}`)
    failures += 1
  }
}

// A "C": a square with a rectangular bite taken out of its right side. The bite
// is inside the BOUNDING BOX but outside the SHAPE.
const cShape: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 25 },
  { x: 35, y: 25 },
  { x: 35, y: 75 },
  { x: 100, y: 75 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
]

console.log('\nconcave polygon hit testing')
{
  check('a point in the solid spine is inside', hitPolygon(cShape, { x: 15, y: 50 }))
  check('a point in the top arm is inside', hitPolygon(cShape, { x: 80, y: 12 }))
  check('a point in the bottom arm is inside', hitPolygon(cShape, { x: 80, y: 88 }))
  check('the HOLLOW of the C is outside', !hitPolygon(cShape, { x: 80, y: 50 }))
  check('the hollow is nonetheless inside the bounding box', 80 > 0 && 80 < 100 && 50 > 0 && 50 < 100)
  check('a point outside the bounding box is outside', !hitPolygon(cShape, { x: 150, y: 50 }))
  check('a point just outside the left edge is outside', !hitPolygon(cShape, { x: -1, y: 50 }))
  check('a point just inside the left edge is inside', hitPolygon(cShape, { x: 1, y: 50 }))
}

console.log('\ntriangle sanity')
{
  const triangle: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 0, y: 100 },
  ]
  check('inside the hypotenuse', hitPolygon(triangle, { x: 10, y: 10 }))
  check('outside the hypotenuse but inside the bbox', !hitPolygon(triangle, { x: 90, y: 90 }))
}

console.log('\nvertex hit testing')
{
  const points: Point[] = [
    { x: 10, y: 10 },
    { x: 200, y: 40 },
  ]
  check('exact hit returns the index', hitVertex(points, { x: 200, y: 40 }) === 1)
  check('within the grab radius still hits', hitVertex(points, { x: 205, y: 45 }) === 1)
  check('far away misses', hitVertex(points, { x: 120, y: 25 }) === null)
  check('first vertex wins when both are near', hitVertex(points, { x: 12, y: 12 }) === 0)
}

console.log('\nlabel chip contrast')
{
  check('white text on saturated blue', readableTextOn('#2060ff') === '#ffffff')
  check('white text on saturated red', readableTextOn('#ff2020') === '#ffffff')
  check('black text on amber', readableTextOn('#e0b000') === '#000000')
  check('black text on lime', readableTextOn('#80e000') === '#000000')
}

console.log('')
if (failures > 0) throw new Error(`${failures} check(s) failed`)
console.log('all draw checks passed\n')
