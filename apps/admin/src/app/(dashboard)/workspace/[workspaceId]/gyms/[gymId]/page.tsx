"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import {
  listGroups,
  listGyms,
  type GroupSummary,
  type Gym,
} from "../../../../../../shared/api/groups"

export default function WorkspaceGymPage() {
  const params = useParams<{ workspaceId: string; gymId: string }>()
  const workspaceId = params?.workspaceId
  const gymId = params?.gymId

  const [gym, setGym] = useState<Gym | null>(null)
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId || !gymId) return
    let cancelled = false
    setLoading(true)
    void Promise.all([
      listGyms({ workspaceId }),
      listGroups({ workspaceId }),
    ])
      .then(([gymsResp, groupsResp]) => {
        if (cancelled) return
        const found = gymsResp.data.find((g) => g.id === gymId) ?? null
        setGym(found)
        // Filter groups assigned to this gym. The `gym` field on a group
        // is null for unassigned groups; we ignore those here.
        setGroups(groupsResp.data.filter((g) => g.gym?.id === gymId))
      })
      .catch((err) => {
        if (cancelled) return
        setError(
          err instanceof Error ? err.message : "Не удалось загрузить зал.",
        )
      })
      .finally(() => {
        if (cancelled) return
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, gymId])

  const totalStudents = useMemo(
    () => groups.reduce((acc, g) => acc + g.memberCount, 0),
    [groups],
  )

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg border border-border bg-muted/50" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link
          href={`/workspace/${workspaceId}/groups`}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Группы и залы
        </Link>
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      </div>
    )
  }

  if (!gym) {
    return (
      <div className="space-y-4">
        <Link
          href={`/workspace/${workspaceId}/groups`}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Группы и залы
        </Link>
        <p className="text-sm text-muted-foreground">Зал не найден.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/workspace/${workspaceId}/groups`}
          className="text-xs text-muted-foreground hover:underline"
        >
          ← Группы и залы
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{gym.name}</h1>
        <p className="text-sm text-muted-foreground">{gym.address}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700 ring-1 ring-inset ring-zinc-600/20">
            {groups.length} групп
          </span>
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700 ring-1 ring-inset ring-zinc-600/20">
            {totalStudents} учеников всего
          </span>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Группы</h2>
        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            В этом зале пока нет групп. Привяжи группу к залу через
            «Группы и залы → Изменить».
          </p>
        ) : (
          <ul className="space-y-3">
            {groups.map((group) => (
              <li
                key={group.id}
                className="space-y-3 rounded-lg border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="font-semibold">{group.name}</div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Link
                        href={`/workspace/${workspaceId}/users/${group.coach.id}`}
                        className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 hover:bg-emerald-100"
                      >
                        Тренер:{" "}
                        {[group.coach.firstname, group.coach.lastname]
                          .filter(Boolean)
                          .join(" ") || group.coach.email}
                      </Link>
                      <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700 ring-1 ring-inset ring-zinc-600/20">
                        {group.memberCount} учеников
                      </span>
                    </div>
                    {group.slots.length > 0 && (
                      <div className="text-xs text-foreground">
                        Расписание:{" "}
                        {[...group.slots]
                          .sort(
                            (a, b) =>
                              a.dayOfWeek - b.dayOfWeek ||
                              a.startTime.localeCompare(b.startTime),
                          )
                          .map(
                            (s) =>
                              `${["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"][s.dayOfWeek]} ${s.startTime}`,
                          )
                          .join(", ")}
                      </div>
                    )}
                  </div>
                </div>

                {group.members.length > 0 && (
                  <div className="border-t border-border pt-3">
                    <div className="mb-1.5 text-xs uppercase text-muted-foreground">
                      Ученики
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {group.members.map((m) => {
                        const label =
                          [m.firstname, m.lastname]
                            .filter(Boolean)
                            .join(" ")
                            .trim() || m.email
                        return (
                          <Link
                            key={m.userId}
                            href={`/workspace/${workspaceId}/users/${m.userId}`}
                            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs hover:bg-muted/70"
                          >
                            {label}
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
