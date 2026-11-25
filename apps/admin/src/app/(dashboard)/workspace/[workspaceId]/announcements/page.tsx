"use client"

import { MoreHorizontal } from "lucide-react"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@clubspace/ui-kit/ui"

import {
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  type Announcement,
} from "../../../../../shared/api/announcements"
import { listGroups, type GroupSummary } from "../../../../../shared/api/groups"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { useWorkspaceRealtime } from "../../../../../shared/realtime/useWorkspaceRealtime"
import { confirmDialog } from "../../../../../shared/ui/confirm-dialog"
import { DirectionChip } from "../../../../../features/directions/DirectionChip"
import {
  ALL_DIRECTIONS,
  DirectionFilter,
  directionFilterParam,
} from "../../../../../features/directions/DirectionFilter"
import { useDirections } from "../../../../../features/directions/use-directions"
import { AnnouncementFormSheet } from "../../../../../features/announcements/AnnouncementFormSheet"
import {
  GROUPS_REMOVED_TEXT,
  groupsLabel,
  matchesTargetFilter,
  publishPushText,
} from "../../../../../features/announcements/announcement-target"
import { useDirectionScope } from "../../../../../shared/workspace/use-direction-scope"
import { SectionTabs } from "../../../../../shared/workspace/section-tabs"
import { newsTabs } from "../sections"

export default function WorkspaceAnnouncementsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  // A direction manager gets only their directions' announcements and may
  // post only inside those directions.
  const scope = useDirectionScope(workspaceId)

  const [items, setItems] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  // The announcement open in the panel; null = a new one.
  const [editing, setEditing] = useState<Announcement | null>(null)
  const { directions } = useDirections(workspaceId)
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [directionFilter, setDirectionFilter] = useState(ALL_DIRECTIONS)

  useEffect(() => {
    if (!workspaceId) return
    listGroups({ workspaceId })
      .then((res) => setGroups(res.data))
      .catch(() => setGroups([]))
  }, [workspaceId])

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      const res = await listAnnouncements({
        workspaceId,
        directionId: directionFilterParam(directionFilter),
      })
      // «Только для всего клуба» has no server filter — narrow client-side.
      setItems(res.data.filter((a) => matchesTargetFilter(directionFilter, a)))
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить объявления"))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, directionFilter])

  useEffect(() => {
    void load()
  }, [load])

  useWorkspaceRealtime(workspaceId, ["announcements"], () => void load())

  const openSheet = (a: Announcement | null) => {
    setEditing(a)
    setSheetOpen(true)
  }

  const run = async (a: Announcement, action: () => Promise<unknown>) => {
    setBusyId(a.id)
    try {
      await action()
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось изменить объявление"))
    } finally {
      setBusyId(null)
    }
  }

  // Publishing sends a push, so it asks first; back to drafts does not.
  const togglePublish = async (a: Announcement) => {
    if (!workspaceId) return
    if (
      !a.publishedAt &&
      !(await confirmDialog({
        title: `Опубликовать «${a.title}»?`,
        description: publishPushText(a.audience, {
          directionName: a.direction?.name ?? null,
          groups: a.groups,
        }),
        confirmLabel: "Опубликовать",
      }))
    )
      return
    await run(a, () =>
      updateAnnouncement({
        workspaceId,
        announcementId: a.id,
        data: { publish: !a.publishedAt },
      }),
    )
  }

  const togglePin = (a: Announcement) => {
    if (!workspaceId) return
    void run(a, () =>
      updateAnnouncement({
        workspaceId,
        announcementId: a.id,
        data: { pinned: !a.pinned },
      }),
    )
  }

  const remove = async (a: Announcement) => {
    if (!workspaceId) return
    const pub = a.publishedAt ? new Date(a.publishedAt) : null
    if (
      !(await confirmDialog({
        title: `Удалить объявление «${a.title}»?`,
        description:
          pub === null
            ? undefined
            : pub > new Date()
              ? "Запланированная публикация отменится."
              : "Участники больше не увидят его в приложении.",
        destructive: true,
      }))
    )
      return
    await run(a, () =>
      deleteAnnouncement({ workspaceId, announcementId: a.id }),
    )
  }

  return (
    // The tab row spans the page like on «События»; the feed keeps a reading width.
    <div className="space-y-6">
      <SectionTabs title="Новости и события" tabs={newsTabs} />
      <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Лента клуба в приложении. Объявление видят те, кому оно адресовано;
          черновики — только персонал.
        </p>
        <Button type="button" className="shrink-0" onClick={() => openSheet(null)}>
          Новое объявление
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {directions.length > 0 && (
        <div className="flex justify-end">
          <DirectionFilter
            directions={scope.filterOptions(directions)}
            value={directionFilter}
            onChange={setDirectionFilter}
            includeClubOnly={scope.isSportLead}
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {directionFilter === ALL_DIRECTIONS
            ? "Объявлений пока нет."
            : "Нет объявлений в выбранном направлении."}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((a) => {
            const pub = a.publishedAt ? new Date(a.publishedAt) : null
            const scheduled = pub !== null && pub > new Date()
            return (
              <li
                key={a.id}
                className="flex items-start gap-3 rounded-xl border border-border p-4"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left hover:opacity-80"
                  onClick={() => openSheet(a)}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.title}</span>
                    <DirectionChip direction={a.direction} />
                    {a.groups.length > 0 && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {a.groups.length === 1 ? "Группа" : "Группы"}:{" "}
                        {groupsLabel(a.groups)}
                      </span>
                    )}
                    {a.groupsRemoved && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-600 dark:text-amber-500">
                        {GROUPS_REMOVED_TEXT}
                      </span>
                    )}
                    {a.pinned && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                        Закреплено
                      </span>
                    )}
                    {a.audience === "EXPIRING" && (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-600 dark:text-amber-500">
                        Только на продление
                      </span>
                    )}
                    {/* Published is the normal state: only a draft or a
                        scheduled post is marked. */}
                    {(pub === null || scheduled) && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] ${
                          pub === null
                            ? "bg-muted text-muted-foreground"
                            : "bg-amber-500/10 text-amber-600"
                        }`}
                      >
                        {pub === null
                          ? "Черновик"
                          : `Запланировано · ${pub.toLocaleString("ru-RU", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}`}
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block whitespace-pre-wrap text-sm text-muted-foreground">
                    {a.body}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {a.authorName}
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busyId === a.id}
                      aria-label={`Действия: ${a.title}`}
                    >
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => void togglePublish(a)}>
                      {a.publishedAt ? "В черновик" : "Опубликовать"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => togglePin(a)}>
                      {a.pinned ? "Открепить" : "Закрепить"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onSelect={() => void remove(a)}
                    >
                      Удалить
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            )
          })}
        </ul>
      )}
      </div>

      {workspaceId && (
        <AnnouncementFormSheet
          workspaceId={workspaceId}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          announcement={editing}
          directions={directions}
          groups={groups}
          scope={scope}
          onSaved={() => void load()}
        />
      )}
    </div>
  )
}
