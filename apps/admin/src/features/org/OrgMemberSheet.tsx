"use client"

import { useState } from "react"

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import { addOrgMember, type OrgMember } from "../../shared/api/organizations"
import { errorMessage } from "../../shared/lib/error-message"
import { confirmLeave, sameData, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { ORG_ROLES, orgRoleLabel, type OrgRole } from "./org-view"

const ROLE_HINT: Record<OrgRole, string> = {
  ORG_ADMIN: "Всё: клубы, команда, объявления и настройки.",
  ORG_COACH: "Реестр, календарь и стандарты; клубы и объявления — только просмотр.",
}

// «Добавить» (e-mail + role) or the role of someone already on the team —
// the same request: the server adds or updates by e-mail.
export function OrgMemberSheet({
  organizationId,
  open,
  onOpenChange,
  member,
  onSaved,
}: {
  organizationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // null = a new person.
  member: OrgMember | null
  onSaved: () => void
}) {
  const requestClose = async () => {
    if (await confirmLeave()) onOpenChange(false)
  }
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{member ? (member.name ?? member.email ?? "Участник команды") : "Добавить в команду"}</SheetTitle>
          <SheetDescription>
            {member
              ? member.email
              : "Если аккаунта с этой почтой нет, он создастся; вход — по коду из письма."}
          </SheetDescription>
        </SheetHeader>
        {open && (
          <MemberForm
            key={member?.userId ?? "new"}
            organizationId={organizationId}
            member={member}
            onCancel={() => void requestClose()}
            onSaved={() => {
              onSaved()
              onOpenChange(false)
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function MemberForm({
  organizationId,
  member,
  onCancel,
  onSaved,
}: {
  organizationId: string
  member: OrgMember | null
  onCancel: () => void
  onSaved: () => void
}) {
  const vocabulary = useVocabulary()
  const initial = { email: member?.email ?? "", role: (member?.role ?? "ORG_COACH") as OrgRole }
  const [email, setEmail] = useState(initial.email)
  const [role, setRole] = useState<OrgRole>(initial.role)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = !sameData({ email, role }, initial)
  useDirtyGuard(dirty)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await addOrgMember({ organizationId, data: { email: email.trim(), role } })
      onSaved()
    } catch (e) {
      setError(errorMessage(e, "Не удалось сохранить"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto">
        {!member && (
          <div className="space-y-2">
            <Label htmlFor="org-member-email">Эл. почта</Label>
            <Input
              id="org-member-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="coach@federation.ru"
            />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="org-member-role">Роль</Label>
          <Select value={role} onValueChange={(v) => setRole(v as OrgRole)}>
            <SelectTrigger id="org-member-role">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORG_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {orgRoleLabel(r, vocabulary)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{ROLE_HINT[role]}</p>
        </div>
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <SheetFooter>
        <div className="flex w-full items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
          <Button type="button" disabled={busy || !email.trim() || !dirty} onClick={() => void save()}>
            {member ? "Сохранить" : "Добавить"}
          </Button>
        </div>
      </SheetFooter>
    </>
  )
}
