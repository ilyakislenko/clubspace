"use client"

import { useCallback, useRef, useState } from "react"

import { undoTournamentMatchResult } from "../../../shared/api/tournaments"
import { errorMessage } from "../../../shared/lib/error-message"
import { UndoToast, type Toast } from "../../schedule/calendar/UndoToast"
import type { RecordedMatch } from "./MatchResultSheet"

// After «Записать»: «Победа: Иванов» with «Отменить» (the same undo route as
// «Отменить результат»; no confirm on save, design §9). A refused undo — the
// next match is already decided — replaces the toast with the server's words.
export function useResultToast(organizationId: string, tournamentId: string, onChange: () => void) {
  const [toast, setToast] = useState<Toast | null>(null)
  // UndoToast dismisses itself once the undo settles; a failure shown then.
  const failure = useRef<string | null>(null)

  const dismiss = useCallback(() => {
    const message = failure.current
    failure.current = null
    setToast(message ? { id: Date.now(), tone: "error", message } : null)
  }, [])

  const recorded = useCallback(
    (r: RecordedMatch) => {
      onChange()
      setToast({
        id: Date.now(),
        tone: "success",
        message: `Победа: ${r.winnerName}`,
        undo: async () => {
          try {
            await undoTournamentMatchResult({
              organizationId,
              tournamentId,
              matchId: r.match.id,
              expectedUpdatedAt: r.match.updatedAt,
            })
          } catch (e) {
            failure.current = errorMessage(e, "Не удалось отменить результат")
          }
          onChange()
        },
      })
    },
    [organizationId, tournamentId, onChange],
  )

  return { recorded, toast: <UndoToast toast={toast} onDismiss={dismiss} /> }
}
