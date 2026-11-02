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
  addWorkspaceDependent,
  type AddDependentResult,
  type GuardianRelation,
} from "../../shared/api/members"
import { errorMessage } from "../../shared/lib/error-message"
import { GUARDIAN_RELATION_LABELS } from "../../shared/lib/guardians"
import { groupOptionLabel } from "../../shared/lib/group-label"

const NO_GROUP = "none"

// Local calendar date as YYYY-MM-DD — caps the birth-date picker at today.
const todayYmd = (): string => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

const RELATIONS: GuardianRelation[] = ["PARENT", "GUARDIAN", "OTHER"]

const buildNotice = (
  result: AddDependentResult,
  childName: string,
  guardianEmail: string,
  wantedEmail: boolean,
): string => {
  const parts = [
    `Готово: ${childName} в клубе. ${guardianEmail} подтвердит ребёнка в приложении ClubSpace.`,
  ]
  if (result.guardianIsNew)
    parts.push("Для родителя создан аккаунт — он войдёт по этому e-mail.")
  if (result.emailSent) parts.push("Письмо родителю отправлено.")
  else if (wantedEmail)
    parts.push("Письмо отправить не удалось — сообщите родителю сами.")
  else parts.push("Письмо не отправлялось — сообщите родителю сами.")
  return parts.join(" ")
}

// Club-side child profile: the child joins as a member right away; the named
// parent gets an invitation and confirms the link in the app.
export function AddDependentForm({
  workspaceId,
  onAdded,
}: {
  workspaceId: string
  onAdded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [firstname, setFirstname] = useState("")
  const [lastname, setLastname] = useState("")
  const [dateOfBirth, setDateOfBirth] = useState("")
  const [guardianEmail, setGuardianEmail] = useState("")
  const [relation, setRelation] = useState<GuardianRelation>("PARENT")
  const [groupId, setGroupId] = useState(NO_GROUP)
  const [sendEmail, setSendEmail] = useState(true)
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    listGroups({ workspaceId })
      .then((res) => setGroups(res.data))
      // The group is optional: a failed list just leaves «Без группы».
      .catch(() => setGroups([]))
  }, [workspaceId, open])

  const canSubmit =
    !!firstname.trim() && !!dateOfBirth && !!guardianEmail.trim()

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setError(null)
    setNotice(null)
    try {
      const email = guardianEmail.trim()
      const childName = [firstname.trim(), lastname.trim()]
        .filter(Boolean)
        .join(" ")
      const result = await addWorkspaceDependent({
        workspaceId,
        data: {
          firstname: firstname.trim(),
          dateOfBirth,
          guardianEmail: email,
          relation,
          sendEmail,
          ...(lastname.trim() ? { lastname: lastname.trim() } : {}),
          ...(groupId !== NO_GROUP ? { groupId } : {}),
        },
      })
      setNotice(buildNotice(result, childName, email, sendEmail))
      setFirstname("")
      setLastname("")
      setDateOfBirth("")
      setGuardianEmail("")
      setRelation("PARENT")
      setGroupId(NO_GROUP)
      onAdded()
    } catch (err) {
      setError(errorMessage(err, "Не удалось добавить ребёнка."))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <div className="space-y-2">
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          Добавить ребёнка
        </Button>
        {notice && (
          <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm">
            {notice}
          </p>
        )}
      </div>
    )
  }

  const selectedGroup = groups.find((g) => g.id === groupId)

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Добавить ребёнка</h2>
        <p className="text-xs text-muted-foreground">
          У ребёнка нет своего входа: он сразу появится среди участников, а
          родитель подтвердит его в приложении и будет записываться за него.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="dependent-firstname">Имя*</Label>
          <Input
            id="dependent-firstname"
            value={firstname}
            onChange={(event) => setFirstname(event.target.value)}
            required
            disabled={submitting}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dependent-lastname">Фамилия</Label>
          <Input
            id="dependent-lastname"
            value={lastname}
            onChange={(event) => setLastname(event.target.value)}
            disabled={submitting}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dependent-dob">Дата рождения*</Label>
          <Input
            id="dependent-dob"
            type="date"
            value={dateOfBirth}
            max={todayYmd()}
            onChange={(event) => setDateOfBirth(event.target.value)}
            required
            disabled={submitting}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dependent-guardian-email">E-mail родителя*</Label>
          <Input
            id="dependent-guardian-email"
            type="email"
            placeholder="parent@example.com"
            value={guardianEmail}
            onChange={(event) => setGuardianEmail(event.target.value)}
            required
            disabled={submitting}
          />
        </div>
        <div className="space-y-2">
          <Label>Кем приходится</Label>
          <Select
            value={relation}
            onValueChange={(value) => setRelation(value as GuardianRelation)}
          >
            <SelectTrigger disabled={submitting}>
              <SelectValue>{GUARDIAN_RELATION_LABELS[relation]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {RELATIONS.map((key) => (
                <SelectItem key={key} value={key}>
                  {GUARDIAN_RELATION_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
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
                  {groupOptionLabel(group)}
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
        Отправить письмо родителю
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

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={submitting || !canSubmit}>
          {submitting ? "Добавляем..." : "Добавить ребёнка"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          disabled={submitting}
        >
          Закрыть
        </Button>
      </div>
    </form>
  )
}
