"use client"

import { useEffect, useId } from "react"

// Unsaved-changes guard. The App Router has no route-change blocking, so a
// dirty form is protected on three paths:
// - leaving the document (reload, close, typed URL, external link): the
//   browser's own `beforeunload` prompt;
// - clicking an in-app link (sidebar, breadcrumbs, any <Link>/<a>): a
//   capture-phase click listener on `window` runs before React's root
//   listener, so a declined prompt stops Next's <Link> from navigating;
// - programmatic navigation (`router.push` in a handler): the caller asks
//   `confirmLeave()` first.
// The browser's Back/Forward buttons are not intercepted.
//
// One registry for the whole tab: several dirty forms on one page share one
// listener and one prompt.

export const LEAVE_PROMPT = "Есть несохранённые изменения. Уйти без сохранения?"

const dirtyGuards = new Set<string>()

export const hasUnsavedChanges = (): boolean => dirtyGuards.size > 0

// True when nothing is dirty or the user agreed to drop the changes. Call it
// before a programmatic navigation away from a form.
export const confirmLeave = (): boolean =>
  !hasUnsavedChanges() || window.confirm(LEAVE_PROMPT)

// Do two plain form values (strings, numbers, booleans, null, arrays, plain
// objects) hold the same data? Key order does not matter. Forms compare their
// draft with the last saved values to decide whether they are dirty.
export const sameData = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameData(x, b[i]))
  }
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return (
    ka.length === kb.length &&
    ka.every(
      (k) =>
        Object.prototype.hasOwnProperty.call(b, k) &&
        sameData(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        ),
    )
  )
}

type ClickLike = {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  defaultPrevented: boolean
}

type AnchorLike = {
  href: string
  target: string
  download: boolean
}

// Does this click on this anchor replace the current page inside the app?
// Not when it opens elsewhere (modifier keys, middle button, target=_blank,
// download), leaves the origin (`beforeunload` asks then), or stays on the
// same page (a #hash jump).
export const clickLeavesPage = (
  click: ClickLike,
  anchor: AnchorLike,
  current: URL,
): boolean => {
  if (click.defaultPrevented || click.button !== 0) return false
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) {
    return false
  }
  if (anchor.download) return false
  if (anchor.target && anchor.target !== "_self") return false
  let next: URL
  try {
    next = new URL(anchor.href, current)
  } catch {
    return false
  }
  if (next.origin !== current.origin) return false
  return next.pathname !== current.pathname || next.search !== current.search
}

const onClickCapture = (event: MouseEvent) => {
  const target = event.target
  if (!(target instanceof Element)) return
  const anchor = target.closest("a[href]")
  if (!(anchor instanceof HTMLAnchorElement)) return
  const leaves = clickLeavesPage(
    event,
    {
      href: anchor.href,
      target: anchor.target,
      download: anchor.hasAttribute("download"),
    },
    new URL(window.location.href),
  )
  if (!leaves || window.confirm(LEAVE_PROMPT)) return
  event.preventDefault()
  event.stopPropagation()
}

const onBeforeUnload = (event: BeforeUnloadEvent) => {
  event.preventDefault()
  // Older Chromium/Safari only prompt when returnValue is set.
  event.returnValue = ""
}

const setGuardDirty = (id: string, dirty: boolean) => {
  const before = dirtyGuards.size
  if (dirty) dirtyGuards.add(id)
  else dirtyGuards.delete(id)
  if (before === 0 && dirtyGuards.size > 0) {
    window.addEventListener("click", onClickCapture, true)
    window.addEventListener("beforeunload", onBeforeUnload)
  } else if (before > 0 && dirtyGuards.size === 0) {
    window.removeEventListener("click", onClickCapture, true)
    window.removeEventListener("beforeunload", onBeforeUnload)
  }
}

// Guards the page while `isDirty` (the form differs from its last saved
// values). Unmounting releases the guard.
export function useDirtyGuard(isDirty: boolean): void {
  const id = useId()
  useEffect(() => {
    setGuardDirty(id, isDirty)
    return () => setGuardDirty(id, false)
  }, [id, isDirty])
}
