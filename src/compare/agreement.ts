// Inter-annotator agreement: IoU and greedy matching.
//
// Pure on purpose. No DOM, no store, no canvas — this is the part that has to
// be correct, so it is the part that gets unit checks.
//
// SCOPE: bounding boxes only. Polygons and masks are counted and reported as
// not compared rather than approximated, because an IoU between a polygon and
// a box would be a number that looks meaningful and isn't.

import type { BboxGeometry, ReadonlyDocument } from '../state/types.ts'

export interface BoxRef {
  id: string
  labelId: string
  geometry: BboxGeometry
}

export interface Pair {
  a: BoxRef
  b: BoxRef
  iou: number
}

export interface MatchResult {
  matched: Pair[]
  onlyA: BoxRef[]
  onlyB: BoxRef[]
}

export function area(box: BboxGeometry): number {
  return Math.max(0, box.width) * Math.max(0, box.height)
}

/** Zero when the boxes do not overlap, including when they merely touch. */
export function intersectionArea(a: BboxGeometry, b: BboxGeometry): number {
  const left = Math.max(a.x, b.x)
  const top = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

/**
 * Intersection over union. 1 means identical, 0 means disjoint.
 * Two zero-area boxes are treated as no agreement rather than as 0/0.
 */
export function iou(a: BboxGeometry, b: BboxGeometry): number {
  const intersection = intersectionArea(a, b)
  const union = area(a) + area(b) - intersection
  return union <= 0 ? 0 : intersection / union
}

/** Every bbox in a document, in order. Polygons are skipped. */
export function boxesOf(document: ReadonlyDocument): BoxRef[] {
  const boxes: BoxRef[] = []
  for (const annotation of document.annotations) {
    if (annotation.type !== 'bbox') continue
    boxes.push({
      id: annotation.id,
      labelId: annotation.labelId,
      geometry: { ...annotation.geometry },
    })
  }
  return boxes
}

/**
 * Greedy matching: score every same-class pair, take the best above the
 * threshold, remove both boxes, repeat.
 *
 * Greedy is not guaranteed optimal — a maximum-weight bipartite matching
 * (Hungarian) can score higher in contrived cases. It is what COCO-style
 * evaluation does, it is O(n^2 log n) and explainable in a sentence, and the
 * cases where it differs need three boxes overlapping each other so heavily
 * that the annotators disagree about how many objects there are.
 *
 * Ties are broken by id so the result is deterministic run to run.
 */
export function matchBoxes(a: BoxRef[], b: BoxRef[], threshold: number): MatchResult {
  const candidates: Pair[] = []
  for (const boxA of a) {
    for (const boxB of b) {
      // Different classes are never a match: disagreeing about the class IS a
      // disagreement, and should show as one-only on both sides.
      if (boxA.labelId !== boxB.labelId) continue
      const score = iou(boxA.geometry, boxB.geometry)
      if (score < threshold || score <= 0) continue
      candidates.push({ a: boxA, b: boxB, iou: score })
    }
  }

  candidates.sort(
    (x, y) => y.iou - x.iou || x.a.id.localeCompare(y.a.id) || x.b.id.localeCompare(y.b.id),
  )

  const usedA = new Set<string>()
  const usedB = new Set<string>()
  const matched: Pair[] = []
  for (const pair of candidates) {
    if (usedA.has(pair.a.id) || usedB.has(pair.b.id)) continue
    usedA.add(pair.a.id)
    usedB.add(pair.b.id)
    matched.push(pair)
  }

  return {
    matched,
    onlyA: a.filter((box) => !usedA.has(box.id)),
    onlyB: b.filter((box) => !usedB.has(box.id)),
  }
}

export interface Summary {
  matched: number
  onlyA: number
  onlyB: number
  /** Mean IoU across matched pairs. 0 when nothing matched. */
  meanIoU: number
}

export function summarize(result: MatchResult): Summary {
  const total = result.matched.reduce((sum, pair) => sum + pair.iou, 0)
  return {
    matched: result.matched.length,
    onlyA: result.onlyA.length,
    onlyB: result.onlyB.length,
    meanIoU: result.matched.length === 0 ? 0 : total / result.matched.length,
  }
}

/**
 * The same numbers per class. This is the useful view: it tells you which part
 * of the taxonomy the annotators actually disagree about.
 * Classes with nothing on either side are omitted.
 */
export function summarizeByClass(result: MatchResult): Map<string, Summary> {
  const byClass = new Map<string, MatchResult>()
  const bucket = (labelId: string): MatchResult => {
    let entry = byClass.get(labelId)
    if (entry === undefined) {
      entry = { matched: [], onlyA: [], onlyB: [] }
      byClass.set(labelId, entry)
    }
    return entry
  }
  for (const pair of result.matched) bucket(pair.a.labelId).matched.push(pair)
  for (const box of result.onlyA) bucket(box.labelId).onlyA.push(box)
  for (const box of result.onlyB) bucket(box.labelId).onlyB.push(box)

  const out = new Map<string, Summary>()
  for (const [labelId, entry] of byClass) out.set(labelId, summarize(entry))
  return out
}

export interface NotCompared {
  polygonsA: number
  polygonsB: number
  maskClassesA: number
  maskClassesB: number
}

/** Pairs worst-first: the weakest agreement is what you actually want to look at. */
export function worstFirst(result: MatchResult): Pair[] {
  return [...result.matched].sort((x, y) => x.iou - y.iou || x.a.id.localeCompare(y.a.id))
}
