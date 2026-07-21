"use client"

import { useEffect, useState } from "react"

import {
  getMemberAttendance,
  type MemberAttendance,
} from "../../shared/api/members"
import { errorMessage } from "../../shared/lib/error-message"

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  year: "numeric",
})
const timeFmt = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
})

export function MemberAttendancePanel({
  workspaceId,
  userId,
}: {
  workspaceId: string
  userId: string
}) {
  const [data, setData] = useState<MemberAttendance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const res = await getMemberAttendance({ workspaceId, userId })
        if (!cancelled) setData(res)
      } catch (err) {
        if (!cancelled)
          setError(errorMessage(err, "Не удалось загрузить посещаемость"))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspaceId, userId])

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="font-medium">Посещаемость</div>
        {data && (
          <span className="text-xs text-muted-foreground tabular-nums">
            всего отметок: {data.total}
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Последние тренировки за 30 дней.
      </p>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {loading && (
        <div className="mt-3 space-y-2">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div
              key={idx}
              className="h-10 animate-pulse rounded-md border border-border bg-muted"
            />
          ))}
        </div>
      )}

      {!loading && !error && data && data.sessions.length === 0 && (
        <p className="mt-3 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
          За последние 30 дней отметок нет.
        </p>
      )}

      {!loading && data && data.sessions.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border">
          {data.sessions.map((session) => (
            <li
              key={session.id}
              className="flex items-center justify-between gap-3 p-3 text-sm"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{session.title}</div>
                <div className="text-xs text-muted-foreground">
                  {dateFmt.format(new Date(session.startAt))} ·{" "}
                  {timeFmt.format(new Date(session.startAt))}
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {session.attendeeCount} чел.
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
