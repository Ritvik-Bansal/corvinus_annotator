// The right panel: classes, annotations, attributes. Plain DOM, no framework.
//
// RENDER POLICY (this is the interesting part):
// The panel subscribes to the store but a 'session' notification only does work
// when the *selection* or *active class* changed. Panning fires setSession on
// every pointermove, and rebuilding three lists 60 times a second would be a
// real stall — so a viewport-only change returns immediately, before touching
// the DOM at all.

import { nextLabelColor } from '../state/defaults.ts'
import type { ChangeKind } from '../state/store.ts'
import type {
  AttributeDef,
  AttributeValue,
  ReadonlyDocument,
  SessionState,
} from '../state/types.ts'

export interface SidebarDeps {
  getDocument(): ReadonlyDocument
  getSession(): SessionState
  setActiveLabel(labelId: string): void
  selectAnnotation(id: string | null): void
  addLabel(name: string, color: string, attributes: AttributeDef[]): string
  setAttribute(annotationId: string, key: string, value: AttributeValue): void
}

export interface SidebarElements {
  classList: HTMLElement
  addClassButton: HTMLButtonElement
  annotationList: HTMLElement
  attributeFields: HTMLElement
}

export interface Sidebar {
  /** Route a store notification. Cheap and early-returning for viewport churn. */
  handleChange(kind: ChangeKind): void
  renderAll(): void
}

export function createSidebar(elements: SidebarElements, deps: SidebarDeps): Sidebar {
  // Remembered so a 'session' change can tell "selection moved" from "user panned".
  let lastSelectedId: string | null = null
  let lastActiveLabelId: string | null = null

  // Which annotation the attribute fields were built for. When this is
  // unchanged we refresh values in place instead of rebuilding, so an undo
  // updates the inputs without destroying the one the user is typing in.
  let builtFor = ''
  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>()

  elements.addClassButton.addEventListener('click', handleAddClass)

  // -------------------------------------------------------------------------
  // Classes
  // -------------------------------------------------------------------------

  function renderClasses(): void {
    const document_ = deps.getDocument()
    const activeId = deps.getSession().activeLabelId
    elements.classList.replaceChildren(
      ...document_.labels.map((label, index) => classRow(label, index, label.id === activeId)),
    )
  }

  function classRow(label: DeepLabel, index: number, active: boolean): HTMLElement {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'row class-row' + (active ? ' is-active' : '')
    row.dataset.labelId = label.id
    // The number-key hint doubles as documentation for the shortcut.
    row.innerHTML =
      `<span class="swatch" style="background:${label.color}"></span>` +
      `<span class="row-name"></span>` +
      (index < 9 ? `<kbd>${index + 1}</kbd>` : '')
    const name = row.querySelector('.row-name')
    if (name !== null) name.textContent = label.name // textContent, never innerHTML: names are user input
    row.addEventListener('click', () => deps.setActiveLabel(label.id))
    return row
  }

  function handleAddClass(): void {
    const name = window.prompt('New class name')?.trim()
    if (name === undefined || name === '') return

    const spec = window.prompt(
      'Attributes for "' + name + '" (optional).\n\n' +
        'Comma separated, Name:type. Types: text, number, boolean, enum(A|B|C)\n\n' +
        'Example:  Volume:number, State:enum(Open|Closed), Sealed:boolean',
      '',
    )
    const used = deps.getDocument().labels.map((l) => l.color)
    deps.addLabel(name, nextLabelColor(used), parseAttributeSpec(spec ?? ''))
  }

  // -------------------------------------------------------------------------
  // Annotations
  // -------------------------------------------------------------------------

  function renderAnnotations(): void {
    const document_ = deps.getDocument()
    const selectedId = deps.getSession().selectedAnnotationId

    if (document_.annotations.length === 0) {
      elements.annotationList.replaceChildren(emptyMessage('No annotations yet.'))
      return
    }
    elements.annotationList.replaceChildren(
      ...document_.annotations.map((annotation) =>
        annotationRow(annotation, document_, annotation.id === selectedId),
      ),
    )
  }

  function annotationRow(
    annotation: DeepAnnotation,
    document_: ReadonlyDocument,
    selected: boolean,
  ): HTMLElement {
    const label = document_.labels.find((l) => l.id === annotation.labelId)
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'row annotation-row' + (selected ? ' is-selected' : '')
    row.dataset.annotationId = annotation.id
    row.innerHTML =
      `<span class="swatch" style="background:${label?.color ?? '#8b93a1'}"></span>` +
      `<span class="row-name"></span>` +
      `<span class="badge">${annotation.type}</span>`
    const name = row.querySelector('.row-name')
    if (name !== null) name.textContent = label?.name ?? 'Unknown class'
    row.addEventListener('click', () => deps.selectAnnotation(annotation.id))
    return row
  }

  // -------------------------------------------------------------------------
  // Attributes
  // -------------------------------------------------------------------------

  function selectedAnnotation(): DeepAnnotation | null {
    const id = deps.getSession().selectedAnnotationId
    if (id === null) return null
    return deps.getDocument().annotations.find((a) => a.id === id) ?? null
  }

  function renderAttributes(): void {
    const annotation = selectedAnnotation()
    if (annotation === null) {
      builtFor = ''
      inputs.clear()
      elements.attributeFields.replaceChildren(
        emptyMessage('Select an annotation to edit its attributes.'),
      )
      return
    }

    const label = deps.getDocument().labels.find((l) => l.id === annotation.labelId)
    const signature = `${annotation.id}:${annotation.labelId}:${label?.attributes.length ?? 0}`

    // Same annotation and same class: only the values can have changed (an undo,
    // say), so update in place and leave the focused input alone.
    if (signature === builtFor) {
      refreshValues(annotation)
      return
    }
    builtFor = signature
    inputs.clear()

    if (label === undefined || label.attributes.length === 0) {
      elements.attributeFields.replaceChildren(
        emptyMessage('This class defines no attributes.'),
      )
      return
    }
    elements.attributeFields.replaceChildren(
      ...label.attributes.map((def) => field(annotation.id, def, annotation.attributes[def.key])),
    )
  }

  function refreshValues(annotation: DeepAnnotation): void {
    for (const [key, input] of inputs) {
      // Never fight the user for the field they are typing in.
      if (document.activeElement === input) continue
      const value = annotation.attributes[key]
      if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        input.checked = value === true
      } else {
        input.value = value === undefined ? '' : String(value)
      }
    }
  }

  function field(
    annotationId: string,
    def: DeepAttributeDef,
    value: AttributeValue | undefined,
  ): HTMLElement {
    const wrapper = document.createElement('label')
    wrapper.className = 'field'

    const caption = document.createElement('span')
    caption.className = 'field-name'
    // `unit` exists only on the number variant, so it has to be narrowed first.
    const unit = def.type === 'number' ? def.unit : undefined
    caption.textContent = unit === undefined ? def.name : `${def.name} (${unit})`
    wrapper.append(caption)

    const control = buildControl(annotationId, def, value)
    inputs.set(def.key, control)
    wrapper.append(control)
    return wrapper
  }

  function buildControl(
    annotationId: string,
    def: DeepAttributeDef,
    value: AttributeValue | undefined,
  ): HTMLInputElement | HTMLSelectElement {
    if (def.type === 'enum') {
      const select = document.createElement('select')
      for (const option of def.options) {
        const element = document.createElement('option')
        element.value = option
        element.textContent = option
        select.append(element)
      }
      select.value = value === undefined ? '' : String(value)
      select.addEventListener('change', () => {
        deps.setAttribute(annotationId, def.key, select.value)
      })
      return select
    }

    const input = document.createElement('input')
    if (def.type === 'boolean') {
      input.type = 'checkbox'
      input.checked = value === true
      input.addEventListener('change', () => {
        deps.setAttribute(annotationId, def.key, input.checked)
      })
      return input
    }

    if (def.type === 'number') {
      input.type = 'number'
      if (def.min !== undefined) input.min = String(def.min)
      if (def.max !== undefined) input.max = String(def.max)
      input.value = value === undefined ? '' : String(value)
      // 'change' not 'input': fires on blur/Enter, so a completed edit is ONE
      // undo entry instead of one per keystroke.
      input.addEventListener('change', () => {
        if (input.value === '') return
        const parsed = Number(input.value)
        if (Number.isNaN(parsed)) return
        // Honour the min/max the class definition declares, so out-of-range
        // values cannot reach the exported dataset.
        const min = def.min ?? -Infinity
        const max = def.max ?? Infinity
        const clamped = Math.min(max, Math.max(min, parsed))
        if (clamped !== parsed) input.value = String(clamped)
        deps.setAttribute(annotationId, def.key, clamped)
      })
      return input
    }

    input.type = 'text'
    input.value = value === undefined ? '' : String(value)
    input.addEventListener('change', () => {
      deps.setAttribute(annotationId, def.key, input.value)
    })
    return input
  }

  // -------------------------------------------------------------------------

  function renderAll(): void {
    const session = deps.getSession()
    lastSelectedId = session.selectedAnnotationId
    lastActiveLabelId = session.activeLabelId
    renderClasses()
    renderAnnotations()
    renderAttributes()
  }

  return {
    renderAll,
    handleChange(kind: ChangeKind): void {
      if (kind === 'document') {
        renderAll()
        return
      }
      // Session change. Only selection and active class affect this panel; a
      // viewport change returns here without touching the DOM.
      const session = deps.getSession()
      if (
        session.selectedAnnotationId === lastSelectedId &&
        session.activeLabelId === lastActiveLabelId
      ) {
        return
      }
      lastSelectedId = session.selectedAnnotationId
      lastActiveLabelId = session.activeLabelId
      renderClasses()
      renderAnnotations()
      renderAttributes()
    },
  }
}

// The document is handed out read-only, so every renderer receives readonly
// views. Deriving these from ReadonlyDocument keeps them correct automatically
// if the document shape changes.
type DeepLabel = ReadonlyDocument['labels'][number]
type DeepAnnotation = ReadonlyDocument['annotations'][number]
type DeepAttributeDef = DeepLabel['attributes'][number]

function emptyMessage(text: string): HTMLElement {
  const element = document.createElement('p')
  element.className = 'empty'
  element.textContent = text
  return element
}

/**
 * Parses "Volume:number, State:enum(Open|Closed), Sealed:boolean" into
 * attribute definitions. Bare "Notes" is treated as text.
 */
export function parseAttributeSpec(spec: string): AttributeDef[] {
  const definitions: AttributeDef[] = []
  for (const part of spec.split(',')) {
    const trimmed = part.trim()
    if (trimmed === '') continue

    const separator = trimmed.indexOf(':')
    const name = (separator === -1 ? trimmed : trimmed.slice(0, separator)).trim()
    // Keep the original case: lowercasing for the type comparison would also
    // lowercase the enum options, turning enum(Open|Closed) into open/closed.
    const rawType = (separator === -1 ? 'text' : trimmed.slice(separator + 1)).trim()
    const type = rawType.toLowerCase()
    if (name === '') continue
    const key = toKey(name)

    const enumMatch = /^enum\((.*)\)$/i.exec(rawType)
    if (enumMatch !== null) {
      const options = enumMatch[1]
        .split('|')
        .map((o) => o.trim())
        .filter((o) => o !== '')
      if (options.length > 0) definitions.push({ key, name, type: 'enum', options })
      continue
    }
    if (type === 'number') definitions.push({ key, name, type: 'number' })
    else if (type === 'boolean') definitions.push({ key, name, type: 'boolean' })
    else definitions.push({ key, name, type: 'text' })
  }
  return definitions
}

/** "Liquid Level" -> "liquidLevel", so exported JSON keys stay machine friendly. */
function toKey(name: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter((w) => w !== '')
  if (words.length === 0) return 'field'
  return words
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join('')
}
