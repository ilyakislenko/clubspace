"use client"

import { useParams } from "next/navigation"
import { useEffect, useMemo, useState, type FormEvent } from "react"

import { Button, Input, Label } from "@bjj-academy/ui-kit/ui"

import {
  addWorkspaceMember,
  listWorkspaceMembers,
  removeWorkspaceMember,
  updateMemberAccess,
  type WorkspaceMember,
} from "../../../../../shared/api/members"

const toDateInputValue = (iso: string | null): string => {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  // input[type=date] expects yyyy-MM-dd in the user's local timezone.
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

const dateInputToIso = (value: string): string | null => {
  if (!value) return null
  // Treat the date as end-of-day local time so "до 1 июня" фактически означает
  // что 1 июня участник ещё имеет доступ.
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return null
  const local = new Date(year, month - 1, day, 23, 59, 59, 999)
  return local.toISOString()
}

const formatAccessLabel = (iso: string | null): string => {
  if (!iso) return "Без ограничения"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  const formatted = date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })
  return date < new Date()
    ? `Истёк ${formatted}`
    : `Доступ до ${formatted}`
}

export default function WorkspaceUsersPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [accessDrafts, setAccessDrafts] = useState<Record<string, string>>({})
  const [savingAccessId, setSavingAccessId] = useState<string | null>(null)

  const loadMembers = async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const response = await listWorkspaceMembers({ workspaceId })
      setMembers(response.data)
      setAccessDrafts(
        Object.fromEntries(
          response.data.map((m) => [m.userId, toDateInputValue(m.accessUntil)]),
        ),
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось загрузить участников.",
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!workspaceId || !email.trim()) return

    setSubmitting(true)
    setError(null)
    try {
      await addWorkspaceMember({ workspaceId, email: email.trim() })
      setEmail("")
      await loadMembers()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось добавить участника.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  const handleRemove = async (member: WorkspaceMember) => {
    if (!workspaceId) return
    if (member.isOwner) return
    const ok = window.confirm(`Удалить ${member.email} из клуба?`)
    if (!ok) return

    setRemovingId(member.userId)
    setError(null)
    try {
      await removeWorkspaceMember({ workspaceId, userId: member.userId })
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось удалить участника.",
      )
    } finally {
      setRemovingId(null)
    }
  }

  const handleAccessSave = async (
    member: WorkspaceMember,
    nextRaw: string | null,
  ) => {
    if (!workspaceId) return
    const next = nextRaw === null ? null : dateInputToIso(nextRaw)
    setSavingAccessId(member.userId)
    setError(null)
    try {
      const response = await updateMemberAccess({
        workspaceId,
        userId: member.userId,
        accessUntil: next,
      })
      setMembers((prev) =>
        prev.map((m) =>
          m.userId === member.userId
            ? { ...m, accessUntil: response.accessUntil }
            : m,
        ),
      )
      setAccessDrafts((prev) => ({
        ...prev,
        [member.userId]: toDateInputValue(response.accessUntil),
      }))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось сохранить доступ.",
      )
    } finally {
      setSavingAccessId(null)
    }
  }

  const formatName = (member: WorkspaceMember) => {
    const parts = [member.firstname, member.lastname].filter(Boolean)
    return parts.length ? parts.join(" ") : member.email
  }

  const draftDirtyByUser = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const member of members) {
      const draft = accessDrafts[member.userId] ?? ""
      const original = toDateInputValue(member.accessUntil)
      map[member.userId] = draft !== original
    }
    return map
  }, [accessDrafts, members])

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Участники клуба</h1>
        <p className="text-sm text-muted-foreground">
          Добавьте участника по email — он сможет войти в клиент через код,
          отправленный на эту почту.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-border bg-card p-4"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr,auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="member-email">Email участника</Label>
            <Input
              id="member-email"
              type="email"
              placeholder="member@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={submitting}
            />
          </div>
          <Button type="submit" disabled={submitting || !email.trim()}>
            {submitting ? "Добавляем..." : "Добавить"}
          </Button>
        </div>
      </form>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            Участники {members.length > 0 && `(${members.length})`}
          </h2>
          {loading && (
            <span className="text-xs text-muted-foreground">
              Обновление...
            </span>
          )}
        </div>

        {!loading && members.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Пока никого нет. Добавьте первого участника.
          </p>
        )}

        {members.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {members.map((member) => {
              const draft = accessDrafts[member.userId] ?? ""
              const dirty = draftDirtyByUser[member.userId]
              const expired =
                member.accessUntil !== null &&
                new Date(member.accessUntil) < new Date()
              return (
                <li
                  key={member.userId}
                  className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr),auto]"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {formatName(member)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{member.email}</span>
                      <span>·</span>
                      <span className="uppercase">{member.status}</span>
                      {member.isOwner && (
                        <>
                          <span>·</span>
                          <span className="font-medium text-primary">
                            Владелец
                          </span>
                        </>
                      )}
                      {!member.isOwner && (
                        <>
                          <span>·</span>
                          <span
                            className={
                              expired
                                ? "font-medium text-destructive"
                                : member.accessUntil
                                  ? "text-foreground"
                                  : ""
                            }
                          >
                            {formatAccessLabel(member.accessUntil)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {!member.isOwner && (
                      <>
                        <input
                          type="date"
                          value={draft}
                          onChange={(event) =>
                            setAccessDrafts((prev) => ({
                              ...prev,
                              [member.userId]: event.target.value,
                            }))
                          }
                          disabled={savingAccessId === member.userId}
                          className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={
                            !dirty || savingAccessId === member.userId
                          }
                          onClick={() =>
                            void handleAccessSave(member, draft || null)
                          }
                        >
                          {savingAccessId === member.userId
                            ? "Сохраняем..."
                            : "Сохранить"}
                        </Button>
                        {member.accessUntil && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={savingAccessId === member.userId}
                            onClick={() => void handleAccessSave(member, null)}
                          >
                            Снять
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => void handleRemove(member)}
                          disabled={removingId === member.userId}
                        >
                          {removingId === member.userId
                            ? "Удаляем..."
                            : "Удалить"}
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
