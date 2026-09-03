// The right panel: classes, annotations, attributes. Plain DOM, no framework.
//
// RENDER POLICY (this is the interesting part):
// The panel subscribes to the store but a 'session' notification only does work
// when the *selection* or *active class* changed. Panning fires setSession on
// every pointermove, and rebuilding three lists 60 times a second would be a
// real stall — so a viewport-only change returns immediately, before touching
// the DOM at all.

import { LABEL_PALETTE, nextLabelColor } from '../state/defaults.ts'
import { maskedLabelIds } from '../state/masks.ts'
import type { RemoveLabelResult } from '../state/actions.ts'
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
  /** Null clears the highlight. */
  highlightMask(labelId: string | null): void
  selectAnnotation(id: string | null): void
  addLabel(name: string, color: string, attributes: AttributeDef[]): string
  removeLabel(labelId: string, cascade: boolean): RemoveLabelResult
  setAttribute(annotationId: string, key: string, value: AttributeValue): void
}

export interface SidebarElements {
  classList: HTMLElement
  addClassButton: HTMLButtonElement
  classForm: HTMLFormElement
  classNameInput: HTMLInputElement
  classSwatches: HTMLElement
  classAttrRows: HTMLElement
  addAttrButton: HTMLButtonElement
  cancelClassButton: HTMLButtonElement
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

  elements.addClassButton.addEventListener('click', openClassForm)
  elements.cancelClassButton.addEventListener('click', closeClassForm)
  elements.addAttrButton.addEventListener('click', addAttrRow)
  elements.classForm.addEventListener('submit', (event) => {
    event.preventDefault() // never navigate; required fields are already validated
    const name = elements.classNameInput.value.trim()
    if (name === '') return
    deps.addLabel(name, pendingColor, collectAttributes())
    closeClassForm()
  })

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
    // A div, not a button: the delete control is a button and nesting buttons
    // is invalid HTML.
    const row = document.createElement('div')
    row.className = 'row class-row' + (active ? ' is-active' : '')
    row.dataset.labelId = label.id

    const main = document.createElement('button')
    main.type = 'button'
    main.className = 'row-main'
    const swatch = document.createElement('span')
    swatch.className = 'swatch'
    swatch.style.background = label.color
    const name = document.createElement('span')
    name.className = 'row-name'
    name.textContent = label.name // textContent, never innerHTML: names are user input
    main.append(swatch, name)
    main.addEventListener('click', () => deps.setActiveLabel(label.id))
    row.append(main)

    if (index < 9) {
      const hint = document.createElement('kbd')
      hint.textContent = String(index + 1) // doubles as documentation for the shortcut
      row.append(hint)
    }

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'row-delete'
    remove.title = `Delete ${label.name}`
    remove.textContent = '\u00d7'
    remove.addEventListener('click', (event) => {
      event.stopPropagation()
      handleRemoveClass(label.id, label.name)
    })
    row.append(remove)
    return row
  }

  /**
   * Uses removeLabel's refuse-then-cascade contract: the first call reports what
   * would be destroyed, and only an explicit confirmation passes cascade. The
   * cascade goes through commit(), so a mistaken confirmation is one undo away.
   */
  function handleRemoveClass(labelId: string, name: string): void {
    const first = deps.removeLabel(labelId, false)
    if (first.removed) return
    if (first.reason === 'not-found') return

    const parts: string[] = []
    if (first.annotations > 0) {
      parts.push(`${first.annotations} annotation${first.annotations === 1 ? '' : 's'}`)
    }
    if (first.strokes > 0) {
      parts.push(`${first.strokes} stroke${first.strokes === 1 ? '' : 's'}`)
    }
    const confirmed = window.confirm(
      `Delete the class "${name}"?\n\n` +
        `${parts.join(' and ')} use this class and will be deleted too.\n\n` +
        `This can be undone with Ctrl+Z.`,
    )
    if (confirmed) deps.removeLabel(labelId, true)
  }

  // -------------------------------------------------------------------------
  // Add-class form
  //
  // The type is a dropdown rather than free text on purpose: a value that
  // cannot be typed cannot be mistyped, so "bollean" silently becoming a text
  // field is not a failure mode that exists any more. Same principle as the
  // paint/erase stroke union — make the wrong version unconstructible instead
  // of validating after the fact.
  // -------------------------------------------------------------------------

  let pendingColor = LABEL_PALETTE[0]

  function openClassForm(): void {
    const used = deps.getDocument().labels.map((l) => l.color)
    pendingColor = nextLabelColor(used)
    elements.classNameInput.value = ''
    elements.classAttrRows.replaceChildren()
    renderSwatches()
    elements.addClassButton.hidden = true
    elements.classForm.hidden = false
    elements.classNameInput.focus()
  }

  function closeClassForm(): void {
    // Move focus out BEFORE hiding. A focused element inside a hidden subtree
    // keeps receiving key events, and the keyboard handler ignores keys aimed
    // at an <input> — so every tool shortcut would be silently swallowed until
    // the user happened to click somewhere else.
    const focused = document.activeElement
    if (focused instanceof HTMLElement && elements.classForm.contains(focused)) focused.blur()
    elements.classForm.hidden = true
    elements.addClassButton.hidden = false
  }

  function renderSwatches(): void {
    elements.classSwatches.replaceChildren(
      ...LABEL_PALETTE.map((color) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'swatch-option' + (color === pendingColor ? ' is-chosen' : '')
        button.style.background = color
        button.title = color
        button.addEventListener('click', () => {
          pendingColor = color
          renderSwatches()
        })
        return button
      }),
    )
  }

  function addAttrRow(): void {
    const row = document.createElement('div')
    row.className = 'attr-row'

    const name = document.createElement('input')
    name.type = 'text'
    name.placeholder = 'Attribute name'
    name.required = true // native validation; no custom error UI needed
    name.autocomplete = 'off'

    const type = document.createElement('select')
    for (const [value, text] of [
      ['text', 'Text'],
      ['number', 'Number'],
      ['boolean', 'Yes/No'],
      ['enum', 'Options'],
    ]) {
      const option = document.createElement('option')
      option.value = value
      option.textContent = text
      type.append(option)
    }

    const options = document.createElement('input')
    options.type = 'text'
    options.className = 'attr-options'
    options.placeholder = 'Open | Closed'
    options.hidden = true

    type.addEventListener('change', () => {
      const isEnum = type.value === 'enum'
      options.hidden = !isEnum
      // Required only while it is showing, so an Options row cannot be created
      // with nothing to choose from.
      options.required = isEnum
    })

    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'attr-remove'
    remove.textContent = '\u00d7'
    remove.addEventListener('click', () => row.remove())

    row.append(name, type, options, remove)
    elements.classAttrRows.append(row)
    name.focus()
  }

  function collectAttributes(): AttributeDef[] {
    const definitions: AttributeDef[] = []
    for (const row of elements.classAttrRows.querySelectorAll('.attr-row')) {
      const name = row.querySelector('input:not(.attr-options)')
      const type = row.querySelector('select')
      const options = row.querySelector('.attr-options')
      if (!(name instanceof HTMLInputElement) || !(type instanceof HTMLSelectElement)) continue
      const label = name.value.trim()
      if (label === '') continue
      const key = toKey(label)

      if (type.value === 'enum' && options instanceof HTMLInputElement) {
        const values = options.value
          .split('|')
          .map((o) => o.trim())
          .filter((o) => o !== '')
        if (values.length > 0) definitions.push({ key, name: label, type: 'enum', options: values })
        continue
      }
      if (type.value === 'number') definitions.push({ key, name: label, type: 'number' })
      else if (type.value === 'boolean') definitions.push({ key, name: label, type: 'boolean' })
      else definitions.push({ key, name: label, type: 'text' })
    }
    return definitions
  }

  // -------------------------------------------------------------------------
  // Annotations
  // -------------------------------------------------------------------------

  function renderAnnotations(): void {
    const document_ = deps.getDocument()
    const session = deps.getSession()

    const rows: HTMLElement[] = document_.annotations.map((annotation) =>
      annotationRow(annotation, document_, annotation.id === session.selectedAnnotationId),
    )
    // Masks come after the instances. One row per painted CLASS, not per
    // stroke: five more Microplate strokes is still one Microplate mask.
    for (const labelId of maskedLabelIds(document_)) {
      const label = document_.labels.find((l) => l.id === labelId)
      if (label === undefined) continue
      rows.push(maskRow(label, labelId === session.activeLabelId))
    }

    if (rows.length === 0) {
      elements.annotationList.replaceChildren(emptyMessage('Nothing annotated yet.'))
      return
    }
    elements.annotationList.replaceChildren(...rows)
  }

  /**
   * A mask row selects its CLASS rather than an instance, because a mask has no
   * instance to select — the useful next action is to keep painting it.
   */
  function maskRow(label: DeepLabel, active: boolean): HTMLElement {
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'row annotation-row mask-row' + (active ? ' is-active' : '')
    row.dataset.maskLabelId = label.id

    const swatch = document.createElement('span')
    swatch.className = 'swatch'
    swatch.style.background = label.color
    const name = document.createElement('span')
    name.className = 'row-name'
    name.textContent = label.name
    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.textContent = 'mask'
    row.append(swatch, name, badge)

    row.addEventListener('click', () => {
      // Masks carry no attributes, so leaving a previously selected box
      // selected would keep its attribute fields on screen and make this click
      // look like it did nothing.
      deps.selectAnnotation(null)
      deps.setActiveLabel(label.id)
    })
    row.addEventListener('mouseenter', () => deps.highlightMask(label.id))
    row.addEventListener('mouseleave', () => deps.highlightMask(null))
    return row
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
