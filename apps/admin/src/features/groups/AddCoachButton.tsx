"use client"

import { useState } from "react"

import { Input } from "@clubspace/ui-kit/ui"

import { addGroupCoach } from "../../shared/api/groups"
import { type WorkspaceMember } from "../../shared/api/members"
import { errorMessage } from "../../shared/lib/error-message"
import {
  formatMemberLabel,
  isCoachCapable,
  matchesMemberQuery,
} from "./helpers"

type Props = {
  workspaceId: string
  groupId: string
  existingCoachIds: Set<string>
  members: WorkspaceMember[]
  onAdded: () => void | Promise<void>
  onError: (message: string | null) => void
}

export function AddCoachButton({
  workspaceId,
  groupId,
  existingCoachIds,
  members,
  onAdded,
  onError,
}: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState("")

  // Only suggest workspace members who aren't already on the group as a
  // coach. Filtering happens client-side because the list is small;
  // server still validates membership and role.
  const candidates = members.filter(
    (m) => isCoachCapable(m) && !existingCoachIds.has(m.userId),
  )

  const handlePick = async (userId: string) => {
    setBusy(true)
    setOpen(false)
    setQuery("")
    onError(null)
    try {
      await addGroupCoach({ workspaceId, groupId, userId })
      await onAdded()
    } catch (err) {
      onError(errorMessage(err, "Не удалось добавить помощника"))
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 font-medium text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
      >
        + Помощник
      </button>
    )
  }
  const filtered = candidates.filter((m) => matchesMemberQuery(m, query))

  return (
    <div className="w-[220px] space-y-1 rounded-md border border-border bg-card p-1">
      <Input
        autoFocus
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false)
            setQuery("")
          }
        }}
        placeholder="Имя или email"
        className="h-7 text-xs"
      />
      <ul className="max-h-48 overflow-y-auto">
        {filtered.length === 0 && (
          <li className="px-2 py-1 text-xs text-muted-foreground">
            {candidates.length === 0
              ? "Нет подходящих тренеров"
              : "Никого не найдено"}
          </li>
        )}
        {filtered.map((m) => (
          <li key={m.userId}>
            <button
              type="button"
              onClick={() => void handlePick(m.userId)}
              className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted/60"
            >
              {formatMemberLabel(m)}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          setOpen(false)
          setQuery("")
        }}
        className="w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted/60"
      >
        Закрыть
      </button>
    </div>
  )
}
