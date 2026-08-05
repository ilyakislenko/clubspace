"use client"

import { useEffect, useState } from "react"

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
  Textarea,
} from "@clubspace/ui-kit/ui"

import {
  createPlaylist,
  createPlaylistThumbnailUpload,
  updatePlaylist,
  type PlaylistResponse,
} from "../../shared/api/playlists"
import { errorMessage } from "../../shared/lib/error-message"
import {
  ALLOWED_THUMBNAIL_ACCEPT,
  isAllowedThumbnailType,
  THUMBNAIL_REJECT_MESSAGE,
} from "../../shared/upload-types"
import { putToPresignedUrl } from "../../shared/upload-to-s3"

type Props = {
  workspaceId: string
  mode: "create" | "edit"
  open: boolean
  onOpenChange: (open: boolean) => void
  // Required in edit mode; the form initialises from it each time it opens.
  playlist?: PlaylistResponse | null
  onSaved: (playlist: PlaylistResponse) => void
}

export function PlaylistFormSheet({
  workspaceId,
  mode,
  open,
  onOpenChange,
  playlist,
  onSaved,
}: Props) {
  const [title, setTitle] = useState("")
  const [slug, setSlug] = useState("")
  const [description, setDescription] = useState("")
  const [level, setLevel] = useState("")
  const [tags, setTags] = useState("")
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null)
  const [thumbnailPreview, setThumbnailPreview] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  // Edit mode re-initialises from the playlist each time it opens (mirrors the
  // old imperative openEditPlaylist). Create mode intentionally keeps whatever
  // was typed across open/close until a successful submit clears it.
  useEffect(() => {
    if (!open || mode !== "edit" || !playlist) return
    setTitle(playlist.title)
    setSlug(playlist.slug)
    setDescription(playlist.description ?? "")
    setLevel(playlist.level ?? "")
    setTags(playlist.tags.join(", "))
    setThumbnailFile(null)
    setThumbnailPreview(playlist.thumbnailUrl ?? "")
    setError("")
  }, [open, mode, playlist])

  const resetCreateForm = () => {
    setTitle("")
    setSlug("")
    setDescription("")
    setLevel("")
    setTags("")
    setThumbnailFile(null)
    setThumbnailPreview("")
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setError("")
    onOpenChange(nextOpen)
  }

  const handleThumbnailChange = (file: File | null) => {
    setError("")
    if (!file) {
      setThumbnailFile(null)
      setThumbnailPreview(mode === "edit" ? (playlist?.thumbnailUrl ?? "") : "")
      return
    }
    if (!isAllowedThumbnailType(file.type)) {
      setError(THUMBNAIL_REJECT_MESSAGE)
      return
    }
    setThumbnailFile(file)
    setThumbnailPreview(URL.createObjectURL(file))
  }

  const handleSubmit = async () => {
    if (!workspaceId || !title.trim()) return
    if (mode === "create" && !slug.trim()) return

    setSaving(true)
    setError("")

    const tagList = tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)

    try {
      if (mode === "create") {
        let created = await createPlaylist({
          workspaceId,
          data: {
            title: title.trim(),
            slug: slug.trim(),
            description: description.trim() || undefined,
            level: level.trim() || undefined,
            tags: tagList,
          },
        })

        if (thumbnailFile) {
          const upload = await createPlaylistThumbnailUpload({
            workspaceId,
            playlistId: created.id,
            contentType: thumbnailFile.type,
          })
          await putToPresignedUrl(upload.upload.url, thumbnailFile, {
            contentType: thumbnailFile.type,
          })
          created = await updatePlaylist({
            workspaceId,
            playlistId: created.id,
            data: { thumbnailUrl: upload.publicUrl },
          })
        }

        onSaved(created)
        resetCreateForm()
        onOpenChange(false)
      } else {
        if (!playlist) return

        let thumbnailUrl: string | null | undefined = undefined
        if (thumbnailFile) {
          const upload = await createPlaylistThumbnailUpload({
            workspaceId,
            playlistId: playlist.id,
            contentType: thumbnailFile.type,
          })
          await putToPresignedUrl(upload.upload.url, thumbnailFile, {
            contentType: thumbnailFile.type,
          })
          thumbnailUrl = upload.publicUrl
        }

        const updated = await updatePlaylist({
          workspaceId,
          playlistId: playlist.id,
          data: {
            title: title.trim(),
            description: description.trim() || null,
            level: level.trim() || null,
            tags: tagList,
            ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
          },
        })

        onSaved(updated)
        onOpenChange(false)
      }
    } catch (err) {
      setError(
        errorMessage(
          err,
          mode === "create"
            ? "Не удалось создать курс. Попробуйте ещё раз."
            : "Не удалось сохранить изменения.",
        ),
      )
    } finally {
      setSaving(false)
    }
  }

  const isCreate = mode === "create"

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{isCreate ? "Новый курс" : "Редактировать курс"}</SheetTitle>
          <SheetDescription>
            {isCreate
              ? "Заполните основные поля — позже их можно будет отредактировать."
              : "Slug менять нельзя — он используется в ссылках."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto">
          <div className="space-y-2">
            <Label htmlFor="playlist-title">Название</Label>
            <Input
              id="playlist-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={isCreate ? "Closed Guard" : undefined}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="playlist-slug">Slug</Label>
            {isCreate ? (
              <>
                <Input
                  id="playlist-slug"
                  value={slug}
                  onChange={(event) => setSlug(event.target.value)}
                  placeholder="closed-guard"
                />
                <p className="text-xs text-muted-foreground">
                  Будет в URL курса. Изменить позже нельзя.
                </p>
              </>
            ) : (
              <Input id="playlist-slug" value={slug} readOnly disabled />
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="playlist-level">Уровень</Label>
            <Input
              id="playlist-level"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
              placeholder="beginner / intermediate / advanced"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="playlist-description">Описание</Label>
            <Textarea
              id="playlist-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={isCreate ? "О чём этот курс и для кого." : undefined}
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="playlist-tags">Теги (через запятую)</Label>
            <Input
              id="playlist-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder={isCreate ? "guard, fundamentals" : undefined}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="playlist-thumbnail">Превью</Label>
            <div className="flex items-start gap-4">
              <input
                id="playlist-thumbnail"
                type="file"
                accept={ALLOWED_THUMBNAIL_ACCEPT}
                onChange={(event) =>
                  handleThumbnailChange(event.target.files?.[0] ?? null)
                }
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm hover:file:bg-muted"
              />
              {thumbnailPreview && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbnailPreview}
                  alt="Превью"
                  className="h-16 w-28 shrink-0 rounded-md border border-border object-cover"
                />
              )}
            </div>
            {!isCreate && (
              <p className="text-xs text-muted-foreground">
                Оставьте пустым, чтобы не менять текущее превью.
              </p>
            )}
            {isCreate && error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
          </div>

          {!isCreate && error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <SheetFooter>
          <div className="flex w-full items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={
                saving ||
                !title.trim() ||
                (isCreate && !slug.trim())
              }
            >
              {isCreate
                ? saving
                  ? "Создаём..."
                  : "Создать курс"
                : saving
                  ? "Сохраняем..."
                  : "Сохранить"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
