"use client"

import { useState, type FormEvent } from "react"

import { Button, Label, Textarea } from "@clubspace/ui-kit/ui"

import type { LeadLostReason, SetLeadStatusInput } from "../../shared/api/leads"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { LOST_REASON_LABEL, LOST_REASONS } from "./lead-view"

const COMMENT = FORM_LIMITS.leadLost.comment

// «Отказ…»: one reason, a comment (required for «Другое»). «Спам» erases the
// person's data at once, so the form says so before the click.
export function LeadLostForm({
  busy,
  error,
  onDirty,
  onCancel,
  onSubmit,
}: {
  busy: boolean
  error: string | null
  onDirty: (dirty: boolean) => void
  onCancel: () => void
  onSubmit: (data: Pick<SetLeadStatusInput, "lostReason" | "lostComment">) => void
}) {
  const [reason, setReason] = useState<LeadLostReason | null>(null)
  const [comment, setComment] = useState("")
  const [touched, setTouched] = useState(false)

  const needsComment = reason === "OTHER" && !comment.trim()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setTouched(true)
    if (!reason || needsComment) return
    onSubmit({ lostReason: reason, ...(comment.trim() ? { lostComment: comment.trim() } : {}) })
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <fieldset className="space-y-2" disabled={busy}>
        <legend className="mb-1 text-sm font-semibold">Причина отказа</legend>
        {LOST_REASONS.map((r) => (
          <label key={r} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="lost-reason"
              value={r}
              checked={reason === r}
              onChange={() => {
                setReason(r)
                onDirty(true)
              }}
            />
            {LOST_REASON_LABEL[r]}
          </label>
        ))}
      </fieldset>
      {touched && !reason && <p className="text-xs text-destructive">Выберите причину</p>}
      {reason === "SPAM" && <p className="text-sm text-muted-foreground">Данные удалятся сразу.</p>}

      <div className="space-y-1.5">
        <Label htmlFor="lost-comment">Комментарий{reason === "OTHER" ? "*" : ""}</Label>
        <Textarea
          id="lost-comment"
          rows={3}
          value={comment}
          maxLength={COMMENT.max}
          disabled={busy}
          onChange={(e) => {
            setComment(e.target.value)
            onDirty(true)
          }}
        />
        {touched && needsComment && <p className="text-xs text-destructive">Напишите, что случилось</p>}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="destructive" disabled={busy}>
          {busy ? "Сохраняем…" : "Отметить отказ"}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  )
}
