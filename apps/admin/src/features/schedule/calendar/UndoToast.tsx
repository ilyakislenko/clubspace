"use client"

import { CheckCircle2, XCircle } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"
import { cn } from "@clubspace/ui-kit/util"

export type Toast = {
  id: number
  tone: "success" | "error"
  message: string
  // «Отменить»: puts the change back. Absent when undo is not cheap.
  undo?: () => Promise<void>
}

const TTL_MS = 15_000

/** Bottom-right notice after a calendar change, with «Отменить» where cheap. */
export function UndoToast({ toast, onDismiss }: { toast: Toast | null; onDismiss: () => void }) {
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!toast) return
    setBusy(false)
    const t = setTimeout(onDismiss, TTL_MS)
    return () => clearTimeout(t)
  }, [toast, onDismiss])

  if (!toast) return null
  const Icon = toast.tone === "success" ? CheckCircle2 : XCircle
  return (
    <div
      role="status"
      data-calendar-toast
      className={cn(
        "fixed bottom-6 right-6 z-50 flex max-w-md items-center gap-3 rounded-lg border bg-background px-4 py-3 text-sm shadow-lg",
        toast.tone === "error" ? "border-destructive/40" : "border-border",
      )}
    >
      <Icon
        className={cn(
          "size-5 shrink-0",
          toast.tone === "error" ? "text-destructive" : "text-emerald-600",
        )}
      />
      <span className="flex-1">{toast.message}</span>
      {toast.undo && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void toast.undo?.().finally(onDismiss)
          }}
        >
          {busy ? "…" : "Отменить"}
        </Button>
      )}
    </div>
  )
}
