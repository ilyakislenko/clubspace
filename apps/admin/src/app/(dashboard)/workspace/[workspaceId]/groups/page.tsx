"use client"

import { useParams, useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  ALL_DIRECTIONS,
  DirectionFilter,
  matchesDirectionFilter,
} from "../../../../../features/directions/DirectionFilter"
import { useDirections } from "../../../../../features/directions/use-directions"
import { GroupFormSheet } from "../../../../../features/groups/GroupFormSheet"
import { GroupRows } from "../../../../../features/groups/GroupRows"
import { GymFormSheet } from "../../../../../features/groups/GymFormSheet"
import {
  listGroups,
  listGyms,
  type GroupSummary,
  type Gym,
} from "../../../../../shared/api/groups"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { pluralRu } from "../../../../../shared/lib/plural-ru"
import { useDirectionScope } from "../../../../../shared/workspace/use-direction-scope"
import { useVocabulary } from "../../../../../shared/lib/vocabulary"

type Tab = "groups" | "gyms"

// «Группы и залы»: compact group rows and the halls as their own tab. Every
// row opens its card; time is edited only in the calendar.
export default function WorkspaceGroupsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  const router = useRouter()
  const scope = useDirectionScope(workspaceId)
  const canEditGyms = scope.isSportLead
  const { directions } = useDirections(workspaceId)
  const vocabulary = useVocabulary()

  const [tab, setTab] = useState<Tab>("groups")
  const [gyms, setGyms] = useState<Gym[]>([])
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [directionFilter, setDirectionFilter] = useState(ALL_DIRECTIONS)
  const [groupSheetOpen, setGroupSheetOpen] = useState(false)
  const [gymSheetOpen, setGymSheetOpen] = useState(false)

  // ?tab=gyms (the gym card's back link). Read from window, not
  // useSearchParams, to avoid a Suspense boundary.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "gyms") setTab("gyms")
  }, [])

  const switchTab = (next: Tab) => {
    setTab(next)
    const url = new URL(window.location.href)
    if (next === "gyms") url.searchParams.set("tab", "gyms")
    else url.searchParams.delete("tab")
    window.history.replaceState(window.history.state, "", url)
  }

  const refresh = useCallback(async () => {
    if (!workspaceId) return
    try {
      const [gymsResp, groupsResp] = await Promise.all([
        listGyms({ workspaceId }),
        listGroups({ workspaceId }),
      ])
      setGyms(gymsResp.data)
      setGroups(groupsResp.data)
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить группы и залы"))
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!workspaceId) return null

  const visibleGroups = groups.filter((g) => matchesDirectionFilter(directionFilter, g.direction?.id))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Группы и залы</h1>
          <p className="text-sm text-muted-foreground">
            Нажмите на строку, чтобы открыть карточку. Время {vocabulary.session.genPl} меняется в
            «Расписании».
          </p>
        </div>
        {tab === "groups" ? (
          <Button type="button" onClick={() => setGroupSheetOpen(true)}>
            Добавить группу
          </Button>
        ) : (
          canEditGyms && (
            <Button type="button" onClick={() => setGymSheetOpen(true)}>
              Добавить зал
            </Button>
          )
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border">
        <div role="tablist" aria-label="Группы и залы" className="flex">
          {(
            [
              { id: "groups" as const, label: "Группы", count: groups.length },
              { id: "gyms" as const, label: "Залы", count: gyms.length },
            ]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => switchTab(t.id)}
              className={`relative -mb-px px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {!loading && <span className="ml-1.5 tabular-nums text-muted-foreground">{t.count}</span>}
            </button>
          ))}
        </div>
        {tab === "groups" && (
          <div className="pb-1.5">
            <DirectionFilter directions={directions} value={directionFilter} onChange={setDirectionFilter} />
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : tab === "groups" ? (
        groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {gyms.length === 0
              ? canEditGyms
                ? "Групп пока нет. Сначала добавьте зал на вкладке «Залы»."
                : "Групп пока нет. Попросите администратора добавить зал."
              : "Групп пока нет."}
          </p>
        ) : visibleGroups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Нет групп в выбранном направлении.
          </p>
        ) : (
          <GroupRows workspaceId={workspaceId} groups={visibleGroups} />
        )
      ) : gyms.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Залов пока нет.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {gyms.map((gym) => (
            <li key={gym.id}>
              <button
                type="button"
                onClick={() => router.push(`/workspace/${workspaceId}/gyms/${gym.id}`)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/40"
              >
                <span className="min-w-0">
                  <span className="block font-medium">{gym.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{gym.address}</span>
                </span>
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  {gym.groupCount} {pluralRu(gym.groupCount, "группа", "группы", "групп")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <GroupFormSheet
        workspaceId={workspaceId}
        open={groupSheetOpen}
        onOpenChange={setGroupSheetOpen}
        onSaved={(groupId) => router.push(`/workspace/${workspaceId}/groups/${groupId}`)}
      />
      <GymFormSheet
        workspaceId={workspaceId}
        open={gymSheetOpen}
        onOpenChange={setGymSheetOpen}
        onSaved={refresh}
      />
    </div>
  )
}
