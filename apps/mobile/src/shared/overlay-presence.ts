import { useEffect, useSyncExternalStore } from "react"

// How many sheets, modals and menus are open right now. Something that runs on
// its own under them (the player's «Следующий урок через N с») waits while any
// is up: the member is busy with the sheet, not watching the countdown.
let openCount = 0
const listeners = new Set<() => void>()

const setOpenCount = (next: number) => {
  openCount = next
  listeners.forEach((listener) => listener())
}

export const overlayStore = {
  /** Counts one more overlay as open; the returned function closes it. */
  open(): () => void {
    setOpenCount(openCount + 1)
    let closed = false
    return () => {
      if (closed) return
      closed = true
      setOpenCount(openCount - 1)
    }
  },
  isOpen: (): boolean => openCount > 0,
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/** Counts this sheet / modal / menu as open while `open` is true. */
export function useOverlayPresence(open: boolean): void {
  useEffect(() => (open ? overlayStore.open() : undefined), [open])
}

/** True while any sheet, modal or menu that registered itself is open. */
export function useAnyOverlayOpen(): boolean {
  return useSyncExternalStore(
    overlayStore.subscribe,
    overlayStore.isOpen,
    () => false,
  )
}
