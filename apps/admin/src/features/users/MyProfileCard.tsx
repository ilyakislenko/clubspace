"use client"

import { useEffect, useState } from "react"

import { Button } from "@bjj-academy/ui-kit/ui"

import { fetchMe, type Me } from "../../shared/api/me"
import { updateMemberProfile } from "../../shared/api/members"
import { errorMessage } from "../../shared/lib/error-message"
import { ProfileEditForm } from "./ProfileEditForm"

// The current admin's own name. The owner has no WorkspaceMember row, so they
// can't be reached through the members-list → member card flow; this card lets
// any admin (owner included) set their own Имя/Фамилия. Backed by the same
// admin-only update-member-profile endpoint (which bypasses the membership
// requirement for the workspace owner).
export function MyProfileCard({ workspaceId }: { workspaceId: string }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    void fetchMe()
      .then((data) => {
        if (!cancelled) setMe(data)
      })
      .catch((err) => {
        if (!cancelled)
          setError(errorMessage(err, "Не удалось загрузить профиль."))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSave = async (patch: {
    firstname: string | null
    lastname: string | null
    email: string
  }) => {
    if (!me) return
    setSaving(true)
    setError(null)
    try {
      const result = await updateMemberProfile({
        workspaceId,
        userId: me.id,
        firstname: patch.firstname,
        lastname: patch.lastname,
        email: patch.email,
      })
      setMe((prev) =>
        prev
          ? {
              ...prev,
              firstname: result.firstname,
              lastname: result.lastname,
              email: result.email,
            }
          : prev,
      )
      setEditing(false)
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить профиль"))
    } finally {
      setSaving(false)
    }
  }

  if (loading || !me) {
    return (
      <div className="h-24 animate-pulse rounded-lg border border-border bg-muted" />
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">Мой профиль</div>
        {!editing && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setEditing(true)}
          >
            Изменить
          </Button>
        )}
      </div>
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {editing ? (
        <ProfileEditForm
          initial={{
            firstname: me.firstname ?? "",
            lastname: me.lastname ?? "",
            email: me.email,
          }}
          submitting={saving}
          onCancel={() => setEditing(false)}
          onSubmit={handleSave}
        />
      ) : (
        <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
          <dt className="text-muted-foreground">Имя</dt>
          <dd>
            {me.firstname || (
              <span className="italic text-muted-foreground">не задано</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Фамилия</dt>
          <dd>
            {me.lastname || (
              <span className="italic text-muted-foreground">не задано</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd>{me.email}</dd>
        </dl>
      )}
    </div>
  )
}
