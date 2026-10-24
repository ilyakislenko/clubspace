"use client"

import Link from "next/link"
import { useState } from "react"

import { removeGroupCoach } from "../../shared/api/groups"
import { errorMessage } from "../../shared/lib/error-message"

type Props = {
  workspaceId: string
  groupId: string
  userId: string
  name: string
  role: "primary" | "assistant"
  onRemoved: () => void | Promise<void>
  onError: (message: string) => void
}

export function CoachChip({
  workspaceId,
  groupId,
  userId,
  name,
  role,
  onRemoved,
  onError,
}: Props) {
  const [busy, setBusy] = useState(false)
  const handleRemove = async () => {
    if (!window.confirm(`Снять ${name} с роли помощника?`)) return
    setBusy(true)
    try {
      await removeGroupCoach({ workspaceId, groupId, userId })
      await onRemoved()
    } catch (err) {
      onError(errorMessage(err, "Не удалось снять помощника"))
    } finally {
      setBusy(false)
    }
  }
  // The primary coach is canonical and changes via the group form, so
  // we don't render a remove icon for them — only for assistants.
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ring-1 ring-inset ${
        role === "primary"
          ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
          : "bg-sky-50 text-sky-700 ring-sky-600/20"
      }`}
    >
      <Link
        href={`/workspace/${workspaceId}/users/${userId}`}
        className="hover:underline"
      >
        {role === "primary" ? "Тренер" : "Помощник"}: {name}
      </Link>
      {role === "assistant" && (
        <button
          type="button"
          onClick={() => void handleRemove()}
          disabled={busy}
          className="ml-1 rounded-full px-1 text-sky-700/70 hover:bg-sky-200/60 disabled:opacity-50"
          aria-label="Снять помощника"
        >
          ×
        </button>
      )}
    </span>
  )
}
