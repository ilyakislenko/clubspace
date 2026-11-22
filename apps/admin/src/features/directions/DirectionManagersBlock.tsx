"use client"

import { useState } from "react"

import { Input } from "@clubspace/ui-kit/ui"

import {
  assignDirectionManager,
  removeDirectionManager,
  type DirectionManager,
} from "../../shared/api/direction-managers"
import type { Direction } from "../../shared/api/directions"
import type { WorkspaceMember } from "../../shared/api/members"
import { errorMessage } from "../../shared/lib/error-message"
import { formatMemberLabel, matchesMemberQuery } from "../groups/helpers"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { cap } from "@clubspace/ui-kit/brand"

// Only a plain coach can run a direction — admins/head coaches already manage
// everything, and the server refuses anyone else.
export const isDirectionManagerCandidate = (m: WorkspaceMember): boolean =>
  m.roleName === "coach" && !m.isOwner

export const managerLabel = (m: DirectionManager): string =>
  [m.firstname, m.lastname].filter(Boolean).join(" ").trim() || m.email || "—"

type Props = {
  workspaceId: string
  direction: Direction
  managers: DirectionManager[]
  coaches: WorkspaceMember[]
  // Ranks are named in the copy only where the club has them switched on.
  ranksOn: boolean
  onChanged: () => void | Promise<void>
}

/** «Руководители» of one direction (in its editor): assigned coaches + picker
 * to add more. Changes save at once, apart from the form's «Сохранить». */
export function DirectionManagersBlock({
  workspaceId,
  direction,
  managers,
  coaches,
  ranksOn,
  onChanged,
}: Props) {
  const vocabulary = useVocabulary()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState("")
  const [error, setError] = useState<string | null>(null)

  const assigned = new Set(managers.map((m) => m.userId))
  const candidates = coaches.filter((c) => !assigned.has(c.userId))
  const filtered = candidates.filter((c) => matchesMemberQuery(c, query))

  const close = () => {
    setOpen(false)
    setQuery("")
  }

  const assign = async (userId: string) => {
    close()
    setBusy(true)
    setError(null)
    try {
      await assignDirectionManager({
        workspaceId,
        data: { directionId: direction.id, userId },
      })
      await onChanged()
    } catch (err) {
      setError(errorMessage(err, "Не удалось назначить руководителя"))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (m: DirectionManager) => {
    const confirmed = await confirmDialog({
      title: `Снять ${managerLabel(m)} с руководства направлением «${direction.name}»?`,
      description: `${cap(vocabulary.coach.nom)} останется в клубе и в своих группах, но перестанет вести группы, события и объявления направления.`,
      confirmLabel: "Снять",
      destructive: true,
    })
    if (!confirmed) return
    setBusy(true)
    setError(null)
    try {
      await removeDirectionManager({ workspaceId, managerId: m.id })
      await onChanged()
    } catch (err) {
      setError(errorMessage(err, "Не удалось снять руководителя"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <div>
        <div className="text-sm font-medium">Руководители</div>
        <p className="text-xs text-muted-foreground">
          {cap(vocabulary.coach.nom)}, который сам ведёт группы,
          {ranksOn ? " ранги, аттестации," : ""} события и объявления этого направления.
        </p>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {managers.map((m) => (
          <span
            key={m.id}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5"
            title={m.email ?? undefined}
          >
            {managerLabel(m)}
            <button
              type="button"
              aria-label={`Снять ${managerLabel(m)}`}
              disabled={busy}
              onClick={() => void remove(m)}
              className="text-muted-foreground hover:text-destructive disabled:opacity-50"
            >
              ×
            </button>
          </span>
        ))}
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            disabled={busy}
            className="inline-flex items-center rounded-full border border-dashed border-border px-2 py-0.5 font-medium text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
          >
            + Назначить руководителя
          </button>
        )}
      </div>
      {open && (
        <div className="w-[260px] space-y-1 rounded-md border border-border bg-card p-1">
          <Input
            autoFocus
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close()
            }}
            placeholder={`Имя или email ${vocabulary.coach.gen}`}
            className="h-7 text-xs"
          />
          <ul className="max-h-48 overflow-y-auto">
            {filtered.length === 0 && (
              <li className="px-2 py-1 text-xs text-muted-foreground">
                {candidates.length === 0
                  ? `Нет ${vocabulary.coach.genPl} для назначения — руководителем может быть только участник с ролью «${cap(vocabulary.coach.nom)}»`
                  : "Никого не найдено"}
              </li>
            )}
            {filtered.map((c) => (
              <li key={c.userId}>
                <button
                  type="button"
                  onClick={() => void assign(c.userId)}
                  className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-muted/60"
                >
                  {formatMemberLabel(c)}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={close}
            className="w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted/60"
          >
            Закрыть
          </button>
        </div>
      )}
    </div>
  )
}
