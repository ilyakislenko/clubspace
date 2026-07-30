"use client"

import { useEffect, useState } from "react"

import {
  getMemberAchievements,
  getMemberAttendance,
  type MemberAchievements,
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
  const [achievements, setAchievements] = useState<MemberAchievements | null>(
    null,
  )
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
    // Achievements are a best-effort enrichment — a failure must not blank the
    // attendance list.
    void (async () => {
      try {
        const res = await getMemberAchievements({ workspaceId, userId })
        if (!cancelled) setAchievements(res)
      } catch {
        if (!cancelled) setAchievements(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspaceId, userId])

  const unlockedCount =
    achievements?.achievements.filter((m) => m.unlocked).length ?? 0

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

      {achievements && (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat
            value={achievements.currentStreakWeeks}
            label="серия, нед."
          />
          <Stat
            value={achievements.longestStreakWeeks}
            label="лучшая, нед."
          />
          <Stat
            value={`${unlockedCount}/${achievements.achievements.length}`}
            label="вех открыто"
          />
        </div>
      )}

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

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-2 text-center">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  )
}
