// Top bar and status bar. Plain DOM, no canvas.
//
// Both only touch the DOM when a rendered string actually changed. The status
// bar is updated once per animation frame, so without that guard a pan would
// write to the DOM 60 times a second for no visible difference.

import type { ImageMeta, Point, ToolId, Viewport } from '../state/types.ts'

export interface TopBar {
  update(image: ImageMeta): void
  showError(message: string): void
  /** Import/export feedback, shown separately so it never eats the file name. */
  showMessage(message: string, isError: boolean): void
}

export function createTopBar(
  fileInput: HTMLInputElement,
  nameEl: HTMLElement,
  messageEl: HTMLElement,
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
    showMessage(message: string, isError: boolean): void {
      messageEl.textContent = message
      messageEl.classList.toggle('is-error', isError)
    },
  }
}

/** Brush size control. Only shown while the brush or eraser is the active tool. */
export interface BrushControl {
  update(activeTool: ToolId, radius: number): void
}

export function createBrushControl(
  wrapper: HTMLElement,
  slider: HTMLInputElement,
  valueEl: HTMLElement,
  onChange: (radius: number) => void,
): BrushControl {
  slider.addEventListener('input', () => onChange(Number(slider.value)))
  let lastText = ''
  return {
    update(activeTool: ToolId, radius: number): void {
      wrapper.hidden = activeTool !== 'brush' && activeTool !== 'erase'
      if (String(radius) !== slider.value) slider.value = String(radius)
      const text = `${radius} px`
      if (text !== lastText) {
        lastText = text
        valueEl.textContent = text
      }
    },
  }
}

export interface StatusBar {
  update(count: number, viewport: Viewport, cursor: Point | null, timing: FrameTiming): void
}

export interface FrameTiming {
  /** Real end-to-end cost: median gap between animation frames. */
  intervalMs: number
  /** Our draw code only, excluding GPU work. A fraction of the interval. */
  drawMs: number
}

export function createStatusBar(
  countEl: HTMLElement,
  zoomEl: HTMLElement,
  cursorEl: HTMLElement,
  frameEl: HTMLElement,
): StatusBar {
  let lastCount = ''
  let lastZoom = ''
  let lastCursor = ''
  let lastFrame = ''

  return {
    update(count: number, viewport: Viewport, cursor: Point | null, timing: FrameTiming): void {
      const countText = `${count} annotation${count === 1 ? '' : 's'}`
      if (countText !== lastCount) {
        lastCount = countText
        countEl.textContent = countText
      }

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

      // Two numbers, because one alone lies. The interval is what the user
      // feels; the draw time is what our code is responsible for.
      // Microseconds for the draw cost: it is genuinely tens of µs, and two
      // decimal places of milliseconds rounds that to a misleading "0.00".
      const frame = `${timing.intervalMs.toFixed(1)} ms/frame  ·  ${Math.round(timing.drawMs * 1000)} µs draw`
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
