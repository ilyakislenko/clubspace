"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  listRankGradings,
  type RankGradingSummary,
} from "../../shared/api/gradings"
import { listGyms, type Gym } from "../../shared/api/groups"
import { listRankLadders, type RankLadder } from "../../shared/api/ranks"
import { errorMessage } from "../../shared/lib/error-message"
import { formatYmd } from "../../shared/lib/format-ymd"
import { pluralRu } from "../../shared/lib/plural-ru"
import { GradingFormSheet } from "./GradingFormSheet"

// Admins and direction managers (the server lists only their directions'
// ladders and gradings to a manager): schedule a grading, open existing ones.
export function GradingsPanel({ workspaceId }: { workspaceId: string }) {
  const [gradings, setGradings] = useState<RankGradingSummary[] | null>(null)
  const [ladders, setLadders] = useState<RankLadder[]>([])
  const [gyms, setGyms] = useState<Gym[]>([])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setGradings((await listRankGradings({ workspaceId })).data)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить аттестации"))
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void listRankLadders({ workspaceId })
      .then((res) => setLadders(res.data.filter((l) => l.isActive)))
      .catch(() => setLadders([]))
    void listGyms({ workspaceId })
      .then((res) => setGyms(res.data))
      .catch(() => setGyms([]))
  }, [workspaceId])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Аттестации</h2>
        {ladders.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setSheetOpen(true)}
          >
            Новая аттестация
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {gradings === null ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : gradings.length === 0 ? (
        <p className="text-sm text-muted-foreground">Аттестаций пока нет.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {gradings.map((g) => (
            <li key={g.id}>
              <Link
                href={`/workspace/${workspaceId}/gradings/${g.id}`}
                className="block px-3 py-2 hover:bg-muted/50"
              >
                <span className="font-medium">{formatYmd(g.date)}</span> ·{" "}
                {g.ladderName} · {g.counts.candidates}{" "}
                {pluralRu(
                  g.counts.candidates,
                  "кандидат",
                  "кандидата",
                  "кандидатов",
                )}{" "}
                · сдали {g.counts.passed}
                {g.feeAmount != null ? ` · оплатили ${g.counts.paid}` : ""}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <GradingFormSheet
        workspaceId={workspaceId}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        ladders={ladders}
        gyms={gyms}
        onSaved={() => void load()}
      />
    </div>
  )
}
