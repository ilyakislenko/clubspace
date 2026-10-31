"use client"

import { ExternalLink, ImagePlus, Trash2 } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button, Input, Label, Textarea } from "@clubspace/ui-kit/ui"

import {
  createClubLogoUpload,
  getClubPublicProfile,
  updateClubPublicProfile,
  type ClubPublicProfile,
} from "../../shared/api/public-profile"
import { errorMessage } from "../../shared/lib/error-message"
import { putToPresignedUrl } from "../../shared/upload-to-s3"
import {
  DESCRIPTION_MAX,
  draftToInput,
  LOGO_CONTENT_TYPES,
  logoUploadFor,
  profileToDraft,
  validatePublicProfileDraft,
  type PublicProfileDraft,
} from "./public-profile-form"

export function PublicProfileSection({
  workspaceId,
  clubName,
}: {
  workspaceId: string
  clubName: string | null
}) {
  const [profile, setProfile] = useState<ClubPublicProfile | null>(null)
  const [draft, setDraft] = useState<PublicProfileDraft | null>(null)
  // What the preview shows for the logo: the saved signed URL, or a local
  // preview of a freshly uploaded file.
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    setError(null)
    void (async () => {
      try {
        const data = await getClubPublicProfile({ workspaceId })
        if (cancelled) return
        setProfile(data)
        setDraft(profileToDraft(data))
        setLogoPreview(data.logoUrl)
      } catch (err) {
        if (!cancelled) {
          setLoadFailed(true)
          setError(errorMessage(err, "Не удалось загрузить публичную страницу"))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [workspaceId, reloadKey])

  const edit = (patch: Partial<PublicProfileDraft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d))
    setSaved(false)
  }

  const handleLogoPicked = async (file: File | undefined) => {
    if (!file) return
    const request = logoUploadFor(file)
    if (!request.ok) {
      setError(request.error)
      return
    }
    setUploading(true)
    setError(null)
    try {
      const upload = await createClubLogoUpload({
        workspaceId,
        data: request.input,
      })
      await putToPresignedUrl(upload.upload.url, file, {
        contentType: request.input.contentType,
      })
      edit({ logoKey: upload.key })
      setLogoPreview(URL.createObjectURL(file))
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить логотип"))
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  const handleSave = async () => {
    if (!draft) return
    const problem = validatePublicProfileDraft(draft)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const data = await updateClubPublicProfile({
        workspaceId,
        data: draftToInput(draft),
      })
      setProfile(data)
      setDraft(profileToDraft(data))
      setLogoPreview(data.logoUrl)
      setSaved(true)
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить"))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="h-64 animate-pulse rounded-xl border border-border bg-muted" />
    )
  }

  if (loadFailed || !draft || !profile) {
    return (
      <div className="space-y-3 rounded-xl border border-border bg-card p-5">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setReloadKey((k) => k + 1)}
        >
          Повторить
        </Button>
      </div>
    )
  }

  // The page answers 404 until the club is listed; the join preview works
  // either way, so that is what an unlisted club can look at.
  const previewUrl = profile.isListed ? profile.pageUrl : profile.joinPageUrl
  const dirty =
    JSON.stringify(draftToInput(draft)) !==
    JSON.stringify(draftToInput(profileToDraft(profile)))

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-5 rounded-xl border border-border bg-card p-5">
        <div className="space-y-1">
          <Label htmlFor="public-slug">Адрес страницы</Label>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-sm text-muted-foreground">/c/</span>
            <Input
              id="public-slug"
              value={draft.slug}
              maxLength={64}
              className="h-9"
              onChange={(e) => edit({ slug: e.target.value })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Латинские буквы, цифры и дефис. После смены старая ссылка перестанет
            работать.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="public-city">Город</Label>
          <Input
            id="public-city"
            value={draft.city}
            maxLength={120}
            placeholder="Например, Томск"
            className="h-9"
            onChange={(e) => edit({ city: e.target.value })}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="public-description">Описание</Label>
          <Textarea
            id="public-description"
            value={draft.description}
            rows={6}
            maxLength={DESCRIPTION_MAX}
            placeholder="Чем занимаетесь, для кого тренировки, чем клуб отличается"
            onChange={(e) => edit({ description: e.target.value })}
          />
          <p className="text-right text-xs text-muted-foreground">
            {draft.description.length} / {DESCRIPTION_MAX}
          </p>
        </div>

        <div className="space-y-2">
          <Label>Логотип</Label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept={LOGO_CONTENT_TYPES.join(",")}
              className="hidden"
              onChange={(e) => void handleLogoPicked(e.target.files?.[0])}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
            >
              <ImagePlus className="mr-1 size-4" />
              {uploading
                ? "Загружаем..."
                : draft.logoKey
                  ? "Заменить"
                  : "Загрузить"}
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
                <Trash2 className="mr-1 size-4" /> Убрать
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            JPEG, PNG или WebP до 2 МБ, лучше квадратный.
          </p>
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-border p-3">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={draft.isListed}
            onChange={(e) => edit({ isListed: e.target.checked })}
          />
          <span className="space-y-1">
            <span className="block text-sm font-medium">
              Показывать клуб в каталоге
            </span>
            <span className="block text-xs text-muted-foreground">
              Клуб появится в поиске клубов, а страница по адресу выше станет
              доступна всем — с кнопкой «Вступить». Без этого клуб видят только
              те, у кого есть код или ссылка-приглашение.
            </span>
          </span>
        </label>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {saved && <p className="text-sm text-muted-foreground">Сохранено</p>}

        <Button
          type="button"
          size="sm"
          disabled={saving || uploading || !dirty}
          onClick={() => void handleSave()}
        >
          {saving ? "Сохраняем..." : "Сохранить"}
        </Button>
      </div>

      <aside className="space-y-3">
        <div className="text-sm font-medium">Как это увидят</div>
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center gap-3 p-4">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoPreview}
                alt=""
                className="size-14 rounded-xl border border-border object-cover"
              />
            ) : (
              <div className="flex size-14 items-center justify-center rounded-xl bg-primary/10 text-xl font-semibold text-primary">
                {(clubName ?? "?").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate font-semibold">{clubName ?? "Ваш клуб"}</div>
              {draft.city.trim() && (
                <div className="text-xs text-muted-foreground">
                  {draft.city.trim()}
                </div>
              )}
            </div>
          </div>
          {draft.description.trim() && (
            <p className="line-clamp-4 whitespace-pre-line px-4 pb-4 text-sm text-muted-foreground">
              {draft.description.trim()}
            </p>
          )}
        </div>
        {previewUrl ? (
          <a
            href={previewUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
          >
            <ExternalLink className="size-4" />
            {profile.isListed
              ? "Открыть страницу клуба"
              : "Открыть страницу приглашения"}
          </a>
        ) : (
          <p className="text-xs text-muted-foreground">
            Публичный адрес приложения не настроен — ссылки появятся, когда
            администратор платформы задаст APP_URL.
          </p>
        )}
        {dirty && previewUrl && (
          <p className="text-xs text-muted-foreground">
            По ссылке — сохранённая версия. Сохраните, чтобы увидеть изменения.
          </p>
        )}
      </aside>
    </div>
  )
}
