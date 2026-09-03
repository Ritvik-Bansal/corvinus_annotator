// Top bar and status bar. Plain DOM, no canvas.
//
// Both only touch the DOM when a rendered string actually changed. The status
// bar is updated once per animation frame, so without that guard a pan would
// write to the DOM 60 times a second for no visible difference.

import type { ImageMeta, Point, Viewport } from '../state/types.ts'

export interface TopBar {
  update(image: ImageMeta): void
  showError(message: string): void
}

export function createTopBar(
  fileInput: HTMLInputElement,
  nameEl: HTMLElement,
  onFile: (file: File) => void,
): TopBar {
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0]
    if (file === undefined) return
    onFile(file)
    // Reset so picking the same file twice still fires a change event.
    fileInput.value = ''
  })

  let lastText = ''

  return {
    update(image: ImageMeta): void {
      const text =
        image.fileName === ''
          ? 'No image loaded'
          : `${image.fileName}   ${image.width} x ${image.height}`
      if (text === lastText) return
      lastText = text
      nameEl.textContent = text
      nameEl.classList.remove('is-error')
    },
    showError(message: string): void {
      lastText = message
      nameEl.textContent = message
      nameEl.classList.add('is-error')
    },
  }
}

export interface StatusBar {
  update(viewport: Viewport, cursor: Point | null, frameMs: number): void
}

export function createStatusBar(
  zoomEl: HTMLElement,
  cursorEl: HTMLElement,
  frameEl: HTMLElement,
): StatusBar {
  let lastZoom = ''
  let lastCursor = ''
  let lastFrame = ''

  return {
    update(viewport: Viewport, cursor: Point | null, frameMs: number): void {
      const zoom = `Zoom: ${formatZoom(viewport.scale)}`
      if (zoom !== lastZoom) {
        lastZoom = zoom
        zoomEl.textContent = zoom
      }

      // Image coordinates, not screen coordinates — that is the whole point of
      // the readout. Values outside the image are shown rather than hidden.
      const position =
        cursor === null ? 'X: -   Y: -' : `X: ${Math.round(cursor.x)}   Y: ${Math.round(cursor.y)}`
      if (position !== lastCursor) {
        lastCursor = position
        cursorEl.textContent = position
      }

      const frame = `${frameMs.toFixed(2)} ms/frame`
      if (frame !== lastFrame) {
        lastFrame = frame
        frameEl.textContent = frame
      }
    },
  }
}

/** Sub-1% zooms would read as "0%", so keep a decimal while very zoomed out. */
function formatZoom(scale: number): string {
  const percent = scale * 100
  return percent < 10 ? `${percent.toFixed(1)}%` : `${Math.round(percent)}%`
}
