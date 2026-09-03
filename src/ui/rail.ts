// The left tool rail. Buttons only — keyboard lives in keyboard.ts so there is
// one place to look for every shortcut in the app.

import { ENABLED_TOOLS } from '../tools/index.ts'
import type { ToolId } from '../state/types.ts'

export interface Rail {
  update(activeTool: ToolId): void
}

export function createRail(container: HTMLElement, onSelect: (id: ToolId) => void): Rail {
  // NodeListOf is array-like but not an array, so spread it to use array methods.
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('button[data-tool]')]

  for (const button of buttons) {
    const id = button.dataset.tool as ToolId
    // Unimplemented tools are visible but inert, so the rail shows the full
    // plan without pretending polygon and brush work yet.
    button.disabled = !ENABLED_TOOLS.includes(id)
    button.addEventListener('click', () => onSelect(id))
  }

  return {
    update(activeTool: ToolId): void {
      for (const button of buttons) {
        button.classList.toggle('is-active', button.dataset.tool === activeTool)
      }
    },
  }
}
