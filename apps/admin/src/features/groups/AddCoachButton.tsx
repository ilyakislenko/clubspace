"use client"

import { useState } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bjj-academy/ui-kit/ui"

import { addGroupCoach } from "../../shared/api/groups"
import { type WorkspaceMember } from "../../shared/api/members"
import { formatMemberLabel } from "./helpers"

type Props = {
  workspaceId: string
  groupId: string
  existingCoachIds: Set<string>
  members: WorkspaceMember[]
  onAdded: () => void | Promise<void>
}

export function AddCoachButton({
  workspaceId,
  groupId,
  existingCoachIds,
  members,
  onAdded,
}: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Only suggest workspace members who aren't already on the group as a
  // coach. Filtering happens client-side because the list is small;
  // server still validates membership and role.
  const candidates = members.filter((m) => !existingCoachIds.has(m.userId))

  const handlePick = async (userId: string) => {
    setBusy(true)
    setOpen(false)
    try {
      await addGroupCoach({ workspaceId, groupId, userId })
      await onAdded()
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
  return (
    <Select
      value=""
      onValueChange={(v) => void handlePick(v)}
      open
      onOpenChange={(o) => {
        if (!o) setOpen(false)
      }}
    >
      <SelectTrigger className="h-7 w-[220px] text-xs">
        <SelectValue placeholder="Выбери участника" />
      </SelectTrigger>
      <SelectContent>
        {candidates.length === 0 && (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            Все участники уже привязаны
          </div>
        )}
        {candidates.map((m) => (
          <SelectItem key={m.userId} value={m.userId}>
            {formatMemberLabel(m)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
