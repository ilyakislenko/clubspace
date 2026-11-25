"use client"

import { useEffect, useState } from "react"

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import { reopenPayrollMonth, type PayrollMonth } from "../../shared/api/payroll"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { inputClsFull } from "../../shared/lib/input-class"
import { confirmLeave, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { monthName } from "./payroll-view"

const L = FORM_LIMITS.payrollReopen

// «Открыть заново»: a closed month back to live numbers, with a required
// reason (audited with the old totals). The inline form is the confirmation.
export function PayrollReopenSheet({
  workspaceId,
  month,
  open,
  onClose,
  onReopened,
}: {
  workspaceId: string
  month: string
  open: boolean
  onClose: () => void
  onReopened: (next: PayrollMonth) => void
}) {
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setReason("")
    setError(null)
  }, [open])

  useDirtyGuard(open && reason.trim() !== "")

  const requestClose = async () => {
    if (await confirmLeave()) onClose()
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const text = reason.trim()
    if (text.length < L.reason.min) {
      setError(`Напишите причину — от ${L.reason.min} символов`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const next = await reopenPayrollMonth({ workspaceId, month, reason: text })
      setReason("")
      onReopened(next)
    } catch (err) {
      setError(errorMessage(err, "Не удалось открыть месяц"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && void requestClose()}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Открыть {monthName(month)} заново?</SheetTitle>
          <SheetDescription>
            Суммы снова начнут пересчитываться по посещаемости и ставкам. Корректировки останутся,
            прежние итоги сохранятся в истории изменений.
          </SheetDescription>
        </SheetHeader>
        <form id="payroll-reopen-form" onSubmit={submit} className="flex flex-1 flex-col gap-3 text-sm">
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">Причина</span>
            <textarea
              className={`${inputClsFull} min-h-24`}
              maxLength={L.reason.max}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                setError(null)
              }}
            />
          </label>
          {error && <p className="text-destructive">{error}</p>}
        </form>
        <SheetFooter>
          <div className="flex w-full items-center justify-end gap-2">
            <Button type="button" variant="ghost" disabled={saving} onClick={() => void requestClose()}>
              Отмена
            </Button>
            <Button type="submit" form="payroll-reopen-form" variant="destructive" disabled={saving}>
              {saving ? "Открываем…" : "Открыть месяц"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
