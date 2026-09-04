// Inter-annotator agreement: IoU and greedy matching.
//
// Pure on purpose. No DOM, no store, no canvas — this is the part that has to
// be correct, so it is the part that gets unit checks.
//
// SCOPE: bounding boxes only. Polygons and masks are counted and reported as
// not compared rather than approximated, because an IoU between a polygon and
// a box would be a number that looks meaningful and isn't.

import type { BboxGeometry, ReadonlyDocument } from '../state/types.ts'

// ---------------------------------------------------------------------------
// Class alignment
//
// Boxes are matched within a class, so "same class" has to be decided first.
// labelId is authoritative: the seed classes ship with stable hand-written ids
// precisely so two files agree on them. But a class each annotator created
// independently gets a fresh uuid on each side, so two boxes both labelled
// "Petri Dish" would never match on id alone. Name is therefore used as a
// fallback — and every time it fires, it is reported, because "your two files
// use different ids for the same class" is a fact about the dataset rather than
// a detail to paper over.
// ---------------------------------------------------------------------------

export interface ClassRef {
  id: string
  name: string
  color: string
}

export interface Taxonomy {
  /** labelId, from either file, to the canonical key used for matching. */
  keys: Map<string, string>
  /** Canonical key to the class to show for it. A's wins where both have one. */
  display: Map<string, ClassRef>
  /** Classes aligned by name because the two files gave them different ids. */
  nameFallbacks: Array<{ name: string; idA: string; idB: string }>
  /** Classes whose name appears in only one of the two label lists. */
  onlyInA: ClassRef[]
  onlyInB: ClassRef[]
}

/** Case and surrounding whitespace are not meaningful differences in a name. */
function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function alignTaxonomies(a: readonly ClassRef[], b: readonly ClassRef[]): Taxonomy {
  const keys = new Map<string, string>()
  const display = new Map<string, ClassRef>()
  const nameFallbacks: Taxonomy['nameFallbacks'] = []
  const onlyInA: ClassRef[] = []
  const onlyInB: ClassRef[] = []

  const bById = new Map(b.map((label) => [label.id, label]))
  const bByName = new Map<string, ClassRef>()
  for (const label of b) {
    // First wins, so a duplicated name in one file cannot claim two partners.
    if (!bByName.has(normalizeName(label.name))) bByName.set(normalizeName(label.name), label)
  }
  const claimed = new Set<string>()

  for (const labelA of a) {
    const sameId = bById.get(labelA.id)
    if (sameId !== undefined) {
      keys.set(labelA.id, labelA.id)
      display.set(labelA.id, labelA)
      claimed.add(sameId.id)
      continue
    }
    const sameName = bByName.get(normalizeName(labelA.name))
    if (sameName !== undefined && !claimed.has(sameName.id)) {
      keys.set(labelA.id, labelA.id)
      keys.set(sameName.id, labelA.id) // B's id folds into A's key
      display.set(labelA.id, labelA)
      nameFallbacks.push({ name: labelA.name, idA: labelA.id, idB: sameName.id })
      claimed.add(sameName.id)
      continue
    }
    keys.set(labelA.id, labelA.id)
    display.set(labelA.id, labelA)
    onlyInA.push(labelA)
  }

  for (const labelB of b) {
    if (claimed.has(labelB.id) || keys.has(labelB.id)) continue
    keys.set(labelB.id, labelB.id)
    display.set(labelB.id, labelB)
    onlyInB.push(labelB)
  }

  return { keys, display, nameFallbacks, onlyInA, onlyInB }
}

/** Rewrites labelIds to canonical keys, so both files speak one taxonomy. */
export function applyTaxonomy(boxes: BoxRef[], taxonomy: Taxonomy): BoxRef[] {
  return boxes.map((box) => ({ ...box, labelId: taxonomy.keys.get(box.labelId) ?? box.labelId }))
}

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
      // disagreement, and should show as one-only on both sides. Run the boxes
      // through applyTaxonomy first so this compares canonical class keys
      // rather than raw per-file ids.
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
