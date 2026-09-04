// The comparison sidebar: summary, per-class breakdown and the pair list.
// Plain DOM, same as the annotator's sidebar.

import { STATUS_COLORS, pairId } from './scene.ts'
import { summarize, summarizeByClass, worstFirst } from './agreement.ts'
import type { MatchResult, NotCompared, Taxonomy } from './agreement.ts'

export interface PanelElements {
  legend: HTMLElement
  summary: HTMLElement
  pairs: HTMLElement
}

export interface Panel {
  renderLegend(): void
  render(
    result: MatchResult | null,
    taxonomy: Taxonomy,
    notCompared: NotCompared,
    selectedPairId: string | null,
  ): void
}

export function createPanel(elements: PanelElements, onSelectPair: (id: string) => void): Panel {
  function legendRow(color: string, dashed: boolean, text: string): HTMLElement {
    const row = document.createElement('div')
    const swatch = document.createElement('i')
    swatch.style.borderTopColor = color
    swatch.style.borderTopStyle = dashed ? 'dashed' : 'solid'
    const caption = document.createElement('span')
    caption.textContent = text
    row.append(swatch, caption)
    return row
  }

  return {
    renderLegend(): void {
      elements.legend.replaceChildren(
        legendRow(STATUS_COLORS.matched, false, 'Matched - A (solid)'),
        legendRow(STATUS_COLORS.matched, true, 'Matched - B (dashed)'),
        legendRow(STATUS_COLORS.onlyA, false, 'A only'),
        legendRow(STATUS_COLORS.onlyB, true, 'B only'),
      )
    },

    render(result, taxonomy, notCompared, selectedPairId): void {
      // Names resolve through the merged taxonomy, not through one file's label
      // list — a class that exists only in B used to render as a raw uuid.
      const classOf = (key: string) => taxonomy.display.get(key)
      if (result === null) {
        elements.summary.replaceChildren(empty('Load an image and two JSON files.'))
        elements.pairs.replaceChildren(empty('No pairs yet.'))
        return
      }

      const totals = summarize(result)
      const grid = document.createElement('dl')
      grid.className = 'stat-grid'
      for (const [term, value] of [
        ['Matched pairs', String(totals.matched)],
        ['A only', String(totals.onlyA)],
        ['B only', String(totals.onlyB)],
        ['Mean IoU', totals.matched === 0 ? '-' : totals.meanIoU.toFixed(3)],
      ]) {
        const dt = document.createElement('dt')
        dt.textContent = term
        const dd = document.createElement('dd')
        dd.textContent = value
        grid.append(dt, dd)
      }

      // Per class: which part of the taxonomy the two annotators disagree about.
      const byClass = summarizeByClass(result)
      const table = document.createElement('table')
      table.className = 'class-table'
      const head = document.createElement('tr')
      for (const heading of ['Class', 'Match', 'A', 'B', 'IoU']) {
        const th = document.createElement('th')
        th.textContent = heading
        head.append(th)
      }
      table.append(head)
      for (const [labelId, stats] of byClass) {
        const label = classOf(labelId)
        const row = document.createElement('tr')
        const name = document.createElement('td')
        const swatch = document.createElement('span')
        swatch.className = 'swatch'
        swatch.style.background = label?.color ?? '#8b93a1'
        name.append(swatch)
        name.append(document.createTextNode(label?.name ?? labelId))
        row.append(name)
        for (const value of [
          String(stats.matched),
          String(stats.onlyA),
          String(stats.onlyB),
          stats.matched === 0 ? '-' : stats.meanIoU.toFixed(2),
        ]) {
          const cell = document.createElement('td')
          cell.textContent = value
          row.append(cell)
        }
        table.append(row)
      }

      const notes = document.createElement('div')
      notes.className = 'notes'
      notes.append(
        note(
          `Not compared: ${notCompared.polygonsA} + ${notCompared.polygonsB} polygons, ` +
            `${notCompared.maskClassesA} + ${notCompared.maskClassesB} mask classes. ` +
            `Only bounding boxes are scored.`,
        ),
      )
      // Both of these are facts about the two files' taxonomies, not about the
      // annotations, and both are easy to mistake for annotator disagreement.
      if (taxonomy.nameFallbacks.length > 0) {
        notes.append(
          note(
            `Matched by name, not id: ${taxonomy.nameFallbacks.map((f) => f.name).join(', ')}. ` +
              `The two files give these classes different ids, so they were aligned on name.`,
            'is-warning',
          ),
        )
      }
      if (taxonomy.onlyInA.length > 0 || taxonomy.onlyInB.length > 0) {
        const parts: string[] = []
        if (taxonomy.onlyInA.length > 0) {
          parts.push(`only in A: ${taxonomy.onlyInA.map((c) => c.name).join(', ')}`)
        }
        if (taxonomy.onlyInB.length > 0) {
          parts.push(`only in B: ${taxonomy.onlyInB.map((c) => c.name).join(', ')}`)
        }
        notes.append(note(`Classes ${parts.join('; ')}. Boxes on them can never match.`, 'is-warning'))
      }

      elements.summary.replaceChildren(grid, table, notes)

      // Worst agreement first: the weakest pair is the one worth looking at.
      const sorted = worstFirst(result)
      if (sorted.length === 0) {
        elements.pairs.replaceChildren(empty('No matched pairs at this threshold.'))
        return
      }
      elements.pairs.replaceChildren(
        ...sorted.map((pair) => {
          const id = pairId(pair)
          const row = document.createElement('button')
          row.type = 'button'
          row.className = 'pair-row' + (id === selectedPairId ? ' is-selected' : '')
          row.dataset.pairId = id

          const label = classOf(pair.a.labelId)
          const swatch = document.createElement('span')
          swatch.className = 'swatch'
          swatch.style.background = label?.color ?? '#8b93a1'
          const name = document.createElement('span')
          name.className = 'row-name'
          name.textContent = label?.name ?? pair.a.labelId
          const score = document.createElement('span')
          score.className = 'iou'
          score.textContent = pair.iou.toFixed(3)

          row.append(swatch, name, score)
          row.addEventListener('click', () => onSelectPair(id))
          return row
        }),
      )
    },
  }
}

function note(text: string, extraClass?: string): HTMLElement {
  const element = document.createElement('p')
  element.className = extraClass === undefined ? 'note' : `note ${extraClass}`
  element.textContent = text
  return element
}

function empty(text: string): HTMLElement {
  const element = document.createElement('p')
  element.className = 'empty'
  element.textContent = text
  return element
}
