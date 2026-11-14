"use client"

import { ExternalLink, ImagePlus, MoreHorizontal, Plus } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Textarea,
} from "@clubspace/ui-kit/ui"

import { getClubAbout, updateClubAbout, type ClubAbout } from "../../shared/api/club-about"
import {
  createClubLogoUpload,
  getClubPublicProfile,
  updateClubPublicProfile,
  type ClubPublicProfile,
} from "../../shared/api/public-profile"
import {
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from "../../shared/api/workspaces"
import { errorMessage } from "../../shared/lib/error-message"
import { useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { putToPresignedUrl } from "../../shared/upload-to-s3"
import {
  draftToInput as aboutToInput,
  MAX_ITEMS,
  moveItem,
  type ClubAboutDraft,
} from "../club-about/club-about-form"
import {
  DESCRIPTION_MAX,
  draftToInput as pageToInput,
  LOGO_CONTENT_TYPES,
  logoUploadFor,
  profileToDraft,
} from "../public-profile/public-profile-form"
import { SettingsSectionHeader } from "../settings/SettingsNav"
import { TimezoneSelect } from "../settings/TimezoneSelect"
import {
  changedParts,
  validateClubProfile,
  type ClubProfileDraft,
  type ClubProfilePart,
} from "./club-profile-form"

const aboutToDraft = (data: ClubAbout): ClubAboutDraft => ({
  contacts: data.contacts,
  links: data.links,
  rules: data.rules ?? "",
})

const PART_LABEL: Record<ClubProfilePart, string> = {
  page: "Публичная страница",
  about: "О клубе",
  timezone: "Часовой пояс",
}

// «Настройки → Профиль клуба»: the public page, «О клубе» for members and the
// club's time zone in one form with one «Сохранить».
export function ClubProfileForm({ workspaceId }: { workspaceId: string }) {
  const [draft, setDraft] = useState<ClubProfileDraft | null>(null)
  // What the server holds now; the form is dirty while the draft differs.
  const [saved, setSaved] = useState<ClubProfileDraft | null>(null)
  const [profile, setProfile] = useState<ClubPublicProfile | null>(null)
  const [clubName, setClubName] = useState("")
  // The saved signed URL, or a local preview of a freshly uploaded file.
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Saving replaces whole records, so a form that failed to load must not be
  // editable — saving an empty draft would wipe what is stored.
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [justSaved, setJustSaved] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    setError(null)
    Promise.all([
      getClubPublicProfile({ workspaceId }),
      getClubAbout({ workspaceId }),
      getWorkspaceSettings({ workspaceId }),
    ])
      .then(([page, about, settings]) => {
        if (cancelled) return
        const loaded: ClubProfileDraft = {
          page: profileToDraft(page),
          about: aboutToDraft(about),
          timezone: settings.timezone,
        }
        setProfile(page)
        setClubName(settings.name)
        setLogoPreview(page.logoUrl)
        setDraft(loaded)
        setSaved(loaded)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadFailed(true)
        setError(errorMessage(err, "Не удалось загрузить профиль клуба"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId, reloadKey])

  const parts = draft && saved ? changedParts(draft, saved) : []
  const dirty = parts.length > 0
  useDirtyGuard(dirty)

  const edit = (next: (d: ClubProfileDraft) => ClubProfileDraft) => {
    setDraft((d) => (d ? next(d) : d))
    setJustSaved(false)
  }
  const editPage = (patch: Partial<ClubProfileDraft["page"]>) =>
    edit((d) => ({ ...d, page: { ...d.page, ...patch } }))
  const editAbout = (patch: Partial<ClubAboutDraft>) =>
    edit((d) => ({ ...d, about: { ...d.about, ...patch } }))

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
      const upload = await createClubLogoUpload({ workspaceId, data: request.input })
      await putToPresignedUrl(upload.upload.url, file, {
        contentType: request.input.contentType,
      })
      editPage({ logoKey: upload.key })
      setLogoPreview(URL.createObjectURL(file))
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить логотип"))
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ""
    }
  }

  // Writes the changed parts one by one; each saved part becomes the new
  // baseline at once, so a failure leaves only the unsaved parts dirty.
  const handleSave = async () => {
    if (!draft || !saved) return
    const problem = validateClubProfile(draft, parts)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    setJustSaved(false)
    let failed = false
    for (const part of parts) {
      try {
        if (part === "page") {
          const data = await updateClubPublicProfile({
            workspaceId,
            data: pageToInput(draft.page),
          })
          setProfile(data)
          setLogoPreview(data.logoUrl)
          const stored = profileToDraft(data)
          setDraft((d) => (d ? { ...d, page: stored } : d))
          setSaved((s) => (s ? { ...s, page: stored } : s))
        } else if (part === "about") {
          // The server stores phones normalised (+7…); show what was saved.
          const stored = aboutToDraft(
            await updateClubAbout({ workspaceId, data: aboutToInput(draft.about) }),
          )
          setDraft((d) => (d ? { ...d, about: stored } : d))
          setSaved((s) => (s ? { ...s, about: stored } : s))
        } else {
          const { timezone } = await updateWorkspaceSettings({
            workspaceId,
            timezone: draft.timezone.trim(),
          })
          setDraft((d) => (d ? { ...d, timezone } : d))
          setSaved((s) => (s ? { ...s, timezone } : s))
        }
      } catch (err) {
        setError(`${PART_LABEL[part]}: ${errorMessage(err, "не удалось сохранить")}`)
        failed = true
        break
      }
    }
    setSaving(false)
    if (!failed) setJustSaved(true)
  }

  if (loading) {
    return <div className="h-96 animate-pulse rounded-xl border border-border bg-muted" />
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
  const { page, about } = draft

  return (
    <>
      <SettingsSectionHeader
        title="Профиль клуба"
        description="Как клуб видят люди, которые ещё не в клубе, и ученики в приложении."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-xl border border-border bg-card">
          <div className="space-y-8 p-5">
            <section className="space-y-4">
              <div>
                <h3 className="font-medium">Публичная страница</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Страница по ссылке-приглашению и QR-коду, страница клуба и
                  каталог клубов.
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="public-slug">Адрес страницы</Label>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-sm text-muted-foreground">/c/</span>
                  <Input
                    id="public-slug"
                    value={page.slug}
                    maxLength={64}
                    className="h-9"
                    onChange={(e) => editPage({ slug: e.target.value })}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Латинские буквы, цифры и дефис. После смены старая ссылка
                  перестанет работать.
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="public-city">Город</Label>
                <Input
                  id="public-city"
                  value={page.city}
                  maxLength={120}
                  placeholder="Например, Томск"
                  className="h-9"
                  onChange={(e) => editPage({ city: e.target.value })}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="public-description">Описание</Label>
                <Textarea
                  id="public-description"
                  value={page.description}
                  rows={5}
                  maxLength={DESCRIPTION_MAX}
                  placeholder="Чем занимаетесь, для кого занятия, чем клуб отличается"
                  onChange={(e) => editPage({ description: e.target.value })}
                />
                <p className="text-right text-xs text-muted-foreground">
                  {page.description.length} / {DESCRIPTION_MAX}
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
                    {uploading ? "Загружаем..." : page.logoKey ? "Заменить" : "Загрузить"}
                  </Button>
                  {page.logoKey && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        editPage({ logoKey: null })
                        setLogoPreview(null)
                      }}
                    >
                      Убрать
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
                  checked={page.isListed}
                  onChange={(e) => editPage({ isListed: e.target.checked })}
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">
                    Показывать клуб в каталоге
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Клуб появится в поиске клубов, а страница по адресу выше
                    станет доступна всем — с кнопкой «Вступить». Без этого клуб
                    видят только те, у кого есть код или ссылка-приглашение.
                  </span>
                </span>
              </label>
            </section>

            <section className="space-y-4 border-t border-border pt-6">
              <div>
                <h3 className="font-medium">О клубе</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Видно ученикам в приложении: Профиль → О клубе.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Контакты</Label>
                {about.contacts.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input
                      value={c.label}
                      aria-label="Подпись контакта"
                      placeholder="Например, Администратор"
                      maxLength={120}
                      className="h-9 min-w-[160px] flex-1"
                      onChange={(e) =>
                        editAbout({
                          contacts: about.contacts.map((x, j) =>
                            j === i ? { ...x, label: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Input
                      value={c.phone}
                      aria-label="Телефон"
                      placeholder="+7 952 884-94-20"
                      maxLength={32}
                      className="h-9 w-[180px]"
                      onChange={(e) =>
                        editAbout({
                          contacts: about.contacts.map((x, j) =>
                            j === i ? { ...x, phone: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <ItemMenu
                      label={`Контакт ${c.label || i + 1}`}
                      index={i}
                      count={about.contacts.length}
                      onMove={(delta) =>
                        editAbout({ contacts: moveItem(about.contacts, i, delta) })
                      }
                      onRemove={() =>
                        editAbout({ contacts: about.contacts.filter((_, j) => j !== i) })
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={about.contacts.length >= MAX_ITEMS}
                  onClick={() =>
                    editAbout({ contacts: [...about.contacts, { label: "", phone: "" }] })
                  }
                >
                  <Plus className="mr-1 size-4" /> Добавить контакт
                </Button>
              </div>

              <div className="space-y-2">
                <Label>Ссылки</Label>
                {about.links.map((l, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <Input
                      value={l.label}
                      aria-label="Подпись ссылки"
                      placeholder="Например, Сайт"
                      maxLength={60}
                      className="h-9 min-w-[160px] flex-1"
                      onChange={(e) =>
                        editAbout({
                          links: about.links.map((x, j) =>
                            j === i ? { ...x, label: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <Input
                      value={l.url}
                      aria-label="Адрес ссылки"
                      placeholder="https://"
                      maxLength={500}
                      className="h-9 min-w-[200px] flex-[2]"
                      onChange={(e) =>
                        editAbout({
                          links: about.links.map((x, j) =>
                            j === i ? { ...x, url: e.target.value } : x,
                          ),
                        })
                      }
                    />
                    <ItemMenu
                      label={`Ссылка ${l.label || i + 1}`}
                      index={i}
                      count={about.links.length}
                      onMove={(delta) => editAbout({ links: moveItem(about.links, i, delta) })}
                      onRemove={() =>
                        editAbout({ links: about.links.filter((_, j) => j !== i) })
                      }
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={about.links.length >= MAX_ITEMS}
                  onClick={() => editAbout({ links: [...about.links, { label: "", url: "" }] })}
                >
                  <Plus className="mr-1 size-4" /> Добавить ссылку
                </Button>
              </div>

              <div className="space-y-1">
                <Label htmlFor="club-rules">Правила клуба</Label>
                <Textarea
                  id="club-rules"
                  value={about.rules}
                  rows={6}
                  maxLength={10000}
                  placeholder="Абзацы разделяйте пустой строкой"
                  onChange={(e) => editAbout({ rules: e.target.value })}
                />
              </div>
            </section>

            <section className="space-y-2 border-t border-border pt-6">
              <div>
                <h3 className="font-medium">Часовой пояс клуба</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  В этом поясе хранятся слоты расписания. Выберите город клуба
                  или ближайший к нему — например, для Томска «Томск (UTC+7)».
                  Если у зала свой пояс, он задаётся в карточке зала.
                </p>
              </div>
              <TimezoneSelect
                id="settings-timezone"
                value={draft.timezone}
                onChange={(timezone) => edit((d) => ({ ...d, timezone }))}
                disabled={saving}
                className="max-w-sm"
              />
            </section>
          </div>

          <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 rounded-b-xl border-t border-border bg-card/95 px-5 py-3 backdrop-blur">
            {error ? (
              <p className="mr-auto text-sm text-destructive">{error}</p>
            ) : justSaved ? (
              <p className="mr-auto text-sm text-muted-foreground">Сохранено</p>
            ) : dirty ? (
              <p className="mr-auto text-sm text-muted-foreground">
                Есть несохранённые изменения
              </p>
            ) : null}
            <Button
              type="button"
              disabled={saving || uploading || !dirty}
              onClick={() => void handleSave()}
            >
              {saving ? "Сохраняем..." : "Сохранить"}
            </Button>
          </div>
        </div>

        <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
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
                  {(clubName || "?").slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate font-semibold">{clubName || "Ваш клуб"}</div>
                {page.city.trim() && (
                  <div className="text-xs text-muted-foreground">{page.city.trim()}</div>
                )}
              </div>
            </div>
            {page.description.trim() && (
              <p className="line-clamp-4 whitespace-pre-line px-4 pb-4 text-sm text-muted-foreground">
                {page.description.trim()}
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
              {profile.isListed ? "Открыть страницу клуба" : "Открыть страницу приглашения"}
            </a>
          ) : (
            <p className="text-xs text-muted-foreground">
              Публичный адрес приложения не настроен — ссылки появятся, когда
              администратор платформы задаст APP_URL.
            </p>
          )}
          {parts.includes("page") && previewUrl && (
            <p className="text-xs text-muted-foreground">
              По ссылке — сохранённая версия. Сохраните, чтобы увидеть изменения.
            </p>
          )}
        </aside>
      </div>
    </>
  )
}

// Reorder / remove one contact or link: a single «⋯» per row.
function ItemMenu({
  label,
  index,
  count,
  onMove,
  onRemove,
}: {
  label: string
  index: number
  count: number
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon" variant="ghost" aria-label={`Действия: ${label}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={index === 0} onSelect={() => onMove(-1)}>
          Выше
        </DropdownMenuItem>
        <DropdownMenuItem disabled={index === count - 1} onSelect={() => onMove(1)}>
          Ниже
        </DropdownMenuItem>
        <DropdownMenuItem className="text-destructive" onSelect={onRemove}>
          Удалить
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
