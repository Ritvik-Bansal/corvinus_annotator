// Every keyboard shortcut in the app, in one place.

import { ENABLED_TOOLS } from '../tools/index.ts'
import type { ToolId } from '../state/types.ts'

const TOOL_KEYS: Record<string, ToolId> = {
  v: 'select',
  r: 'bbox',
  p: 'polygon',
  b: 'brush',
  e: 'erase',
  h: 'pan',
}

export interface KeyboardDeps {
  setTool(id: ToolId): void
  /** 1-based position in the class list, from the number keys. */
  setActiveLabelByPosition(position: number): void
  deleteSelected(): void
  undo(): void
  redo(): void
  cancelGesture(): void
  commitGesture(): void
}

export function createKeyboard(deps: KeyboardDeps): void {
  window.addEventListener('keydown', (event: KeyboardEvent) => {
    // Never steal keys from a text field. Nothing focusable exists yet, but the
    // attribute editor is coming and this is the bug it would cause.
    const target = event.target
    if (target instanceof HTMLElement) {
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
    }

    // metaKey is Cmd on macOS, ctrlKey is Control elsewhere.
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) deps.redo()
      else deps.undo()
      return
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return

    // Backspace, not just Delete: Mac laptop keyboards send Backspace from the
    // key labelled "delete", so handling only "Delete" would do nothing there.
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      deps.deleteSelected()
      return
    }

    if (event.key === 'Escape') {
      deps.cancelGesture()
      return
    }

    // Enter finishes a multi-step gesture, e.g. closing a polygon.
    if (event.key === 'Enter') {
      event.preventDefault()
      deps.commitGesture()
      return
    }

    if (event.key >= '1' && event.key <= '9') {
      deps.setActiveLabelByPosition(Number(event.key))
      return
    }

    const tool = TOOL_KEYS[event.key.toLowerCase()]
    if (tool !== undefined && ENABLED_TOOLS.includes(tool)) deps.setTool(tool)
  })
}
