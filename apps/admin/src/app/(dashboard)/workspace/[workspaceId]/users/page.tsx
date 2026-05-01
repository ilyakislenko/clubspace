"use client"

import { useParams } from "next/navigation"
import { useState, type FormEvent } from "react"

import { Button, Input, Label } from "@bjj-academy/ui-kit/ui"

import { addWorkspaceMember } from "../../../../../shared/api/members"

type AddedMember = {
  email: string
  isNew: boolean
}

export default function WorkspaceUsersPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<AddedMember[]>([])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!workspaceId || !email.trim()) return

    setSubmitting(true)
    setError(null)
    try {
      const response = await addWorkspaceMember({
        workspaceId,
        email: email.trim(),
      })
      setAdded((prev) => [
        { email: response.email, isNew: response.isNew },
        ...prev,
      ])
      setEmail("")
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось добавить участника.",
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
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

      {added.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium">Добавлены в этой сессии</div>
          <ul className="space-y-1">
            {added.map((member) => (
              <li
                key={member.email}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>{member.email}</span>
                <span className="text-xs text-muted-foreground">
                  {member.isNew ? "Новый аккаунт" : "Уже существовал"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Список существующих участников появится в следующей итерации. Пока
        используйте этот экран только для добавления новых.
      </p>
    </div>
  )
}
