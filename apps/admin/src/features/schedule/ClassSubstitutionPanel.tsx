"use client"

import { useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  approveClassSubstitution,
  cancelClassSubstitution,
  createClassSubstitution,
  declineClassSubstitution,
  listClassSubstitutions,
  listSubstituteCandidates,
  type ClassSubstitution,
  type SubstituteCandidate,
} from "../../shared/api/class-substitutions"
import { errorMessage } from "../../shared/lib/error-message"

const personName = (p: {
  firstname: string | null
  lastname: string | null
  email: string | null
}): string => [p.firstname, p.lastname].filter(Boolean).join(" ") || p.email || "—"

/**
 * «Замена» of one class: who runs it instead of the group's coach, a coach's
 * pending request to take it (approve / decline), assigning or cancelling.
 */
export function ClassSubstitutionPanel({
  workspaceId,
  slotId,
  sessionDate,
  onChanged,
}: {
  workspaceId: string
  slotId: string
  sessionDate: string
  onChanged: () => void
}) {
  const [row, setRow] = useState<ClassSubstitution | null>(null)
  const [candidates, setCandidates] = useState<SubstituteCandidate[]>([])
  const [pick, setPick] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await listClassSubstitutions({
        workspaceId,
        from: sessionDate,
        to: sessionDate,
      })
      setRow(res.data.find((s) => s.slotId === slotId) ?? null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить замену"))
    }
  }

  useEffect(() => {
    setRow(null)
    setError(null)
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, slotId, sessionDate])

  useEffect(() => {
    listSubstituteCandidates({ workspaceId })
      .then((r) => setCandidates(r.data))
      .catch(() => undefined)
  }, [workspaceId])

  const run = async (action: () => Promise<unknown>, failure: string) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      setPick("")
      await load()
      onChanged()
    } catch (err) {
      setError(errorMessage(err, failure))
    } finally {
      setBusy(false)
    }
  }

  const pickable = candidates.filter(
    (c) => c.id !== row?.regularCoach.id && c.id !== row?.substitute.id,
  )

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="text-xs uppercase text-muted-foreground">Замена</div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {row ? (
        <p className="text-sm">
          {row.status === "APPROVED" ? (
            <>
              Занятие проведёт <b>{personName(row.substitute)}</b> вместо{" "}
              {personName(row.regularCoach)}.
            </>
          ) : (
            <>
              <b>{personName(row.substitute)}</b> просит провести это занятие —
              отмечать посещаемость сможет после одобрения.
            </>
          )}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Ведёт тренер группы. Назначьте замену, если занятие проведёт другой
          тренер — он сможет отметить посещаемость.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {row?.status === "PENDING" && row.canDecide && (
          <>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    approveClassSubstitution({
                      workspaceId,
                      substitutionId: row.id,
                    }),
                  "Не удалось одобрить замену",
                )
              }
            >
              Дать добро
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    declineClassSubstitution({
                      workspaceId,
                      substitutionId: row.id,
                    }),
                  "Не удалось отклонить запрос",
                )
              }
            >
              Отклонить
            </Button>
          </>
        )}
        {(!row || row.canDecide) && (
          <>
            <select
              aria-label="Кто проведёт занятие"
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Выберите тренера…</option>
              {pickable.map((c) => (
                <option key={c.id} value={c.id}>
                  {personName(c)}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !pick}
              onClick={() =>
                void run(
                  () =>
                    createClassSubstitution({
                      workspaceId,
                      slotId,
                      sessionDate,
                      substituteId: pick,
                    }),
                  "Не удалось назначить замену",
                )
              }
            >
              {row ? "Сменить замену" : "Назначить замену"}
            </Button>
          </>
        )}
        {row?.canCancel && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  cancelClassSubstitution({
                    workspaceId,
                    substitutionId: row.id,
                  }),
                "Не удалось отменить замену",
              )
            }
          >
            {row.status === "PENDING" ? "Отозвать запрос" : "Отменить замену"}
          </Button>
        )}
      </div>
    </div>
  )
}
