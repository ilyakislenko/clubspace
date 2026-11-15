"use client"

import { MoreHorizontal } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Label,
  Textarea,
} from "@clubspace/ui-kit/ui"

import {
  cancelMemberAutopay,
  listMemberAutopays,
  type MemberAutopay,
} from "../../shared/api/autopay"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { autopayHeadline, autopayNotes, type AutopayNote } from "./autopay-text"

const REASON = FORM_LIMITS.autopayCancel.reason

const NOTE_CLASS: Record<AutopayNote["tone"], string> = {
  destructive: "text-destructive",
  warning: "text-amber-700",
  muted: "text-muted-foreground",
}

// The member's autopay under their abonements (sport leads; the parent mounts
// it only for them). Renders only while the member has a live agreement or one
// cancelled in the last 30 days — the server returns exactly those. Amount and
// card are the server's to strip for non-club-admins. Its only action, «⋯ →
// Отключить автоплатёж», honours a member's refusal by phone (376-ФЗ: effective
// at once, the member gets a written confirmation).
export function MemberAutopayBlock({
  workspaceId,
  userId,
  reloadKey,
}: {
  workspaceId: string
  userId: string
  // Changes when the parent re-read the abonements (a cancel may end autopay).
  reloadKey?: unknown
}) {
  const [rows, setRows] = useState<MemberAutopay[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<MemberAutopay | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await listMemberAutopays({ workspaceId, userId })
      setRows(res.data)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить автоплатежи"))
    }
  }, [workspaceId, userId])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  if (rows.length === 0 && !error) return null

  return (
    <section className="space-y-2" aria-label="Автоплатёж">
      {error && <p className="text-sm text-destructive">{error}</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {rows.map((a) => {
            const live = a.status !== "CANCELLED"
            return (
              <li key={a.id} className="flex items-start gap-2 px-3 py-2">
                <div className="min-w-0 flex-1 space-y-0.5">
                  {live && <div>{autopayHeadline(a)}</div>}
                  {autopayNotes(a).map((n) => (
                    <p key={n.text} className={`text-xs ${NOTE_CLASS[n.tone]}`}>
                      {n.text}
                    </p>
                  ))}
                </div>
                {live && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7 shrink-0"
                        aria-label={`Действия с автоплатежом «${a.planName}»`}
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive"
                        onSelect={() => setCancelling(a)}
                      >
                        Отключить автоплатёж
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <CancelAutopayDialog
        workspaceId={workspaceId}
        autopay={cancelling}
        onClose={() => setCancelling(null)}
        onCancelled={() => {
          setCancelling(null)
          void load()
        }}
      />
    </section>
  )
}

// «Отключить автоплатёж?» with the required «Причина» the member gave.
function CancelAutopayDialog({
  workspaceId,
  autopay,
  onClose,
  onCancelled,
}: {
  workspaceId: string
  autopay: MemberAutopay | null
  onClose: () => void
  onCancelled: () => void
}) {
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!autopay) return
    setReason("")
    setError(null)
  }, [autopay])

  const trimmed = reason.trim()
  const valid = trimmed.length >= Math.max(REASON.min, 1) && trimmed.length <= REASON.max

  const submit = async () => {
    if (!autopay || !valid) return
    setBusy(true)
    setError(null)
    try {
      await cancelMemberAutopay({ workspaceId, autopayId: autopay.id, data: { reason: trimmed } })
      onCancelled()
    } catch (e) {
      setError(errorMessage(e, "Не удалось отключить автоплатёж"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={autopay !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Отключить автоплатёж?</DialogTitle>
          <DialogDescription>
            {autopay ? `Тариф «${autopay.planName}». ` : ""}
            Следующих списаний не будет, текущий абонемент продолжит действовать. Ученику придёт
            уведомление.
          </DialogDescription>
        </DialogHeader>
        <form
          id="autopay-cancel-form"
          className="grid gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Label htmlFor="autopay-cancel-reason">Причина</Label>
          <Textarea
            id="autopay-cancel-reason"
            value={reason}
            maxLength={REASON.max}
            placeholder="Например, попросил по телефону"
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          />
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button
            type="submit"
            form="autopay-cancel-form"
            variant="destructive"
            disabled={busy || !valid}
          >
            {busy ? "Отключаем…" : "Отключить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
