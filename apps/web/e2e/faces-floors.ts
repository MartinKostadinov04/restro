// What the renderer's design specs measure on a page of it at the screen's present width, shared by
// faces-design.spec.ts (the browsing page, the dish page, the allergen sheet) and
// faces-design-screens.spec.ts (the five guest-feature screens): touch targets, contrast, sideways
// overflow, names that are cut and text under its floor (D130, the designer guide's §7.5).
import type { Page } from '@playwright/test'

import { settled } from './faces-audit'

/**
 * Runs in the page: what sticks out, what is cut and what is too small. Sends its source, no closure.
 * `frame` is the box the page is drawn in when it is not the browser's window (the Design tab's phone
 * screen): what sticks out is measured against it, and the window's own scroll is not the page's.
 */
export function floorsOf({ root, frame }: { root: string; frame: string | null }): string[] {
  const found: string[] = []
  const edge =
    frame === null
      ? { left: 0, right: document.documentElement.clientWidth }
      : (document.querySelector(frame)?.getBoundingClientRect() ?? { left: 0, right: 0 })
  if (frame === null && document.documentElement.scrollWidth > edge.right) {
    found.push(`the page scrolls (${document.documentElement.scrollWidth})`)
  }
  for (const element of document.querySelectorAll(`${root} *`)) {
    const style = getComputedStyle(element)
    const box = element.getBoundingClientRect()
    if (box.width === 0 || style.visibility !== 'visible') continue
    if (element.closest('[hidden]') !== null) continue
    const where = `${element.tagName.toLowerCase()}.${[...element.classList].join('.')}`
    // The photo strip and the section rail scroll sideways inside their own box.
    const scrolls = element.closest('.rm-sections, .rm-section.is-feature .rm-items') !== null
    if (!scrolls && (box.right > edge.right + 0.5 || box.left < edge.left - 0.5)) {
      found.push(
        `${where} sticks out: ${Math.round(box.left - edge.left)}..${Math.round(box.right - edge.left)}`,
      )
    }
    const size = Number.parseFloat(style.fontSize)
    if (element.matches('input, textarea, select')) {
      if (size < 16) found.push(`${where} is an input at ${size} px`)
      continue
    }
    const hasText = [...element.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
    )
    if (hasText && size < 12 && !element.matches('.rm-sr, [class*="visually-hidden"]')) {
      found.push(`${where} is text at ${size} px`)
    }
  }
  for (const slot of document.querySelectorAll(`${root} [data-slot="item.name"]`)) {
    const text = (slot.textContent ?? '').trim()
    for (const element of [slot, ...slot.querySelectorAll('*')]) {
      const style = getComputedStyle(element)
      const clamp = (style as CSSStyleDeclaration & { webkitLineClamp: string }).webkitLineClamp
      if (style.textOverflow === 'ellipsis') found.push(`"${text}" has an ellipsis`)
      if (clamp !== 'none' && clamp !== '') found.push(`"${text}" has a line clamp`)
      if (element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0) {
        found.push(`"${text}" runs past its box`)
      }
      if (element.scrollHeight > element.clientHeight + 1 && style.overflowY !== 'visible') {
        found.push(`"${text}" is clipped in height`)
      }
    }
  }
  return found.slice(0, 12)
}

/**
 * Everything measured at the screen's present width, each problem named with `state`. `frame` is the
 * box the page is drawn in, when it is not the browser's window.
 */
export async function measure(
  page: Page,
  state: string,
  root: string,
  frame: string | null = null,
): Promise<string[]> {
  await settled(page)
  const targets = await page.evaluate((root) => window.__rmAudit.targets(root), root)
  const contrast = await page.evaluate((root) => window.__rmAudit.textContrast(root), root)
  return [
    ...targets.map((target) => `${target.label}: ${target.width}x${target.height}`),
    ...contrast.low.map((low) => `"${low.text}" at ${low.ratio}:1, needs ${low.needs}:1`),
    ...(await page.evaluate(floorsOf, { root, frame })),
  ].map((problem) => `${state}: ${problem}`)
}
