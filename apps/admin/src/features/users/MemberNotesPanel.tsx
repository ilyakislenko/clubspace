"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { updateMemberNotes } from "../../shared/api/members"
import { errorMessage } from "../../shared/lib/error-message"

export function MemberNotesPanel({
  workspaceId,
  userId,
  initialNotes,
}: {
  workspaceId: string
  userId: string
  initialNotes: string | null
}) {
  const [notes, setNotes] = useState(initialNotes ?? "")
  const [saved, setSaved] = useState(initialNotes ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = notes !== saved

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await updateMemberNotes({
        workspaceId,
        userId,
        notes: notes.trim() === "" ? null : notes,
      })
      const next = res.notes ?? ""
      setSaved(next)
      setNotes(next)
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить заметку"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="font-medium">Заметки о участнике</div>
      <p className="mt-1 text-xs text-muted-foreground">
        Видны только тренерам и администраторам — сам участник их не видит.
        Травмы, цели, договорённости по оплате.
      </p>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        maxLength={5000}
        placeholder="Например: восстанавливается после травмы колена; хочет выступать весной."
        className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      />

      <div className="mt-2 flex justify-end">
        <Button
          type="button"
          size="sm"
          disabled={!dirty || saving}
          onClick={() => void save()}
        >
          {saving ? "Сохраняем…" : "Сохранить"}
        </Button>
      </div>
    </div>
  )
}
