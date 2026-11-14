"use client"

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@clubspace/ui-kit/ui"

// The one confirmation dialog of the admin. Any handler can ask
//   if (!(await confirmDialog({ title: "Удалить зал «Север»?", description: "…", destructive: true }))) return
// and gets `true` only when the person pressed the confirm button (or Enter).
// Esc, the close cross, a click outside and «Отмена» resolve `false`.
// `<ConfirmDialogHost />` is mounted once in the dashboard layout; requests
// made while one is open wait their turn.

export type ConfirmOptions = {
  title: string
  // What happens if the person agrees: the consequences, not a restated title.
  description?: ReactNode
  // Defaults to «Удалить» for a destructive action, else «Подтвердить».
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

type Request = ConfirmOptions & { resolve: (ok: boolean) => void }

let queue: Request[] = []
let hosts = 0
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const current = (): Request | null => queue[0] ?? null

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (hosts === 0) {
    return Promise.reject(new Error("confirmDialog: <ConfirmDialogHost /> is not mounted"))
  }
  // Executor form on purpose: `Promise.withResolvers` is missing in Safari
  // < 17.4 / Chrome < 119 and Next does not polyfill it.
  return new Promise<boolean>((resolve) => {
    queue = [...queue, { ...options, resolve }]
    listeners.forEach((listener) => listener())
  })
}

const settle = (request: Request, ok: boolean) => {
  if (queue[0] !== request) return
  queue = queue.slice(1)
  request.resolve(ok)
  listeners.forEach((listener) => listener())
}

export function ConfirmDialogHost() {
  const request = useSyncExternalStore(subscribe, current, () => null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  // Keeps the last request on screen while the dialog animates closed.
  const [shown, setShown] = useState<Request | null>(null)

  useEffect(() => {
    hosts += 1
    return () => {
      hosts -= 1
      if (hosts === 0) {
        const pending = queue
        queue = []
        pending.forEach((r) => r.resolve(false))
      }
    }
  }, [])

  useEffect(() => {
    if (request) setShown(request)
  }, [request])

  const view = request ?? shown
  if (!view) return null
  const destructive = view.destructive ?? false

  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && request && settle(request, false)}>
      <DialogContent
        className="max-w-md"
        data-confirm-dialog
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          confirmRef.current?.focus()
        }}
        onKeyDown={(event) => {
          // Enter confirms from anywhere in the dialog; on a focused button the
          // browser already turns Enter into that button's click.
          if (event.key !== "Enter" || event.nativeEvent.isComposing || !request) return
          if (event.target instanceof HTMLButtonElement) return
          event.preventDefault()
          settle(request, true)
        }}
      >
        <DialogHeader>
          <DialogTitle className="pr-6 leading-snug">{view.title}</DialogTitle>
          {view.description ? (
            <DialogDescription>{view.description}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{view.title}</DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => request && settle(request, false)}>
            {view.cancelLabel ?? "Отмена"}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            className={
              destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
            onClick={() => request && settle(request, true)}
          >
            {view.confirmLabel ?? (destructive ? "Удалить" : "Подтвердить")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
