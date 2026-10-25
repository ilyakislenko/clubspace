"use client"

import { useEffect, useState, type FormEvent } from "react"

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"

import { listGroups, type GroupSummary } from "../../shared/api/groups"
import {
  inviteWorkspaceMember,
  type InviteMemberResult,
} from "../../shared/api/invites"
import { errorMessage } from "../../shared/lib/error-message"

type Role = "user" | "coach"

const ROLE_LABELS: Record<Role, string> = {
  user: "Ученик",
  coach: "Тренер",
}

const NO_GROUP = "none"

const OUTCOME_NOTICE = {
  added: (email: string) => `Готово: ${email} в клубе`,
  approved: (email: string) => `Заявка ${email} принята`,
  restored: (email: string) => `Доступ ${email} восстановлен`,
} as const

const buildNotice = (result: InviteMemberResult, wantedEmail: boolean) => {
  const base = OUTCOME_NOTICE[result.outcome](result.email)
  if (result.emailSent) return `${base} — письмо отправлено`
  if (wantedEmail) return `${base} — письмо отправить не удалось`
  return base
}

export function InviteMemberForm({
  workspaceId,
  onInvited,
}: {
  workspaceId: string
  onInvited: () => void
}) {
  const [email, setEmail] = useState("")
  const [firstname, setFirstname] = useState("")
  const [lastname, setLastname] = useState("")
  const [role, setRole] = useState<Role>("user")
  const [groupId, setGroupId] = useState(NO_GROUP)
  const [sendEmail, setSendEmail] = useState(true)
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    listGroups({ workspaceId })
      .then((res) => setGroups(res.data))
      // The group is optional: a failed list just leaves «Без группы».
      .catch(() => setGroups([]))
  }, [workspaceId])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email.trim()) return

    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const result = await inviteWorkspaceMember({
        workspaceId,
        data: {
          email: email.trim(),
          role,
          sendEmail,
          ...(firstname.trim() ? { firstname: firstname.trim() } : {}),
          ...(lastname.trim() ? { lastname: lastname.trim() } : {}),
          ...(groupId !== NO_GROUP ? { groupId } : {}),
        },
      })
      setNotice(buildNotice(result, sendEmail))
      setEmail("")
      setFirstname("")
      setLastname("")
      onInvited()
    } catch (err) {
      setError(errorMessage(err, "Не удалось пригласить участника."))
    } finally {
      setSubmitting(false)
    }
  }

  const selectedGroup = groups.find((g) => g.id === groupId)

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2 sm:col-span-3">
          <Label htmlFor="invite-email">Email*</Label>
          <Input
            id="invite-email"
            type="email"
            placeholder="member@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            disabled={submitting}
          />
        </div>
        <div className="space-y-2 sm:col-span-3 sm:grid sm:grid-cols-2 sm:gap-3 sm:space-y-0">
          <div className="space-y-2">
            <Label htmlFor="invite-firstname">Имя</Label>
            <Input
              id="invite-firstname"
              value={firstname}
              onChange={(event) => setFirstname(event.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="invite-lastname">Фамилия</Label>
            <Input
              id="invite-lastname"
              value={lastname}
              onChange={(event) => setLastname(event.target.value)}
              disabled={submitting}
            />
          </div>
        </div>
        <div className="space-y-2 sm:col-span-1">
          <Label>Роль</Label>
          <Select
            value={role}
            onValueChange={(value) => setRole(value as Role)}
          >
            <SelectTrigger disabled={submitting}>
              <SelectValue>{ROLE_LABELS[role]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROLE_LABELS) as Role[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {ROLE_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label>Группа</Label>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger disabled={submitting}>
              <SelectValue>
                {selectedGroup ? selectedGroup.name : "Без группы"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_GROUP}>Без группы</SelectItem>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={sendEmail}
          onChange={(event) => setSendEmail(event.target.checked)}
          disabled={submitting}
        />
        Отправить письмо-приглашение
      </label>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
          {notice}
        </p>
      )}

      <Button type="submit" disabled={submitting || !email.trim()}>
        {submitting ? "Приглашаем..." : "Пригласить"}
      </Button>
    </form>
  )
}
