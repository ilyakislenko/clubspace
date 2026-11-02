"use client"

import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  updateAnnouncement,
  type Announcement,
} from "../../../../../shared/api/announcements"
import { listGroups, type GroupSummary } from "../../../../../shared/api/groups"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { useWorkspaceRealtime } from "../../../../../shared/realtime/useWorkspaceRealtime"
import { inputClsFull } from "../../../../../shared/lib/input-class"
import { DirectionChip } from "../../../../../features/directions/DirectionChip"
import {
  ALL_DIRECTIONS,
  DirectionFilter,
  directionFilterParam,
} from "../../../../../features/directions/DirectionFilter"
import { useDirections } from "../../../../../features/directions/use-directions"
import { AnnouncementTargetPicker } from "../../../../../features/announcements/AnnouncementTargetPicker"
import {
  groupsLabel,
  initialTarget,
  isTargetComplete,
  matchesTargetFilter,
  publishConfirmText,
  targetOf,
  targetPayload,
  type AnnouncementTarget,
} from "../../../../../features/announcements/announcement-target"
import { useDirectionScope } from "../../../../../shared/workspace/use-direction-scope"
import { useVocabulary } from "../../../../../shared/lib/vocabulary"

export default function WorkspaceAnnouncementsPage() {
  const vocabulary = useVocabulary()
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  // A direction manager gets only their directions' announcements and may
  // post only inside those directions.
  const scope = useDirectionScope(workspaceId)

  const [items, setItems] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [pinned, setPinned] = useState(false)
  const [audience, setAudience] = useState<"ALL" | "EXPIRING">("ALL")
  const [scheduleAt, setScheduleAt] = useState("")
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editBody, setEditBody] = useState("")
  const [target, setTarget] = useState<AnnouncementTarget>(() =>
    initialTarget(scope.defaultDirectionId),
  )
  const [editTarget, setEditTarget] = useState<AnnouncementTarget>(() =>
    initialTarget(null),
  )
  const { directions } = useDirections(workspaceId)
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [directionFilter, setDirectionFilter] = useState(ALL_DIRECTIONS)
  const directionName = (id: string | null) =>
    directions.find((d) => d.id === id)?.name ?? null
  // The chosen groups in the shape of an announcement's `groups`.
  const targetGroups = (t: AnnouncementTarget): Announcement["groups"] =>
    t.kind === "groups"
      ? groups
          .filter((g) => t.groupIds.includes(g.id))
          .map((g) => ({
            id: g.id,
            name: g.name,
            gymName: g.gym?.name ?? null,
            directionId: g.direction?.id ?? null,
          }))
      : []

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

  const submit = async (opts: { publish?: boolean; publishAt?: string }) => {
    if (!workspaceId || !title.trim() || !body.trim()) return
    setBusy(true)
    try {
      await createAnnouncement({
        workspaceId,
        data: {
          title: title.trim(),
          body: body.trim(),
          pinned,
          audience,
          ...targetPayload(target),
          ...(opts.publish ? { publish: true } : {}),
          ...(opts.publishAt ? { publishAt: opts.publishAt } : {}),
        },
      })
      setTitle("")
      setBody("")
      setPinned(false)
      setAudience("ALL")
      setTarget(initialTarget(scope.defaultDirectionId))
      setScheduleAt("")
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось сохранить объявление"))
    } finally {
      setBusy(false)
    }
  }

  const wrap = (fn: () => Promise<unknown>) => async () => {
    if (!workspaceId) return
    try {
      await fn()
      await load()
    } catch (e) {
      setError(errorMessage(e, "Ошибка"))
    }
  }

  const saveEdit = async (a: Announcement) => {
    if (!workspaceId || !editTitle.trim() || !editBody.trim()) return
    setBusy(true)
    try {
      await updateAnnouncement({
        workspaceId,
        announcementId: a.id,
        data: {
          title: editTitle.trim(),
          body: editBody.trim(),
          ...targetPayload(editTarget),
        },
      })
      setEditingId(null)
      await load()
    } catch (e) {
      setError(errorMessage(e, "Не удалось сохранить объявление"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Объявления</h1>
        <p className="text-sm text-muted-foreground">
          Лента клуба. Опубликованные объявления видят все участники; черновики —
          только персонал. Закреплённые всплывают наверх.
          {directions.length > 0 &&
            ` Объявление направления получат только его ученики и ${vocabulary.coach.nomPl}.`}
          {groups.length > 0 &&
            ` Объявление для групп — только ученики этих групп (за детей — родители), их ${vocabulary.coach.nomPl} и персонал.`}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-2 rounded-xl border border-border bg-card/40 p-4">
        <input
          className={inputClsFull}
          placeholder="Заголовок"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className={`${inputClsFull} min-h-24`}
          placeholder="Текст объявления"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <AnnouncementTargetPicker
          id="announcement-target"
          value={target}
          onChange={setTarget}
          directions={directions}
          groups={groups}
          scope={scope}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
            />
            Закрепить
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Кому:</span>
            <select
              value={audience}
              onChange={(e) =>
                setAudience(e.target.value as "ALL" | "EXPIRING")
              }
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
            >
              <option value="ALL">Всем</option>
              <option value="EXPIRING">Только на продление</option>
            </select>
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-primary"
              title="Запланировать публикацию"
            />
            <Button
              variant="outline"
              disabled={
                busy ||
                !title.trim() ||
                !body.trim() ||
                !scheduleAt ||
                !isTargetComplete(target)
              }
              onClick={() =>
                void submit({
                  publishAt: new Date(scheduleAt).toISOString(),
                })
              }
            >
              Запланировать
            </Button>
            <Button
              variant="outline"
              disabled={
                busy || !title.trim() || !body.trim() || !isTargetComplete(target)
              }
              onClick={() => void submit({})}
            >
              В черновик
            </Button>
            <Button
              disabled={
                busy || !title.trim() || !body.trim() || !isTargetComplete(target)
              }
              onClick={() => {
                if (
                  window.confirm(
                    publishConfirmText(audience, {
                      directionName:
                        target.kind === "direction"
                          ? directionName(target.directionId)
                          : null,
                      groups: targetGroups(target),
                    }),
                  )
                )
                  void submit({ publish: true })
              }}
            >
              Опубликовать
            </Button>
          </div>
        </div>
      </div>

      {directions.length > 0 && (
        <div className="flex justify-end">
          <DirectionFilter
            directions={scope.filterOptions(directions)}
            value={directionFilter}
            onChange={setDirectionFilter}
            includeClubOnly={scope.isAdmin}
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
          {items.map((a) => (
            <li key={a.id} className="rounded-xl border border-border p-4">
              {editingId === a.id ? (
                <div className="space-y-2">
                  <input
                    className={inputClsFull}
                    aria-label="Заголовок"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                  <textarea
                    className={`${inputClsFull} min-h-24`}
                    aria-label="Текст объявления"
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                  />
                  <AnnouncementTargetPicker
                    id={`announcement-target-${a.id}`}
                    value={editTarget}
                    onChange={setEditTarget}
                    directions={directions}
                    groups={groups}
                    scope={scope}
                  />
                  {a.publishedAt && new Date(a.publishedAt) <= new Date() && (
                    <p className="text-xs text-muted-foreground">
                      Объявление уже опубликовано: изменения увидят все, но
                      push-уведомление повторно не отправляется.
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={
                        busy ||
                        !editTitle.trim() ||
                        !editBody.trim() ||
                        !isTargetComplete(editTarget)
                      }
                      onClick={() => void saveEdit(a)}
                    >
                      Сохранить
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingId(null)}
                    >
                      Отмена
                    </Button>
                  </div>
                </div>
              ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{a.title}</span>
                    <DirectionChip direction={a.direction} />
                    {a.groups.length > 0 && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {a.groups.length === 1 ? "Группа" : "Группы"}:{" "}
                        {groupsLabel(a.groups)}
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
                    {(() => {
                      const pub = a.publishedAt ? new Date(a.publishedAt) : null
                      const scheduled = pub !== null && pub > new Date()
                      return (
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] ${
                            pub === null
                              ? "bg-muted text-muted-foreground"
                              : scheduled
                                ? "bg-amber-500/10 text-amber-600"
                                : "bg-emerald-500/10 text-emerald-600"
                          }`}
                        >
                          {pub === null
                            ? "Черновик"
                            : scheduled
                              ? `Запланировано · ${pub.toLocaleString("ru-RU", {
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}`
                              : "Опубликовано"}
                        </span>
                      )
                    })()}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {a.body}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.authorName}
                  </p>
                </div>
              </div>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingId(a.id)
                    setEditTitle(a.title)
                    setEditBody(a.body)
                    setEditTarget(targetOf(a))
                  }}
                >
                  Изменить
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (
                      !a.publishedAt &&
                      !window.confirm(
                        publishConfirmText(a.audience, {
                          directionName: a.direction?.name ?? null,
                          groups: a.groups,
                        }),
                      )
                    )
                      return
                    void wrap(() =>
                      updateAnnouncement({
                        workspaceId: workspaceId!,
                        announcementId: a.id,
                        data: { publish: !a.publishedAt },
                      }),
                    )()
                  }}
                >
                  {a.publishedAt ? "В черновик" : "Опубликовать"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={wrap(() =>
                    updateAnnouncement({
                      workspaceId: workspaceId!,
                      announcementId: a.id,
                      data: { pinned: !a.pinned },
                    }),
                  )}
                >
                  {a.pinned ? "Открепить" : "Закрепить"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={wrap(async () => {
                    if (!window.confirm("Удалить объявление?")) return
                    await deleteAnnouncement({
                      workspaceId: workspaceId!,
                      announcementId: a.id,
                    })
                  })}
                >
                  Удалить
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
