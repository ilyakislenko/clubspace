"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  createGroup,
  createGym,
  deleteGroup,
  deleteGym,
  listGroups,
  listGyms,
  syncGroupMembers,
  updateGroup,
  updateGym,
  type GroupSummary,
  type Gym,
} from "../../../../../shared/api/groups"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { fetchMe } from "../../../../../shared/api/me"
import {
  listWorkspaceMembers,
  type WorkspaceMember,
} from "../../../../../shared/api/members"
import { GroupScheduleBlock } from "../../../../../features/schedule/GroupScheduleBlock"
import { DirectionChip } from "../../../../../features/directions/DirectionChip"
import {
  ALL_DIRECTIONS,
  DirectionFilter,
  matchesDirectionFilter,
} from "../../../../../features/directions/DirectionFilter"
import { useDirections } from "../../../../../features/directions/use-directions"
import { AddCoachButton } from "../../../../../features/groups/AddCoachButton"
import { CoachChip } from "../../../../../features/groups/CoachChip"
import { GroupForm } from "../../../../../features/groups/GroupForm"
import { GymForm } from "../../../../../features/groups/GymForm"
import { isCoachCapable } from "../../../../../features/groups/helpers"
import { useDirectionScope } from "../../../../../shared/workspace/use-direction-scope"
import { pluralRu } from "../../../../../shared/lib/plural-ru"
import { useVocabulary } from "../../../../../shared/lib/vocabulary"
import { cap } from "@clubspace/ui-kit/brand"

const formatGroupMemberLabel = (m: {
  email: string | null
  firstname: string | null
  lastname: string | null
}): string => {
  const full = [m.firstname, m.lastname].filter(Boolean).join(" ").trim()
  return full || m.email || "—"
}

export default function WorkspaceGroupsPage() {
  const vocabulary = useVocabulary()
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  const scope = useDirectionScope(workspaceId)
  const canEditGyms = scope.isAdmin
  // A direction manager edits the groups of their directions plus the ones
  // they coach themselves; everyone else sees the page as before.
  const [myUserId, setMyUserId] = useState<string | null>(null)
  useEffect(() => {
    if (!scope.isDirectionManager) return
    void fetchMe()
      .then((me) => setMyUserId(me.id))
      .catch(() => setMyUserId(null))
  }, [scope.isDirectionManager])
  const coachesGroup = (group: GroupSummary) =>
    myUserId !== null && group.coaches.some((c) => c.userId === myUserId)
  const canEditGroup = (group: GroupSummary) =>
    scope.canEditSharedRow(group.direction?.id) || coachesGroup(group)
  const managerDirectionScope = scope.allowedDirectionIds && {
    allowedIds: scope.allowedDirectionIds,
    defaultDirectionId: scope.defaultDirectionId,
    ownUserId: myUserId,
  }

  const [gyms, setGyms] = useState<Gym[]>([])
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showGymForm, setShowGymForm] = useState(false)
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null)
  const [busyGymId, setBusyGymId] = useState<string | null>(null)
  const [editingGymId, setEditingGymId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { directions } = useDirections(workspaceId)
  const [directionFilter, setDirectionFilter] = useState(ALL_DIRECTIONS)
  const visibleGroups = groups.filter((g) =>
    matchesDirectionFilter(directionFilter, g.direction?.id),
  )

  const refresh = async () => {
    if (!workspaceId) return
    try {
      const [gymsResp, groupsResp, membersResp] = await Promise.all([
        listGyms({ workspaceId }),
        listGroups({ workspaceId }),
        listWorkspaceMembers({ workspaceId }),
      ])
      setGyms(gymsResp.data)
      setGroups(groupsResp.data)
      setMembers(membersResp.data)
    } catch (err) {
      setError(
        errorMessage(err, "Не удалось загрузить данные"),
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [workspaceId])

  // ?edit=<groupId> — «Редактировать» on the group page — opens that group's
  // form once the list is in. Read from window (not useSearchParams) to avoid
  // a Suspense boundary.
  useEffect(() => {
    if (loading) return
    const url = new URL(window.location.href)
    const id = url.searchParams.get("edit")
    if (!id) return
    url.searchParams.delete("edit")
    window.history.replaceState(window.history.state, "", url)
    if (!groups.some((g) => g.id === id)) return
    setEditingGroupId(id)
    requestAnimationFrame(() =>
      document
        .getElementById(`group-${id}`)
        ?.scrollIntoView({ block: "start", behavior: "smooth" }),
    )
  }, [loading, groups])

  const coachOptions = useMemo(
    () => members.filter(isCoachCapable),
    [members],
  )

  const handleDelete = async (group: GroupSummary) => {
    if (!workspaceId) return
    const ok = window.confirm(
      `Удалить группу «${group.name}»? Ученики останутся в клубе, но потеряют привязку к этой группе.`,
    )
    if (!ok) return
    setBusyGroupId(group.id)
    setError(null)
    try {
      await deleteGroup({ workspaceId, groupId: group.id })
      await refresh()
    } catch (err) {
      setError(errorMessage(err, "Не удалось удалить"))
    } finally {
      setBusyGroupId(null)
    }
  }

  const handleDeleteGym = async (gym: Gym) => {
    if (!workspaceId) return
    const warn =
      gym.groupCount > 0
        ? `Удалить зал «${gym.name}»? ${gym.groupCount} группа(ы) останутся без зала — позже сможешь привязать их к другому.`
        : `Удалить зал «${gym.name}»?`
    if (!window.confirm(warn)) return
    setBusyGymId(gym.id)
    setError(null)
    try {
      await deleteGym({ workspaceId, gymId: gym.id })
      await refresh()
    } catch (err) {
      setError(errorMessage(err, "Не удалось удалить зал"))
    } finally {
      setBusyGymId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Группы и расписание</h1>
          <p className="text-sm text-muted-foreground">
            {cap(vocabulary.coach.nomPl)}, расписание и залы. Каждая группа закреплена за одним
            залом и одним {vocabulary.coach.ins}.
          </p>
        </div>
        <div className="flex gap-2">
          {canEditGyms && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowGymForm((v) => !v)}
            >
              {showGymForm ? "Отмена" : "+ Зал"}
            </Button>
          )}
          <Button
            type="button"
            disabled={gyms.length === 0}
            onClick={() => setShowGroupForm((v) => !v)}
          >
            {showGroupForm ? "Отмена" : "+ Группа"}
          </Button>
        </div>
      </div>

      {!loading && gyms.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {canEditGyms
            ? "Чтобы создать группу, сначала добавьте зал."
            : "Попросите администратора добавить зал."}
        </p>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {showGymForm && workspaceId && (
        <GymForm
          submitting={submitting}
          onCancel={() => setShowGymForm(false)}
          onSubmit={async ({ name, address, timezone }) => {
            setSubmitting(true)
            setError(null)
            try {
              await createGym({ workspaceId, name, address, timezone })
              setShowGymForm(false)
              await refresh()
            } catch (err) {
              setError(
                errorMessage(err, "Не удалось создать зал"),
              )
            } finally {
              setSubmitting(false)
            }
          }}
        />
      )}

      {showGroupForm && workspaceId && (
        <GroupForm
          mode="create"
          gyms={gyms}
          directions={directions}
          members={members}
          coachOptions={coachOptions}
          submitting={submitting}
          directionScope={managerDirectionScope}
          onCancel={() => setShowGroupForm(false)}
          onSubmit={async (payload) => {
            setSubmitting(true)
            setError(null)
            try {
              await createGroup({ workspaceId, ...payload })
              setShowGroupForm(false)
              await refresh()
            } catch (err) {
              setError(
                errorMessage(err, "Не удалось создать группу"),
              )
            } finally {
              setSubmitting(false)
            }
          }}
        />
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Залы</h2>
        {loading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-md border border-border bg-muted"
              />
            ))}
          </div>
        ) : gyms.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Пока нет залов. Добавьте первый — и под него можно будет
            создавать группы.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {gyms.map((gym) =>
              editingGymId === gym.id && workspaceId ? (
                <li key={gym.id} className="p-3">
                  <GymForm
                    initial={{
                      name: gym.name,
                      address: gym.address,
                      timezone: gym.timezone,
                    }}
                    submitting={submitting}
                    submitLabel="Сохранить"
                    title="Изменить зал"
                    onCancel={() => setEditingGymId(null)}
                    onSubmit={async ({ name, address, timezone }) => {
                      setSubmitting(true)
                      setError(null)
                      try {
                        await updateGym({
                          workspaceId,
                          gymId: gym.id,
                          name,
                          address,
                          timezone,
                        })
                        setEditingGymId(null)
                        await refresh()
                      } catch (err) {
                        setError(
                          errorMessage(err, "Не удалось сохранить"),
                        )
                      } finally {
                        setSubmitting(false)
                      }
                    }}
                  />
                </li>
              ) : (
              <li
                key={gym.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <Link
                  href={`/workspace/${workspaceId}/gyms/${gym.id}`}
                  className="min-w-0 flex-1 hover:opacity-80"
                >
                  <div className="font-medium hover:underline">{gym.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {gym.address}
                  </div>
                </Link>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {gym.groupCount} группа(ы)
                  </div>
                  {canEditGyms && (
                    <>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditingGymId(gym.id)}
                    disabled={busyGymId === gym.id}
                  >
                    Изменить
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => void handleDeleteGym(gym)}
                    disabled={busyGymId === gym.id}
                  >
                    {busyGymId === gym.id ? "..." : "Удалить"}
                  </Button>
                    </>
                  )}
                </div>
              </li>
              ),
            )}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Группы</h2>
          <DirectionFilter
            directions={directions}
            value={directionFilter}
            onChange={setDirectionFilter}
          />
        </div>
        {loading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-20 animate-pulse rounded-md border border-border bg-muted"
              />
            ))}
          </div>
        ) : groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Групп пока нет. Создайте — выберите зал, {vocabulary.coach.acc}, добавьте
            учеников.
          </p>
        ) : visibleGroups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Нет групп в выбранном направлении.
          </p>
        ) : (
          <ul className="grid gap-3">
            {visibleGroups.map((group) =>
              editingGroupId === group.id && workspaceId ? (
                <li key={group.id} id={`group-${group.id}`}>
                  <GroupForm
                    mode="edit"
                    initial={{
                      name: group.name,
                      gymId: group.gym?.id ?? "",
                      coachId: group.coach.id,
                      directionId: group.direction?.id ?? null,
                      memberIds: group.members.map((m) => m.userId),
                      bookingMode: group.bookingMode,
                      capacity: group.capacity,
                      bookingWindowDays: group.bookingWindowDays,
                      bookingCancelHours: group.bookingCancelHours,
                    }}
                    gyms={gyms}
                    directions={directions}
                    members={members}
                    coachOptions={coachOptions}
                    submitting={submitting}
                    directionScope={
                      coachesGroup(group) ? undefined : managerDirectionScope
                    }
                    onCancel={() => setEditingGroupId(null)}
                    onSubmit={async (payload) => {
                      setSubmitting(true)
                      setError(null)
                      try {
                        await updateGroup({
                          workspaceId,
                          groupId: group.id,
                          name: payload.name,
                          gymId: payload.gymId,
                          coachId: payload.coachId,
                          directionId: payload.directionId,
                          bookingMode: payload.bookingMode,
                          capacity: payload.capacity,
                          bookingWindowDays: payload.bookingWindowDays,
                          bookingCancelHours: payload.bookingCancelHours,
                        })
                        // Server diffs + applies in one transaction; safer
                        // than the old per-member loop which could leave
                        // half-synced state on a network blip.
                        await syncGroupMembers({
                          workspaceId,
                          groupId: group.id,
                          userIds: payload.memberIds ?? [],
                        })
                        setEditingGroupId(null)
                        await refresh()
                      } catch (err) {
                        setError(
                          errorMessage(err, "Не удалось сохранить"),
                        )
                      } finally {
                        setSubmitting(false)
                      }
                    }}
                  />
                </li>
              ) : (
                <li
                  key={group.id}
                  id={`group-${group.id}`}
                  className="space-y-3 rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/workspace/${workspaceId}/groups/${group.id}`}
                          className="font-semibold hover:underline"
                        >
                          {group.name}
                        </Link>
                        <DirectionChip direction={group.direction} />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {group.gym ? (
                          <Link
                            href={`/workspace/${workspaceId}/gyms/${group.gym.id}`}
                            className="hover:underline"
                          >
                            {group.gym.name} · {group.gym.address}
                          </Link>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
                            Без зала — выбери в «Изменить»
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {group.coaches
                          .slice()
                          .sort((a, b) =>
                            a.role === b.role
                              ? 0
                              : a.role === 'primary'
                                ? -1
                                : 1,
                          )
                          .map((c) => {
                            const name =
                              [c.firstname, c.lastname]
                                .filter(Boolean)
                                .join(' ') || c.email || '—'
                            return (
                              <CoachChip
                                key={c.userId}
                                workspaceId={workspaceId!}
                                groupId={group.id}
                                userId={c.userId}
                                name={name}
                                role={c.role}
                                onRemoved={refresh}
                                onError={setError}
                              />
                            )
                          })}
                        {canEditGroup(group) && (
                          <AddCoachButton
                            workspaceId={workspaceId!}
                            groupId={group.id}
                            existingCoachIds={
                              new Set(group.coaches.map((c) => c.userId))
                            }
                            members={members}
                            onAdded={refresh}
                            onError={setError}
                          />
                        )}
                        <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700 ring-1 ring-inset ring-zinc-600/20">
                          {group.memberCount} учеников
                        </span>
                        {group.bookingMode === "BOOKING" && (
                          <span className="inline-flex items-center rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700 ring-1 ring-inset ring-sky-600/20">
                            Запись на {vocabulary.session.acc} ·{" "}
                            {group.capacity === null
                              ? "без ограничения мест"
                              : `${group.capacity} ${pluralRu(group.capacity, "место", "места", "мест")}`}
                          </span>
                        )}
                      </div>
                    </div>
                    {canEditGroup(group) && (
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditingGroupId(group.id)}
                          disabled={busyGroupId === group.id}
                        >
                          Изменить
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => void handleDelete(group)}
                          disabled={busyGroupId === group.id}
                        >
                          {busyGroupId === group.id ? "..." : "Удалить"}
                        </Button>
                      </div>
                    )}
                  </div>

                  {group.members.length > 0 && (
                    <div className="border-t border-border pt-3">
                      <div className="mb-1.5 text-xs uppercase text-muted-foreground">
                        Ученики
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {group.members.map((m) => (
                          <Link
                            key={m.userId}
                            href={`/workspace/${workspaceId}/users/${m.userId}`}
                            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs hover:bg-muted/70"
                          >
                            {formatGroupMemberLabel(m)}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {workspaceId && (
                    <GroupScheduleBlock
                      workspaceId={workspaceId}
                      group={group}
                      onChanged={refresh}
                    />
                  )}
                </li>
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  )
}
