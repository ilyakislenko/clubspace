"use client"

import { useRef, useState, type ReactNode } from "react"

import type { OpenRequest } from "../../shared/api/requests"
import { errorCode, errorMessage } from "../../shared/lib/error-message"

// What every decision panel gets from RequestSheet.
export type DecisionProps = {
  workspaceId: string
  request: OpenRequest
  // The signed-in user: «Вы отвечаете за …» and own comments.
  viewerId: string | null
  // Decided here: the panel closes and the list reloads.
  onDone: () => void
  // Someone else decided it first (409/404): the panel says so.
  onGone: (message: string) => void
}

// The existing endpoints answer a decision someone else made first with 409
// (freeze, personal: compare-and-set on the status) or 404 (join reject).
export const isGoneError = (error: unknown): boolean => {
  const code = errorCode(error)
  return code === "CONFLICT" || code === "NOT_FOUND"
}

/**
 * Runs one decision at a time: a second click while the first is in flight is
 * ignored; success → `onDone`, a decision taken elsewhere → `onGone` with the
 * server's words, anything else → the error line.
 */
export function useDecision({ onDone, onGone }: Pick<DecisionProps, "onDone" | "onGone">) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sending = useRef(false)

  const decide = async (action: () => Promise<unknown>, failed: string) => {
    if (sending.current) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
      onDone()
    } catch (e) {
      if (isGoneError(e)) onGone(errorMessage(e, ""))
      else setError(errorMessage(e, failed))
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  return { busy, error, setError, decide }
}

export function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">{children}</dl>
}

// A fact shown only when it is known.
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  if (children === null || children === undefined || children === "") return null
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 whitespace-pre-line break-words">{children}</dd>
    </>
  )
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </p>
  )
}
