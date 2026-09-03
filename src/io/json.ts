// The file format: serialising out, and parsing + validating in.
//
// This module is the ONLY place the on-disk shape and the in-memory shape
// differ. They are almost identical — which is the point of having designed the
// document as the file format — with one deliberate exception: polygon and
// stroke points are [x, y] pairs on disk and { x, y } objects in memory. Pairs
// are what CV tooling expects and roughly halve the file; objects keep the
// drawing code readable. Both mappings live here and nowhere else.
//
// Nothing in here repairs anything. A file that does not match is refused with
// a message that says what to do about it.

import { DOCUMENT_VERSION } from '../state/types.ts'
import type {
  AnnotationDocument,
  AttributeValue,
  ImageMeta,
  Point,
  ReadonlyDocument,
} from '../state/types.ts'

export type ImportResult =
  | { ok: true; document: AnnotationDocument }
  | { ok: false; message: string }

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/**
 * Keys are written in the documented order rather than spread, so the file
 * reads top-down the way the schema is described.
 */
export function serializeDocument(document: ReadonlyDocument): string {
  const wire = {
    version: DOCUMENT_VERSION,
    exportedAt: new Date().toISOString(),
    image: {
      fileName: document.image.fileName,
      width: document.image.width,
      height: document.image.height,
    },
    labels: document.labels.map((label) => ({
      id: label.id,
      index: label.index,
      name: label.name,
      color: label.color,
      // Custom classes only survive a round trip because of this array, so it
      // is written whole, never trimmed.
      attributes: label.attributes.map((def) => ({
        key: def.key,
        name: def.name,
        type: def.type,
        ...(def.type === 'number'
          ? { ...(def.min === undefined ? {} : { min: def.min }),
              ...(def.max === undefined ? {} : { max: def.max }),
              ...(def.unit === undefined ? {} : { unit: def.unit }) }
          : {}),
        ...(def.type === 'enum' ? { options: [...def.options] } : {}),
        ...(def.default === undefined ? {} : { default: def.default }),
      })),
    })),
    annotations: document.annotations.map((annotation) => ({
      id: annotation.id,
      type: annotation.type,
      labelId: annotation.labelId,
      attributes: { ...annotation.attributes },
      geometry:
        annotation.type === 'bbox'
          ? {
              x: annotation.geometry.x,
              y: annotation.geometry.y,
              width: annotation.geometry.width,
              height: annotation.geometry.height,
            }
          : { points: annotation.geometry.points.map((p) => [p.x, p.y]) },
      createdAt: annotation.createdAt,
      updatedAt: annotation.updatedAt,
    })),
    // Empty until the brush exists. Written and read regardless, so a file made
    // by a later build still round-trips through this one.
    strokes: document.strokes.map((stroke) => ({
      id: stroke.id,
      mode: stroke.mode,
      labelId: stroke.labelId,
      radius: stroke.radius,
      points: stroke.points.map((p) => [p.x, p.y]),
    })),
  }
  // 2-space indent and a trailing newline: the file is meant to be opened and read.
  return `${inlinePointPairs(JSON.stringify(wire, null, 2))}\n`
}

/**
 * Collapses [x, y] pairs back onto one line. JSON.stringify's indenting puts
 * every coordinate on its own line, which turns a 50-vertex polygon into 200
 * lines and makes the file far less readable than the schema it implements.
 * Only matches arrays of exactly two bare numbers, so string arrays such as
 * enum options are left alone.
 */
function inlinePointPairs(json: string): string {
  return json.replace(
    /\[\n\s+(-?\d[\d.eE+-]*),\n\s+(-?\d[\d.eE+-]*)\n\s+\]/g,
    (_match, x: string, y: string) => `[${x}, ${y}]`,
  )
}

/** "bench_run_04.png" -> "bench_run_04.json" */
export function exportFileName(imageFileName: string): string {
  if (imageFileName === '') return 'annotations.json'
  const dot = imageFileName.lastIndexOf('.')
  return `${dot === -1 ? imageFileName : imageFileName.slice(0, dot)}.json`
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function fail(message: string): ImportResult {
  return { ok: false, message }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPoints(value: unknown, where: string): Point[] | string {
  if (!Array.isArray(value)) return `${where} must be an array of [x, y] pairs.`
  const points: Point[] = []
  for (const entry of value) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'number' ||
      typeof entry[1] !== 'number' ||
      !Number.isFinite(entry[0]) ||
      !Number.isFinite(entry[1])
    ) {
      return `${where} must contain [x, y] pairs of numbers; found ${JSON.stringify(entry)}.`
    }
    points.push({ x: entry[0], y: entry[1] })
  }
  return points
}

/**
 * `openImage` is the image currently loaded. Import is checked against it
 * because coordinates are in image pixels and are meaningless against a
 * different-sized image — and this app never rescales to make them fit.
 */
export function parseDocument(text: string, openImage: ImageMeta | null): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown parse error'
    return fail(`That file isn't valid JSON (${detail}). Pick a file exported by this app.`)
  }

  if (!isObject(raw)) {
    return fail(
      `The top level of the file must be a JSON object, but it is ${Array.isArray(raw) ? 'an array' : typeof raw}. Pick a file exported by this app.`,
    )
  }

  if (raw.version === undefined || raw.version === null || raw.version === '') {
    return fail(
      'This file has no "version" field, so it is not an annotation export. Use a file produced by the Export JSON button.',
    )
  }

  // --- image ---------------------------------------------------------------
  if (!isObject(raw.image)) {
    return fail('This file has no "image" section, so its coordinates cannot be checked.')
  }
  const { fileName, width, height } = raw.image
  if (typeof width !== 'number' || typeof height !== 'number') {
    return fail('The "image" section must have numeric "width" and "height".')
  }
  if (openImage === null || openImage.fileName === '') {
    return fail(
      `Open an image first, then import. This file expects a ${width} x ${height} image, and coordinates are only meaningful against it.`,
    )
  }
  if (width !== openImage.width || height !== openImage.height) {
    return fail(
      `This file is for a ${width} x ${height} image, but the open image is ${openImage.width} x ${openImage.height}. Open the matching image, then import again. Coordinates are never rescaled.`,
    )
  }

  // --- labels --------------------------------------------------------------
  if (!Array.isArray(raw.labels)) {
    return fail('This file has no "labels" array. Class definitions cannot be recovered without it.')
  }
  const labels: AnnotationDocument['labels'] = []
  for (const [i, entry] of raw.labels.entries()) {
    if (!isObject(entry)) return fail(`Label ${i} is not an object.`)
    const { id, index, name, color, attributes } = entry
    if (typeof id !== 'string' || id === '') return fail(`Label ${i} is missing a string "id".`)
    if (typeof name !== 'string') return fail(`Label "${id}" is missing a string "name".`)
    if (typeof color !== 'string') return fail(`Label "${id}" is missing a string "color".`)
    if (typeof index !== 'number') return fail(`Label "${id}" is missing a numeric "index".`)
    const defs = readAttributeDefs(attributes, id)
    if (typeof defs === 'string') return fail(defs)
    labels.push({ id, index, name, color, attributes: defs })
  }
  const labelIds = new Set(labels.map((l) => l.id))

  // --- annotations ---------------------------------------------------------
  if (!Array.isArray(raw.annotations)) return fail('This file has no "annotations" array.')
  const annotations: AnnotationDocument['annotations'] = []
  for (const [i, entry] of raw.annotations.entries()) {
    if (!isObject(entry)) return fail(`Annotation ${i} is not an object.`)
    const { id, type, labelId, attributes, geometry, createdAt, updatedAt } = entry
    if (typeof id !== 'string' || id === '') return fail(`Annotation ${i} is missing a string "id".`)
    if (typeof labelId !== 'string') return fail(`Annotation "${id}" is missing a string "labelId".`)
    if (!labelIds.has(labelId)) {
      return fail(
        `Annotation "${id}" refers to class "${labelId}", which is not in this file's "labels" list. Export again from a document where that class exists.`,
      )
    }
    const values = readAttributeValues(attributes, id)
    if (typeof values === 'string') return fail(values)
    const created = typeof createdAt === 'string' ? createdAt : new Date().toISOString()
    const updated = typeof updatedAt === 'string' ? updatedAt : created

    if (type === 'bbox') {
      if (!isObject(geometry)) return fail(`Annotation "${id}" has no "geometry" object.`)
      const { x, y, width: w, height: h } = geometry
      if (
        typeof x !== 'number' || typeof y !== 'number' ||
        typeof w !== 'number' || typeof h !== 'number'
      ) {
        return fail(`Annotation "${id}" has bbox geometry that is not four numbers (x, y, width, height).`)
      }
      if (w < 0 || h < 0) {
        return fail(`Annotation "${id}" has a negative width or height. Fix the file; sizes are never repaired on import.`)
      }
      annotations.push({
        id, type: 'bbox', labelId, attributes: values,
        geometry: { x, y, width: w, height: h },
        createdAt: created, updatedAt: updated,
      })
      continue
    }

    if (type === 'polygon') {
      if (!isObject(geometry)) return fail(`Annotation "${id}" has no "geometry" object.`)
      const points = readPoints(geometry.points, `Annotation "${id}" geometry.points`)
      if (typeof points === 'string') return fail(points)
      if (points.length < 3) {
        return fail(`Annotation "${id}" is a polygon with ${points.length} points; at least 3 are needed.`)
      }
      annotations.push({
        id, type: 'polygon', labelId, attributes: values,
        geometry: { points }, createdAt: created, updatedAt: updated,
      })
      continue
    }

    return fail(`Annotation "${id}" has unknown type ${JSON.stringify(type)}. Expected "bbox" or "polygon".`)
  }

  // --- strokes -------------------------------------------------------------
  if (!Array.isArray(raw.strokes)) {
    return fail('This file has no "strokes" array. Use [] if there are no brush strokes.')
  }
  const strokes: AnnotationDocument['strokes'] = []
  for (const [i, entry] of raw.strokes.entries()) {
    if (!isObject(entry)) return fail(`Stroke ${i} is not an object.`)
    const { id, mode, labelId, radius, points: rawPoints } = entry
    if (typeof id !== 'string' || id === '') return fail(`Stroke ${i} is missing a string "id".`)
    if (typeof radius !== 'number') return fail(`Stroke "${id}" is missing a numeric "radius".`)
    const points = readPoints(rawPoints, `Stroke "${id}" points`)
    if (typeof points === 'string') return fail(points)

    if (mode === 'paint') {
      if (typeof labelId !== 'string' || !labelIds.has(labelId)) {
        return fail(`Paint stroke "${id}" refers to class ${JSON.stringify(labelId)}, which is not in this file's "labels" list.`)
      }
      strokes.push({ id, mode: 'paint', labelId, radius, points })
      continue
    }
    if (mode === 'erase') {
      // The erase-is-global rule, enforced at the boundary as well as in the types.
      if (labelId !== null) {
        return fail(`Erase stroke "${id}" must have "labelId": null — erasing affects every class.`)
      }
      strokes.push({ id, mode: 'erase', labelId: null, radius, points })
      continue
    }
    return fail(`Stroke "${id}" has unknown mode ${JSON.stringify(mode)}. Expected "paint" or "erase".`)
  }

  return {
    ok: true,
    document: {
      version: String(raw.version),
      exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : new Date().toISOString(),
      image: {
        fileName: typeof fileName === 'string' ? fileName : openImage.fileName,
        width,
        height,
      },
      labels,
      annotations,
      strokes,
    },
  }
}

/** Returns the definitions, or a message explaining the refusal. */
function readAttributeDefs(
  value: unknown,
  labelId: string,
): AnnotationDocument['labels'][number]['attributes'] | string {
  if (value === undefined) return []
  if (!Array.isArray(value)) return `Label "${labelId}" has "attributes" that is not an array.`
  const defs: AnnotationDocument['labels'][number]['attributes'] = []
  for (const entry of value) {
    if (!isObject(entry)) return `Label "${labelId}" has an attribute that is not an object.`
    const { key, name, type } = entry
    if (typeof key !== 'string' || key === '') return `Label "${labelId}" has an attribute with no "key".`
    if (typeof name !== 'string') return `Attribute "${key}" on label "${labelId}" has no "name".`

    if (type === 'number') {
      defs.push({
        key, name, type: 'number',
        ...(typeof entry.min === 'number' ? { min: entry.min } : {}),
        ...(typeof entry.max === 'number' ? { max: entry.max } : {}),
        ...(typeof entry.unit === 'string' ? { unit: entry.unit } : {}),
        ...(typeof entry.default === 'number' ? { default: entry.default } : {}),
      })
    } else if (type === 'enum') {
      if (!Array.isArray(entry.options) || entry.options.some((o) => typeof o !== 'string')) {
        return `Attribute "${key}" on label "${labelId}" is an enum without a string "options" array.`
      }
      defs.push({
        key, name, type: 'enum', options: entry.options as string[],
        ...(typeof entry.default === 'string' ? { default: entry.default } : {}),
      })
    } else if (type === 'boolean') {
      defs.push({ key, name, type: 'boolean', ...(typeof entry.default === 'boolean' ? { default: entry.default } : {}) })
    } else if (type === 'text') {
      defs.push({ key, name, type: 'text', ...(typeof entry.default === 'string' ? { default: entry.default } : {}) })
    } else {
      return `Attribute "${key}" on label "${labelId}" has unknown type ${JSON.stringify(type)}. Expected text, number, boolean or enum.`
    }
  }
  return defs
}

function readAttributeValues(
  value: unknown,
  annotationId: string,
): Record<string, AttributeValue> | string {
  if (value === undefined) return {}
  if (!isObject(value)) return `Annotation "${annotationId}" has "attributes" that is not an object.`
  const values: Record<string, AttributeValue> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string' && typeof entry !== 'number' && typeof entry !== 'boolean') {
      return `Attribute "${key}" on annotation "${annotationId}" must be text, a number or true/false.`
    }
    values[key] = entry
  }
  return values
}
