"use client"

import { useParams } from "next/navigation"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bjj-academy/ui-kit/ui"

import {
  createGroup,
  createGym,
  deleteGroup,
  deleteGym,
  listGroups,
  listGyms,
  syncGroupMembers,
  updateGroup,
  type GroupSummary,
  type Gym,
} from "../../../../../shared/api/groups"
import {
  listWorkspaceMembers,
  type WorkspaceMember,
} from "../../../../../shared/api/members"

const formatMemberLabel = (m: WorkspaceMember): string => {
  const full = [m.firstname, m.lastname].filter(Boolean).join(" ").trim()
  return full || m.email
}

const formatGroupMemberLabel = (m: {
  email: string
  firstname: string | null
  lastname: string | null
}): string => {
  const full = [m.firstname, m.lastname].filter(Boolean).join(" ").trim()
  return full || m.email
}

export default function WorkspaceGroupsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

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
  const [submitting, setSubmitting] = useState(false)

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
        err instanceof Error ? err.message : "Не удалось загрузить данные",
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [workspaceId])

  const nonOwnerMembers = useMemo(
    () => members.filter((m) => !m.isOwner),
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
      setError(err instanceof Error ? err.message : "Не удалось удалить")
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
      setError(err instanceof Error ? err.message : "Не удалось удалить зал")
    } finally {
      setBusyGymId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Группы</h1>
          <p className="text-sm text-muted-foreground">
            Тренеры, расписание и залы. Каждая группа закреплена за одним
            залом и одним тренером.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setShowGymForm((v) => !v)}
          >
            {showGymForm ? "Отмена" : "+ Зал"}
          </Button>
          <Button
            type="button"
            disabled={gyms.length === 0 || nonOwnerMembers.length === 0}
            onClick={() => setShowGroupForm((v) => !v)}
            title={
              gyms.length === 0
                ? "Сначала добавьте зал"
                : nonOwnerMembers.length === 0
                  ? "В клубе пока нет учеников"
                  : ""
            }
          >
            {showGroupForm ? "Отмена" : "+ Группа"}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {showGymForm && workspaceId && (
        <GymForm
          submitting={submitting}
          onCancel={() => setShowGymForm(false)}
          onSubmit={async ({ name, address }) => {
            setSubmitting(true)
            setError(null)
            try {
              await createGym({ workspaceId, name, address })
              setShowGymForm(false)
              await refresh()
            } catch (err) {
              setError(
                err instanceof Error ? err.message : "Не удалось создать зал",
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
          members={nonOwnerMembers}
          submitting={submitting}
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
                err instanceof Error
                  ? err.message
                  : "Не удалось создать группу",
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
            {gyms.map((gym) => (
              <li
                key={gym.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0">
                  <div className="font-medium">{gym.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {gym.address}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {gym.groupCount} группа(ы)
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => void handleDeleteGym(gym)}
                    disabled={busyGymId === gym.id}
                  >
                    {busyGymId === gym.id ? "..." : "Удалить"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">Группы</h2>
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
            Групп пока нет. Создайте — выберите зал, тренера, добавьте
            учеников.
          </p>
        ) : (
          <ul className="grid gap-3">
            {groups.map((group) =>
              editingGroupId === group.id && workspaceId ? (
                <li key={group.id}>
                  <GroupForm
                    mode="edit"
                    initial={{
                      name: group.name,
                      gymId: group.gym?.id ?? "",
                      coachId: group.coach.id,
                      scheduleText: group.scheduleText ?? "",
                      memberIds: group.members.map((m) => m.userId),
                    }}
                    gyms={gyms}
                    members={nonOwnerMembers}
                    submitting={submitting}
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
                          scheduleText: payload.scheduleText ?? null,
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
                          err instanceof Error
                            ? err.message
                            : "Не удалось сохранить",
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
                  className="space-y-3 rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="font-semibold">{group.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {group.gym ? (
                          <>
                            {group.gym.name} · {group.gym.address}
                          </>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20">
                            Без зала — выбери в «Изменить»
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                          Тренер:{" "}
                          {[group.coach.firstname, group.coach.lastname]
                            .filter(Boolean)
                            .join(" ") || group.coach.email}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700 ring-1 ring-inset ring-zinc-600/20">
                          {group.memberCount} учеников
                        </span>
                      </div>
                      {group.scheduleText && (
                        <div className="text-xs text-foreground">
                          Расписание: {group.scheduleText}
                        </div>
                      )}
                    </div>
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
                  </div>

                  {group.members.length > 0 && (
                    <div className="border-t border-border pt-3">
                      <div className="mb-1.5 text-xs uppercase text-muted-foreground">
                        Ученики
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {group.members.map((m) => (
                          <span
                            key={m.userId}
                            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                          >
                            {formatGroupMemberLabel(m)}
                          </span>
                        ))}
                      </div>
                    </div>
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

function GymForm({
  submitting,
  onCancel,
  onSubmit,
}: {
  submitting: boolean
  onCancel: () => void
  onSubmit: (payload: { name: string; address: string }) => Promise<void>
}) {
  const [name, setName] = useState("")
  const [address, setAddress] = useState("")

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !address.trim()) return
    void onSubmit({ name: name.trim(), address: address.trim() })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <h3 className="text-sm font-medium">Новый зал</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="gym-name">Название</Label>
          <Input
            id="gym-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Гладиатор"
            required
          />
        </div>
        <div>
          <Label htmlFor="gym-address">Адрес</Label>
          <Input
            id="gym-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Москва, Тимура Фрунзе 11"
            required
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          Отмена
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Сохраняю…" : "Создать"}
        </Button>
      </div>
    </form>
  )
}

type GroupFormPayload = {
  name: string
  gymId: string
  coachId: string
  scheduleText?: string | null
  memberIds?: string[]
}

function GroupForm({
  mode,
  initial,
  gyms,
  members,
  submitting,
  onCancel,
  onSubmit,
}: {
  mode: "create" | "edit"
  initial?: {
    name: string
    gymId: string
    coachId: string
    scheduleText: string
    memberIds: string[]
  }
  gyms: Gym[]
  members: WorkspaceMember[]
  submitting: boolean
  onCancel: () => void
  onSubmit: (payload: GroupFormPayload) => Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? "")
  const [gymId, setGymId] = useState(initial?.gymId ?? gyms[0]?.id ?? "")
  const [coachId, setCoachId] = useState(initial?.coachId ?? "")
  const [scheduleText, setScheduleText] = useState(initial?.scheduleText ?? "")
  const [memberIds, setMemberIds] = useState<string[]>(initial?.memberIds ?? [])

  const toggleMember = (userId: string) => {
    setMemberIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId],
    )
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !gymId || !coachId) return
    void onSubmit({
      name: name.trim(),
      gymId,
      coachId,
      scheduleText: scheduleText.trim() || null,
      memberIds,
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <h3 className="text-sm font-medium">
        {mode === "create" ? "Новая группа" : "Редактирование группы"}
      </h3>

      <div>
        <Label htmlFor="group-name">Название</Label>
        <Input
          id="group-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Утренняя"
          required
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Зал</Label>
          <Select value={gymId} onValueChange={setGymId}>
            <SelectTrigger>
              <SelectValue placeholder="Выберите зал" />
            </SelectTrigger>
            <SelectContent>
              {gyms.map((gym) => (
                <SelectItem key={gym.id} value={gym.id}>
                  {gym.name} · {gym.address}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Тренер</Label>
          <Select value={coachId} onValueChange={setCoachId}>
            <SelectTrigger>
              <SelectValue placeholder="Кто ведёт" />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {formatMemberLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="group-schedule">Расписание (свободный текст)</Label>
        <Input
          id="group-schedule"
          value={scheduleText}
          onChange={(e) => setScheduleText(e.target.value)}
          placeholder="Пн/Ср/Пт 19:00–20:30"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Ученики ({memberIds.length} выбрано)</Label>
        <div className="max-h-48 overflow-y-auto rounded-md border border-border">
          {members.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              В клубе пока нет учеников
            </p>
          ) : (
            members.map((m) => (
              <label
                key={m.userId}
                className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-muted/40"
              >
                <input
                  type="checkbox"
                  checked={memberIds.includes(m.userId)}
                  onChange={() => toggleMember(m.userId)}
                  disabled={m.userId === coachId}
                />
                <span className="flex-1 truncate">
                  {formatMemberLabel(m)}
                </span>
                {m.userId === coachId && (
                  <span className="text-xs text-muted-foreground italic">
                    тренер
                  </span>
                )}
              </label>
            ))
          )}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          Отмена
        </Button>
        <Button
          type="submit"
          disabled={submitting || !name.trim() || !gymId || !coachId}
        >
          {submitting
            ? "Сохраняю…"
            : mode === "create"
              ? "Создать группу"
              : "Сохранить"}
        </Button>
      </div>
    </form>
  )
}
