"use client"

import { useParams } from "next/navigation"
import { useEffect, useState, type FormEvent } from "react"

import { Button, Input, Label } from "@bjj-academy/ui-kit/ui"

import {
  addWorkspaceMember,
  listWorkspaceMembers,
  removeWorkspaceMember,
  type WorkspaceMember,
} from "../../../../../shared/api/members"

export default function WorkspaceUsersPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [loading, setLoading] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const loadMembers = async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const response = await listWorkspaceMembers({ workspaceId })
      setMembers(response.data)
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
      await removeWorkspaceMember({
        workspaceId,
        userId: member.userId,
      })
      setMembers((prev) => prev.filter((m) => m.userId !== member.userId))
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось удалить участника.",
      )
    } finally {
      setRemovingId(null)
    }
  }

  const formatName = (member: WorkspaceMember) => {
    const parts = [member.firstname, member.lastname].filter(Boolean)
    return parts.length ? parts.join(" ") : member.email
  }

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
            <span className="text-xs text-muted-foreground">Обновление...</span>
          )}
        </div>

        {!loading && members.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Пока никого нет. Добавьте первого участника.
          </p>
        )}

        {members.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {members.map((member) => (
              <li
                key={member.userId}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <div className="min-w-0 flex-1">
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
                  </div>
                </div>
                {!member.isOwner && (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => void handleRemove(member)}
                    disabled={removingId === member.userId}
                  >
                    {removingId === member.userId ? "Удаляем..." : "Удалить"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
