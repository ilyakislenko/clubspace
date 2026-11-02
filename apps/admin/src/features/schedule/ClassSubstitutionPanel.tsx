"use client"

import { useEffect, useState } from "react"

import { agree, cap } from "@clubspace/ui-kit/brand"
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
import { useVocabulary } from "../../shared/lib/vocabulary"

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
  const vocabulary = useVocabulary()
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
              {cap(vocabulary.session.acc)} проведёт <b>{personName(row.substitute)}</b> вместо{" "}
              {personName(row.regularCoach)}.
            </>
          ) : (
            <>
              <b>{personName(row.substitute)}</b> просит провести{" "}
              {agree(vocabulary.session, "эту", "это")} {vocabulary.session.acc} —
              отмечать посещаемость сможет после одобрения.
            </>
          )}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Ведёт {vocabulary.coach.nom} группы. Назначьте замену, если {vocabulary.session.acc} проведёт другой
          {" "}{vocabulary.coach.nom} — он сможет отметить посещаемость.
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
              aria-label={`Кто проведёт ${vocabulary.session.acc}`}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Выберите {vocabulary.coach.acc}…</option>
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
        {/* A decider already has «Отклонить» for a pending request. */}
        {row?.canCancel && !(row.status === "PENDING" && row.canDecide) && (
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
