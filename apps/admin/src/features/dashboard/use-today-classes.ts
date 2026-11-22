"use client"

import { useCallback, useEffect, useMemo, useState } from "react"

import { listGroups } from "../../shared/api/groups"
import { fetchMe } from "../../shared/api/me"
import { getSchedule, type WorkspaceSchedule } from "../../shared/api/schedule"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"
import { wallClock } from "../schedule/calendar/calendar-helpers"
import type { CalendarItem } from "../schedule/calendar/calendar-items"
import { todayItems, todayRequestRange, type OwnClasses } from "./today-classes"

export type TodayClassesState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; today: string; nowMin: number; items: CalendarItem[] }

/**
 * Today's classes for «Сегодня». `ownOnly` (a plain coach) narrows them to the
 * coach's groups and substitutions, like the calendar; undefined = the role
 * has not loaded yet, nothing is fetched. A failed request is its own state
 * (the block says so) — never an empty day.
 */
export function useTodayClasses(
  workspaceId: string | undefined,
  ownOnly: boolean | undefined,
): TodayClassesState {
  const [loaded, setLoaded] = useState<
    { schedule: WorkspaceSchedule; own: OwnClasses } | "failed" | null
  >(null)
  const [now, setNow] = useState(() => new Date())

  const load = useCallback(async () => {
    if (!workspaceId || ownOnly === undefined) return
    const range = todayRequestRange(new Date())
    try {
      const [schedule, own] = await Promise.all([
        getSchedule({ workspaceId, ...range }),
        ownOnly
          ? Promise.all([listGroups({ workspaceId }), fetchMe()]).then(([groups, me]) => ({
              userId: me.id,
              groupIds: new Set(
                groups.data
                  .filter((g) => g.coaches.some((c) => c.userId === me.id))
                  .map((g) => g.id),
              ),
            }))
          : null,
      ])
      setLoaded({ schedule, own })
    } catch {
      setLoaded("failed")
    }
  }, [workspaceId, ownOnly])

  useEffect(() => {
    void load()
  }, [load])

  // «Идёт» / past classes move with the clock.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  useWorkspaceRealtime(workspaceId, ["schedule", "substitutions", "groups"], () => void load())

  return useMemo(() => {
    if (loaded === null) return { status: "loading" }
    if (loaded === "failed") return { status: "failed" }
    const { today, items } = todayItems(loaded.schedule, now, loaded.own)
    return { status: "ready", today, nowMin: wallClock(now, loaded.schedule.timezone).minutes, items }
  }, [loaded, now])
}
