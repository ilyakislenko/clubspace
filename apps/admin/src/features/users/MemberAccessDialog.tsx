"use client"

import { useEffect, useState } from "react"

import {
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@clubspace/ui-kit/ui"

import { updateMemberAccess } from "../../shared/api/members"
import { errorMessage } from "../../shared/lib/error-message"
import { sameLocalDay } from "./member-access"

const isoToDate = (iso: string | null): Date | null => (iso ? new Date(iso) : null)

// The picked day stays inside the window: «до 1 июня» = through 1 June.
const endOfDayIso = (date: Date): string =>
  new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  ).toISOString()

const fmtDay = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })

// The manual override of app access (WorkspaceMember.accessUntil). It follows
// the abonements on its own; a club changes it by hand only to grant extra
// days or to close access early.
export function MemberAccessDialog({
  open,
  onOpenChange,
  workspaceId,
  userId,
  accessUntil,
  abonementEnd,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  userId: string
  accessUntil: string | null
  // The latest end of the member's current abonements (null = none).
  abonementEnd: string | null
  onSaved: (accessUntil: string | null) => void
}) {
  const [draft, setDraft] = useState<Date | null>(isoToDate(accessUntil))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDraft(isoToDate(accessUntil))
    setError(null)
  }, [open, accessUntil])

  const save = async () => {
    // The same day as now: nothing to store. A PATCH would still count as a
    // manual window and unlink it from a running freeze.
    const unchanged =
      draft === null
        ? accessUntil === null
        : accessUntil !== null && sameLocalDay(draft, new Date(accessUntil))
    if (unchanged) {
      onOpenChange(false)
      return
    }
    setSaving(true)
    setError(null)
    // Back to the abonement's own end: store that exact instant.
    const next =
      draft === null
        ? null
        : abonementEnd && sameLocalDay(draft, new Date(abonementEnd))
          ? abonementEnd
          : endOfDayIso(draft)
    try {
      const res = await updateMemberAccess({ workspaceId, userId, accessUntil: next })
      onSaved(res.accessUntil)
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить доступ."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Доступ к приложению</DialogTitle>
          <DialogDescription>
            {abonementEnd
              ? `Обычно совпадает с концом абонемента (${fmtDay(abonementEnd)}). `
              : ""}
            Измените, чтобы дать дополнительные дни или закрыть доступ раньше.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <DatePicker
            value={draft}
            onChange={setDraft}
            disabled={saving}
            placeholder="Без ограничения"
            className="h-9 w-[220px]"
          />
          {draft !== null && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => setDraft(null)}
            >
              Без ограничения
            </Button>
          )}
          {abonementEnd &&
            (draft === null || !sameLocalDay(draft, new Date(abonementEnd))) && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={saving}
                onClick={() => setDraft(new Date(abonementEnd))}
              >
                Как у абонемента
              </Button>
            )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Отмена
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? "Сохраняем…" : "Сохранить"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
