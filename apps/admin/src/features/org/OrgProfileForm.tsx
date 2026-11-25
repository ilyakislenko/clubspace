"use client"

import { ImagePlus } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button, Input, Label, Textarea } from "@clubspace/ui-kit/ui"

import { createOrganizationLogoUpload, updateOrganization, type Organization } from "../../shared/api/organizations"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { sameData, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { isStaleUpdate, StaleUpdateNotice } from "../../shared/ui/stale-update-notice"
import { putToPresignedUrl } from "../../shared/upload-to-s3"
import { LOGO_CONTENT_TYPES, logoUploadFor } from "../public-profile/public-profile-form"
import { TimezoneSelect } from "../settings/TimezoneSelect"

const L = FORM_LIMITS.organization

type Draft = { name: string; city: string; description: string; logoKey: string | null; timezone: string }

const toDraft = (o: Organization): Draft => ({
  name: o.name,
  city: o.city ?? "",
  description: o.description ?? "",
  logoKey: o.logoKey,
  timezone: o.timezone,
})

// «Настройки → Профиль» of the federation: what clubs and the team see.
// Sends the version it opened with; a save in between keeps the draft.
export function OrgProfileForm({ org, onSaved }: { org: Organization; onSaved: () => void }) {
  const [saved, setSaved] = useState<Draft>(() => toDraft(org))
  const [version, setVersion] = useState(org.updatedAt)
  const [draft, setDraft] = useState<Draft>(saved)
  const [logoPreview, setLogoPreview] = useState<string | null>(org.logoUrl)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState<unknown>(null)
  const [justSaved, setJustSaved] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // A newer federation than the one this form saved («Обновить» after a
  // 409, someone else's save): start again from it.
  useEffect(() => {
    if (org.updatedAt === version) return
    const next = toDraft(org)
    setSaved(next)
    setDraft(next)
    setVersion(org.updatedAt)
    setLogoPreview(org.logoUrl)
    setStale(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.updatedAt])

  const dirty = !sameData(draft, saved)
  useDirtyGuard(dirty)
  const edit = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setJustSaved(false)
  }

  const pickLogo = async (file: File | undefined) => {
    if (!file) return
    const request = logoUploadFor(file)
    if (!request.ok) {
      setError(request.error)
      return
    }
    setUploading(true)
    setError(null)
    try {
      const upload = await createOrganizationLogoUpload({ organizationId: org.id, data: request.input })
      await putToPresignedUrl(upload.upload.url, file, { contentType: request.input.contentType })
      edit({ logoKey: upload.key })
      setLogoPreview(URL.createObjectURL(file))
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить логотип"))
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    setStale(null)
    try {
      const updated = await updateOrganization({
        organizationId: org.id,
        data: {
          name: draft.name.trim(),
          city: draft.city.trim() || null,
          description: draft.description.trim() || null,
          logoKey: draft.logoKey,
          timezone: draft.timezone,
          expectedUpdatedAt: version,
        },
      })
      const next = toDraft(updated)
      setSaved(next)
      setDraft(next)
      setVersion(updated.updatedAt)
      setLogoPreview(updated.logoUrl)
      setJustSaved(true)
      onSaved()
    } catch (e) {
      if (isStaleUpdate(e)) setStale(e)
      else setError(errorMessage(e, "Не удалось сохранить"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="org-name">Название</Label>
        <Input id="org-name" value={draft.name} maxLength={L.name.max} onChange={(e) => edit({ name: e.target.value })} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="org-city">Город</Label>
          <Input id="org-city" value={draft.city} maxLength={L.city.max} onChange={(e) => edit({ city: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="org-timezone">Часовой пояс</Label>
          <TimezoneSelect id="org-timezone" value={draft.timezone} onChange={(timezone) => edit({ timezone })} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="org-description">Описание</Label>
        <Textarea
          id="org-description"
          rows={4}
          value={draft.description}
          maxLength={L.description.max}
          onChange={(e) => edit({ description: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <Label>Логотип</Label>
        <div className="flex flex-wrap items-center gap-3">
          {logoPreview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoPreview} alt="" className="size-12 rounded-md border border-border object-cover" />
          )}
          <input
            ref={fileInput}
            type="file"
            accept={LOGO_CONTENT_TYPES.join(",")}
            className="hidden"
            onChange={(e) => void pickLogo(e.target.files?.[0])}
          />
          <Button type="button" size="sm" variant="secondary" disabled={uploading} onClick={() => fileInput.current?.click()}>
            <ImagePlus className="mr-1 size-4" />
            {uploading ? "Загружаем..." : draft.logoKey ? "Заменить" : "Загрузить"}
          </Button>
          {draft.logoKey && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                edit({ logoKey: null })
                setLogoPreview(null)
              }}
            >
              Убрать
            </Button>
          )}
        </div>
      </div>
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}
      {stale !== null && <StaleUpdateNotice error={stale} onReload={onSaved} />}
      <div className="flex items-center justify-end gap-3">
        {justSaved && !dirty && <span className="text-sm text-muted-foreground">Сохранено</span>}
        <Button type="button" disabled={!dirty || saving || uploading || !draft.name.trim()} onClick={() => void save()}>
          {saving ? "Сохраняем…" : "Сохранить"}
        </Button>
      </div>
    </div>
  )
}
