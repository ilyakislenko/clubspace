"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

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

import { createCategory, type CategoryResponse } from "../../shared/api/categories"
import { errorMessage } from "../../shared/lib/error-message"
import { type PlaylistResponse } from "../../shared/api/playlists"
import { createTag, type TagResponse } from "../../shared/api/tags"
import {
  completeVideoUpload,
  createVideoThumbnailUpload,
  createVideoUpload,
  deleteVideo,
  getVideo,
  updateVideo,
} from "../../shared/api/videos"
import {
  ALLOWED_THUMBNAIL_ACCEPT,
  isAllowedThumbnailType,
  THUMBNAIL_REJECT_MESSAGE,
} from "../../shared/upload-types"
import { putToPresignedUrl } from "../../shared/upload-to-s3"

const slugify = (value: string): string => {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
  // slug only has to be non-empty (server validates min(1)); fall back to the
  // lowercased name so a pure-punctuation input still produces something.
  return slug || value.trim().toLowerCase()
}

type Props = {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  playlists: PlaylistResponse[]
  tags: TagResponse[]
  categories: CategoryResponse[]
  tagsLoading: boolean
  categoriesLoading: boolean
  // The inline tag/category creators append to the workspace-level lists owned
  // by the parent page (shared with the rest of the content screen).
  onTagCreated: (tag: TagResponse) => void
  onCategoryCreated: (category: CategoryResponse) => void
}

export function VideoUploadSheet({
  workspaceId,
  open,
  onOpenChange,
  playlists,
  tags,
  categories,
  tagsLoading,
  categoriesLoading,
  onTagCreated,
  onCategoryCreated,
}: Props) {
  const router = useRouter()

  const [videoTitle, setVideoTitle] = useState("")
  const [videoDescription, setVideoDescription] = useState("")
  const [videoThumbnailFile, setVideoThumbnailFile] = useState<File | null>(null)
  const [videoThumbnailPreview, setVideoThumbnailPreview] = useState<string>("")
  const [videoThumbnailError, setVideoThumbnailError] = useState<string>("")
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [uploadStep, setUploadStep] = useState(1)
  const [uploadState, setUploadState] = useState<{
    status: "idle" | "uploading" | "processing" | "ready" | "error"
    message?: string
    videoId?: string
    progress?: number
  }>({ status: "idle" })
  const uploadAbortRef = useRef<AbortController | null>(null)
  // Synchronous re-entrancy guard for the upload handler. React state isn't
  // updated within the same tick, so a status check alone can't stop a fast
  // double-click from starting two uploads (and creating duplicate rows).
  const uploadInProgressRef = useRef(false)

  const [newTagType, setNewTagType] = useState("")
  const [newTagName, setNewTagName] = useState("")
  const [tagCreating, setTagCreating] = useState(false)
  const [taxonomyError, setTaxonomyError] = useState("")
  const [newCategoryName, setNewCategoryName] = useState("")
  const [categoryCreating, setCategoryCreating] = useState(false)

  const canUpload = useMemo(
    () => Boolean(workspaceId && videoTitle.trim() && videoFile),
    [workspaceId, videoTitle, videoFile]
  )

  const tagsByType = useMemo(() => {
    return tags.reduce<Record<string, TagResponse[]>>((acc, tag) => {
      acc[tag.type] = acc[tag.type] ?? []
      acc[tag.type].push(tag)
      return acc
    }, {})
  }, [tags])

  useEffect(() => {
    if (!videoThumbnailFile) {
      setVideoThumbnailPreview("")
      return
    }

    const previewUrl = URL.createObjectURL(videoThumbnailFile)
    setVideoThumbnailPreview(previewUrl)

    return () => {
      URL.revokeObjectURL(previewUrl)
    }
  }, [videoThumbnailFile])

  const handleCreateTag = async () => {
    const type = newTagType.trim()
    const name = newTagName.trim()
    if (!workspaceId || !type || !name) return
    setTagCreating(true)
    setTaxonomyError("")
    try {
      const created = await createTag({
        workspaceId,
        data: { type, name, slug: slugify(name) },
      })
      onTagCreated(created)
      setSelectedTagIds((prev) => [...prev, created.id])
      setNewTagName("")
    } catch (error) {
      setTaxonomyError(
        errorMessage(error, "Не удалось создать тег."),
      )
    } finally {
      setTagCreating(false)
    }
  }

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim()
    if (!workspaceId || !name) return
    setCategoryCreating(true)
    setTaxonomyError("")
    try {
      const created = await createCategory({
        workspaceId,
        data: { name, slug: slugify(name) },
      })
      onCategoryCreated(created)
      setSelectedCategoryIds((prev) => [...prev, created.id])
      setNewCategoryName("")
    } catch (error) {
      setTaxonomyError(
        errorMessage(error, "Не удалось создать категорию."),
      )
    } finally {
      setCategoryCreating(false)
    }
  }

  const handleUpload = async () => {
    if (!workspaceId || !videoFile || !videoTitle.trim()) return
    // Guard against a double-submit re-running the whole upload. The ref is
    // synchronous (the status check below reads React state, which lags a
    // tick, so a fast double-click could pass it twice and create duplicate
    // video rows).
    if (uploadInProgressRef.current) return
    if (uploadState.status === "uploading" || uploadState.status === "processing") {
      return
    }
    uploadInProgressRef.current = true

    const abortController = new AbortController()
    uploadAbortRef.current = abortController

    setUploadState({
      status: "uploading",
      message: "Готовим загрузку...",
      progress: 0,
    })

    // Track the created row so an aborted/failed upload doesn't leave an
    // orphaned "uploading" video behind. `handedOff` flips once the file is
    // queued for transcoding — after that the pipeline owns the row, so a
    // later thumbnail/metadata failure must NOT delete a processing video.
    let createdVideoId: string | null = null
    let handedOff = false

    try {
      const trimmedTitle = videoTitle.trim()
      const trimmedDescription = videoDescription.trim()
      let thumbnailUrl: string | null = null
      const createResponse = await createVideoUpload({
        workspaceId,
        title: trimmedTitle,
        description: trimmedDescription ? trimmedDescription : undefined,
        contentType: videoFile.type || "video/mp4",
        sizeBytes: videoFile.size,
      })
      createdVideoId = createResponse.videoId

      await putToPresignedUrl(createResponse.upload.url, videoFile, {
        contentType: videoFile.type || "video/mp4",
        signal: abortController.signal,
        onProgress: ({ percent }) =>
          setUploadState({
            status: "uploading",
            message: "Загружаем видео...",
            videoId: createResponse.videoId,
            progress: percent,
          }),
      })

      setUploadState({
        status: "processing",
        message: "Файл загружен, ставим в очередь...",
        videoId: createResponse.videoId,
      })

      await completeVideoUpload({
        workspaceId,
        videoId: createResponse.videoId,
      })
      handedOff = true

      if (videoThumbnailFile) {
        const thumbnailUpload = await createVideoThumbnailUpload({
          workspaceId,
          videoId: createResponse.videoId,
          contentType: videoThumbnailFile.type || "image/jpeg",
        })

        await putToPresignedUrl(thumbnailUpload.upload.url, videoThumbnailFile, {
          contentType: videoThumbnailFile.type || "image/jpeg",
        })

        thumbnailUrl = thumbnailUpload.publicUrl
      }

      await updateVideo({
        workspaceId,
        videoId: createResponse.videoId,
        data: {
          title: trimmedTitle,
          description: trimmedDescription ? trimmedDescription : null,
          thumbnailUrl,
          tagIds: selectedTagIds,
          categoryIds: selectedCategoryIds,
          playlistIds: selectedPlaylistId ? [selectedPlaylistId] : [],
        },
      })

      const details = await getVideo({
        workspaceId,
        videoId: createResponse.videoId,
      })

      setUploadState({
        status: details.status === "ready" ? "ready" : "processing",
        message:
          details.status === "ready"
            ? "Видео готово к просмотру"
            : "Видео загружено и обрабатывается",
        videoId: createResponse.videoId,
      })
    } catch (error) {
      // Best-effort cleanup of the orphaned row: only when we created it but
      // never handed it to transcoding (an aborted or failed PUT). Swallow
      // cleanup errors — surfacing the original failure matters more.
      if (createdVideoId && !handedOff) {
        try {
          await deleteVideo({ workspaceId, videoId: createdVideoId })
        } catch {
          // ignore — the original error is what the user needs to see
        }
      }
      if (error instanceof DOMException && error.name === "AbortError") {
        setUploadState({ status: "idle", message: "Загрузка отменена" })
        return
      }
      setUploadState({
        status: "error",
        message: errorMessage(error, "Ошибка загрузки"),
      })
    } finally {
      uploadAbortRef.current = null
      uploadInProgressRef.current = false
    }
  }

  const handleCancelUpload = () => {
    uploadAbortRef.current?.abort()
  }

  const resetUploadForm = () => {
    setVideoTitle("")
    setVideoDescription("")
    setVideoThumbnailFile(null)
    setVideoThumbnailPreview("")
    setVideoThumbnailError("")
    setVideoFile(null)
    setSelectedPlaylistId(null)
    setSelectedTagIds([])
    setSelectedCategoryIds([])
    setUploadStep(1)
    setUploadState({ status: "idle" })
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && uploadState.status === "uploading") return
    onOpenChange(nextOpen)
    if (!nextOpen) {
      resetUploadForm()
    }
  }

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    )
  }

  const toggleCategory = (categoryId: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(categoryId)
        ? prev.filter((id) => id !== categoryId)
        : [...prev, categoryId]
    )
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="flex h-full w-full flex-col sm:max-w-2xl">
        <SheetHeader className="space-y-2">
          <SheetTitle>Загрузка видео</SheetTitle>
          <SheetDescription>
            Следуйте шагам, чтобы загрузить файл и заполнить все поля.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
          {[
            { id: 1, label: "Файл" },
            { id: 2, label: "Детали" },
            { id: 3, label: "Теги и плейлисты" },
            { id: 4, label: "Проверка" },
          ].map((step, index, array) => (
            <div key={step.id} className="flex items-center gap-3">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${
                  uploadStep >= step.id
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {step.id}
              </div>
              <span
                className={
                  uploadStep >= step.id
                    ? "text-foreground"
                    : "text-muted-foreground"
                }
              >
                {step.label}
              </span>
              {index < array.length - 1 && (
                <div className="h-px w-6 bg-border" />
              )}
            </div>
          ))}
        </div>

        <div className="mt-6 min-h-0 flex-1 space-y-6 overflow-y-auto pr-2">
          {uploadStep === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="video-file">Файл (mp4)</Label>
                <Input
                  id="video-file"
                  type="file"
                  accept="video/mp4,video/quicktime,video/x-m4v"
                  onChange={(event) => {
                    setVideoFile(event.target.files?.[0] ?? null)
                  }}
                />
              </div>
              {videoFile && (
                <div className="rounded-md border border-dashed border-border p-3 text-sm">
                  <div className="font-medium">{videoFile.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {Math.round(videoFile.size / 1024 / 1024)} MB
                  </div>
                </div>
              )}
            </div>
          )}

          {uploadStep === 2 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="video-title">Название</Label>
                <Input
                  id="video-title"
                  value={videoTitle}
                  onChange={(event) => setVideoTitle(event.target.value)}
                  placeholder="Например, Guard retention basics"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="video-description">Описание</Label>
                <textarea
                  id="video-description"
                  value={videoDescription}
                  onChange={(event) => setVideoDescription(event.target.value)}
                  placeholder="Краткое описание видео"
                  className="min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="video-thumbnail">Превью (картинка)</Label>
                <Input
                  id="video-thumbnail"
                  type="file"
                  accept={ALLOWED_THUMBNAIL_ACCEPT}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null
                    if (file && !isAllowedThumbnailType(file.type)) {
                      setVideoThumbnailFile(null)
                      setVideoThumbnailError(THUMBNAIL_REJECT_MESSAGE)
                      return
                    }

                    setVideoThumbnailError("")
                    setVideoThumbnailFile(file)
                  }}
                />
                {videoThumbnailError && (
                  <p className="text-xs text-destructive">
                    {videoThumbnailError}
                  </p>
                )}
                {videoThumbnailFile && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      {videoThumbnailFile.name}
                    </p>
                    <div className="overflow-hidden rounded-md border border-border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={videoThumbnailPreview}
                        alt="Preview"
                        className="h-40 w-full object-cover"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {uploadStep === 3 && (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="video-playlist">Плейлист</Label>
                <select
                  id="video-playlist"
                  value={selectedPlaylistId ?? ""}
                  onChange={(event) =>
                    setSelectedPlaylistId(
                      event.target.value ? event.target.value : null
                    )
                  }
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Без плейлиста</option>
                  {playlists.map((playlist) => (
                    <option key={playlist.id} value={playlist.id}>
                      {playlist.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium">Теги</div>
                {tagsLoading && (
                  <div className="text-xs text-muted-foreground">
                    Загружаем теги...
                  </div>
                )}
                {!tagsLoading && tags.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    Тегов пока нет — создайте первый ниже.
                  </div>
                )}
                <div className="space-y-4">
                  {Object.entries(tagsByType).map(([type, items]) => (
                    <div key={type} className="space-y-2">
                      <div className="text-xs font-semibold uppercase text-muted-foreground">
                        {type}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {items.map((tag) => (
                          <label
                            key={tag.id}
                            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={selectedTagIds.includes(tag.id)}
                              onChange={() => toggleTag(tag.id)}
                              className="h-4 w-4"
                            />
                            <span>{tag.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                  <Input
                    value={newTagType}
                    onChange={(e) => setNewTagType(e.target.value)}
                    placeholder="Тип (напр. position)"
                    className="h-9 w-[180px]"
                  />
                  <Input
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Название тега"
                    className="h-9 w-[200px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        void handleCreateTag()
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-9"
                    disabled={
                      tagCreating || !newTagType.trim() || !newTagName.trim()
                    }
                    onClick={() => void handleCreateTag()}
                  >
                    Добавить тег
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="text-sm font-medium">Категории</div>
                {categoriesLoading && (
                  <div className="text-xs text-muted-foreground">
                    Загружаем категории...
                  </div>
                )}
                {!categoriesLoading && categories.length === 0 && (
                  <div className="text-xs text-muted-foreground">
                    Категорий пока нет — создайте первую ниже.
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {categories.map((category) => (
                    <label
                      key={category.id}
                      className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCategoryIds.includes(category.id)}
                        onChange={() => toggleCategory(category.id)}
                        className="h-4 w-4"
                      />
                      <span>{category.name}</span>
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                  <Input
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="Название категории"
                    className="h-9 w-[200px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        void handleCreateCategory()
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-9"
                    disabled={categoryCreating || !newCategoryName.trim()}
                    onClick={() => void handleCreateCategory()}
                  >
                    Добавить категорию
                  </Button>
                </div>
                {taxonomyError && (
                  <p className="text-sm text-destructive">{taxonomyError}</p>
                )}
              </div>
            </div>
          )}

          {uploadStep === 4 && (
            <div className="space-y-4">
              <div className="rounded-md border border-border p-4 text-sm">
                <div className="space-y-2">
                  <div>
                    <span className="text-muted-foreground">Название: </span>
                    {videoTitle || "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Описание: </span>
                    {videoDescription || "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Превью: </span>
                    {videoThumbnailFile?.name ?? "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Плейлист: </span>
                    {selectedPlaylistId
                      ? playlists.find(
                          (playlist) => playlist.id === selectedPlaylistId
                        )?.title ?? "—"
                      : "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Теги: </span>
                    {selectedTagIds.length
                      ? selectedTagIds
                          .map(
                            (tagId) =>
                              tags.find((tag) => tag.id === tagId)?.name
                          )
                          .filter(Boolean)
                          .join(", ")
                      : "—"}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Категории: </span>
                    {selectedCategoryIds.length
                      ? selectedCategoryIds
                          .map(
                            (categoryId) =>
                              categories.find(
                                (category) => category.id === categoryId
                              )?.name
                          )
                          .filter(Boolean)
                          .join(", ")
                      : "—"}
                  </div>
                </div>
              </div>
              {uploadState.message && (
                <p
                  className={
                    uploadState.status === "error"
                      ? "text-sm text-destructive"
                      : "text-sm text-muted-foreground"
                  }
                >
                  {uploadState.message}
                </p>
              )}
              {uploadState.status === "uploading" && (
                <div className="space-y-1">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-200"
                      style={{ width: `${uploadState.progress ?? 0}%` }}
                    />
                  </div>
                  <p className="text-right text-xs text-muted-foreground">
                    {uploadState.progress ?? 0}%
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        <SheetFooter className="mt-8">
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setUploadStep((prev) => Math.max(1, prev - 1))}
              disabled={uploadStep === 1}
            >
              Назад
            </Button>

            {uploadStep < 4 && (
              <Button
                type="button"
                onClick={() => setUploadStep((prev) => Math.min(4, prev + 1))}
                disabled={
                  (uploadStep === 1 && !videoFile) ||
                  (uploadStep === 2 && !videoTitle.trim())
                }
              >
                Далее
              </Button>
            )}

            {uploadStep === 4 &&
              (uploadState.videoId &&
              (uploadState.status === "ready" ||
                uploadState.status === "processing") ? (
                <Button
                  type="button"
                  onClick={() =>
                    router.push(
                      `/workspace/${workspaceId}/videos/${uploadState.videoId}`,
                    )
                  }
                >
                  Открыть видео
                </Button>
              ) : uploadState.status === "uploading" ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleCancelUpload}
                >
                  Отменить
                </Button>
              ) : (
                <Button
                  type="button"
                  disabled={!canUpload}
                  onClick={handleUpload}
                >
                  Загрузить
                </Button>
              ))}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
