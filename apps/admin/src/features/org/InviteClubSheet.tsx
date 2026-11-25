"use client"

import { useState } from "react"

import {
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import { findClubByJoinCode, inviteClubToOrganization, type ClubPreview } from "../../shared/api/organizations"
import { errorMessage } from "../../shared/lib/error-message"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { confirmLeave, useDirtyGuard } from "../../shared/lib/use-dirty-guard"

// «Пригласить клуб»: the club's join code → the club it names → the
// invitation (the owner decides in the club's «Настройки → Федерация»).
// No directory of clubs on purpose: the federation asks the club for its code.
export function InviteClubSheet({
  organizationId,
  open,
  onOpenChange,
  onInvited,
}: {
  organizationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onInvited: (clubName: string) => void
}) {
  const requestClose = async () => {
    if (await confirmLeave()) onOpenChange(false)
  }
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Пригласить клуб</SheetTitle>
          <SheetDescription>
            Попросите у владельца клуба его код — тот же, по которому вступают ученики.
          </SheetDescription>
        </SheetHeader>
        {open && (
          <InviteForm
            organizationId={organizationId}
            onCancel={() => void requestClose()}
            onInvited={(name) => {
              onInvited(name)
              onOpenChange(false)
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function InviteForm({
  organizationId,
  onCancel,
  onInvited,
}: {
  organizationId: string
  onCancel: () => void
  onInvited: (clubName: string) => void
}) {
  const [code, setCode] = useState("")
  const [club, setClub] = useState<ClubPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useDirtyGuard(code.trim() !== "")

  const find = async () => {
    setBusy(true)
    setError(null)
    setClub(null)
    try {
      setClub(await findClubByJoinCode(code.trim()))
    } catch (e) {
      setError(errorMessage(e, "Клуб с таким кодом не найден"))
    } finally {
      setBusy(false)
    }
  }

  const invite = async () => {
    if (!club) return
    setBusy(true)
    setError(null)
    try {
      await inviteClubToOrganization({ organizationId, joinCode: code.trim() })
      setCode("")
      onInvited(club.name)
    } catch (e) {
      setError(errorMessage(e, "Не удалось отправить приглашение"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto">
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (code.trim()) void find()
          }}
        >
          <Label htmlFor="org-invite-code">Код клуба</Label>
          <div className="flex gap-2">
            <Input
              id="org-invite-code"
              value={code}
              autoComplete="off"
              maxLength={FORM_LIMITS.orgInvite.joinCode.max}
              className="font-mono uppercase"
              onChange={(e) => {
                setCode(e.target.value)
                setClub(null)
              }}
              placeholder="RTMDANCE"
            />
            <Button type="submit" variant="outline" disabled={busy || !code.trim()}>
              Найти
            </Button>
          </div>
        </form>
        {club && (
          <div className="rounded-lg border border-border p-4">
            <div className="font-medium">{club.name}</div>
            {club.city && <div className="text-sm text-muted-foreground">{club.city}</div>}
          </div>
        )}
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
          <Button type="button" disabled={busy || !club} onClick={() => void invite()}>
            Отправить приглашение
          </Button>
        </div>
      </SheetFooter>
    </>
  )
}
