// Verification for the coordinate math. Run with: npm run check
// No DOM and no Node APIs — the whole point of keeping this module pure.

import {
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  fitToViewport,
  imageToScreen,
  panBy,
  screenToImage,
  zoomAt,
} from './viewport.ts'
import { createStore } from '../state/store.ts'
import { createActions } from '../state/actions.ts'
import type { Point, Viewport } from '../state/types.ts'

let failures = 0

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ok    ${label}`)
  } else {
    console.log(`  FAIL  ${label}`)
    failures += 1
  }
}

/** Floating point: compare within a sub-pixel tolerance rather than exactly. */
function near(a: number, b: number, tolerance = 1e-9): boolean {
  return Math.abs(a - b) < tolerance
}

function nearPoint(a: Point, b: Point, tolerance = 1e-9): boolean {
  return near(a.x, b.x, tolerance) && near(a.y, b.y, tolerance)
}

// A spread of viewports: identity, zoomed out, zoomed in, panned, awkward scale.
const VIEWPORTS: Viewport[] = [
  { scale: 1, offsetX: 0, offsetY: 0 },
  { scale: 0.25, offsetX: 140, offsetY: -60 },
  { scale: 8, offsetX: -3200, offsetY: -1875 },
  { scale: 0.13337, offsetX: -17.5, offsetY: 903.25 },
  { scale: 3.5, offsetX: 1024, offsetY: 768 },
]

const POINTS: Point[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
  { x: 1200, y: 800 },
  { x: 3999, y: 2999 },
  { x: -55.5, y: 1234.75 },
]

console.log('\ncoordinate round trip')
{
  let allExact = true
  for (const viewport of VIEWPORTS) {
    for (const point of POINTS) {
      const back = screenToImage(imageToScreen(point, viewport), viewport)
      if (!nearPoint(back, point, 1e-6)) allExact = false
    }
  }
  check('screenToImage(imageToScreen(p)) === p for all viewports x points', allExact)

  let inverseExact = true
  for (const viewport of VIEWPORTS) {
    for (const point of POINTS) {
      const back = imageToScreen(screenToImage(point, viewport), viewport)
      if (!nearPoint(back, point, 1e-6)) inverseExact = false
    }
  }
  check('imageToScreen(screenToImage(p)) === p (the other direction)', inverseExact)
}

console.log('\nreadout matches the cursor after panning')
{
  // The acceptance criterion, stated as math: pan, then ask what image pixel is
  // under a known screen position, then confirm that pixel maps back to it.
  let ok = true
  let viewport: Viewport = { scale: 1, offsetX: 0, offsetY: 0 }
  viewport = zoomAt(viewport, { x: 400, y: 300 }, 4)
  viewport = panBy(viewport, -250, 130)
  viewport = zoomAt(viewport, { x: 900, y: 120 }, 0.3)
  viewport = panBy(viewport, 44, -18)

  for (const screen of POINTS) {
    const image = screenToImage(screen, viewport)
    if (!nearPoint(imageToScreen(image, viewport), screen, 1e-6)) ok = false
  }
  check('after zoom+pan+zoom+pan the mapping is still exact', ok)
}

console.log('\nzoom is anchored to the cursor')
{
  let anchored = true
  const cursors: Point[] = [
    { x: 0, y: 0 },
    { x: 640, y: 360 },
    { x: 1919, y: 1079 },
  ]
  for (const viewport of VIEWPORTS) {
    for (const cursor of cursors) {
      for (const factor of [1.1, 0.9, 2, 0.5, 1.0001]) {
        const before = screenToImage(cursor, viewport)
        const next = zoomAt(viewport, cursor, factor)
        const after = screenToImage(cursor, next)
        // Tolerance is loose here only because large scales amplify float error.
        if (!nearPoint(before, after, 1e-6)) anchored = false
      }
    }
  }
  check('the image point under the cursor is unchanged by zoom', anchored)

  // Repeated zoom should not drift, which is what a user would actually notice.
  let viewport: Viewport = { scale: 1, offsetX: 0, offsetY: 0 }
  const cursor: Point = { x: 512, y: 384 }
  const start = screenToImage(cursor, viewport)
  for (let i = 0; i < 200; i += 1) viewport = zoomAt(viewport, cursor, 1.02)
  for (let i = 0; i < 200; i += 1) viewport = zoomAt(viewport, cursor, 1 / 1.02)
  const end = screenToImage(cursor, viewport)
  check('400 zoom steps in and back out do not drift the anchor', nearPoint(start, end, 1e-6))
  check('and the scale returns to where it started', near(viewport.scale, 1, 1e-9))
}

console.log('\nscale clamping')
{
  check('clamps below the minimum', clampScale(0.000001) === MIN_SCALE)
  check('clamps above the maximum', clampScale(100000) === MAX_SCALE)
  check('leaves a normal scale alone', clampScale(1.5) === 1.5)

  let viewport: Viewport = { scale: 1, offsetX: 0, offsetY: 0 }
  for (let i = 0; i < 500; i += 1) viewport = zoomAt(viewport, { x: 10, y: 10 }, 1.2)
  check('zooming in forever stops at MAX_SCALE', viewport.scale === MAX_SCALE)
  for (let i = 0; i < 1000; i += 1) viewport = zoomAt(viewport, { x: 10, y: 10 }, 0.8)
  check('zooming out forever stops at MIN_SCALE', viewport.scale === MIN_SCALE)
}

console.log('\npan')
{
  const viewport: Viewport = { scale: 3, offsetX: 10, offsetY: 20 }
  const panned = panBy(viewport, -40, 25)
  check('pan shifts the offset by exactly the screen delta', panned.offsetX === -30 && panned.offsetY === 45)
  check('pan does not change scale', panned.scale === 3)
  check('pan does not mutate the input', viewport.offsetX === 10)
}

console.log('\nfit on load')
{
  // A 12 megapixel phone photo in a laptop-sized viewport.
  const image = { width: 4032, height: 3024 }
  const screen = { width: 1280, height: 720 }
  const viewport = fitToViewport(image, screen)

  const drawn = { width: image.width * viewport.scale, height: image.height * viewport.scale }
  check('fitted image is inside the viewport', drawn.width <= screen.width && drawn.height <= screen.height)
  check('fitted image is centred horizontally', near(viewport.offsetX * 2 + drawn.width, screen.width, 1e-6))
  check('fitted image is centred vertically', near(viewport.offsetY * 2 + drawn.height, screen.height, 1e-6))

  const small = fitToViewport({ width: 32, height: 32 }, screen)
  check('a tiny image is not blown up past 1:1', small.scale === 1)
}

console.log('\nundo does not touch the viewport')
{
  const store = createStore()
  const actions = createActions(store)

  store.setSession({ viewport: { scale: 7.25, offsetX: -420, offsetY: 88 } })
  const parked = store.getSession().viewport

  actions.addAnnotation({
    type: 'bbox',
    labelId: 'label_reagent_bottle',
    geometry: { x: 0, y: 0, width: 10, height: 10 },
  })
  store.undo()
  store.redo()
  store.undo()

  const now = store.getSession().viewport
  check('viewport survives undo and redo untouched', JSON.stringify(now) === JSON.stringify(parked))
  check('and it is not in the document', !('viewport' in store.getDocument()))
}

console.log('')
if (failures > 0) {
  throw new Error(`${failures} check(s) failed`)
}
console.log('all viewport checks passed\n')
