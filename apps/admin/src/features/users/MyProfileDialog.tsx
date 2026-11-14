"use client"

import { useState } from "react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@clubspace/ui-kit/ui"

import { updateMe, type Me } from "../../shared/api/me"
import { errorMessage } from "../../shared/lib/error-message"
import { ProfileEditForm } from "./ProfileEditForm"

// «Мой профиль» from the account menu: the signed-in user's own name, any
// role (the owner has no WorkspaceMember row, so the member card can't reach
// them). The e-mail is the login: shown, not editable from a club.
export function MyProfileDialog({
  me,
  open,
  onOpenChange,
  onSaved,
}: {
  me: Me
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (me: Me) => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = (next: boolean) => {
    if (saving) return
    if (!next) setError(null)
    onOpenChange(next)
  }

  const handleSave = async (patch: {
    firstname: string | null
    lastname: string | null
  }) => {
    setSaving(true)
    setError(null)
    try {
      onSaved(
        await updateMe({ firstname: patch.firstname, lastname: patch.lastname }),
      )
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить профиль"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Мой профиль</DialogTitle>
          {me.email && <DialogDescription>{me.email}</DialogDescription>}
        </DialogHeader>
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {open && (
          <ProfileEditForm
            initial={{
              firstname: me.firstname ?? "",
              lastname: me.lastname ?? "",
            }}
            submitting={saving}
            onCancel={() => close(false)}
            onSubmit={handleSave}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
