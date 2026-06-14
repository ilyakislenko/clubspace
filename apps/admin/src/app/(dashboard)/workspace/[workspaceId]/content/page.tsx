"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@bjj-academy/ui-kit/ui"
import { ChevronDown, Plus } from "lucide-react"

import { VideoList } from "../../../../../features/content/VideoList"
import {
  createCategory,
  listCategories,
  type CategoryResponse,
} from "../../../../../shared/api/categories"
import {
  createPlaylist,
  createPlaylistThumbnailUpload,
  deletePlaylist,
  listPlaylists,
  updatePlaylist,
  type PlaylistResponse,
} from "../../../../../shared/api/playlists"
import {
  createTag,
  listTags,
  type TagResponse,
} from "../../../../../shared/api/tags"
import {
  completeVideoUpload,
  createVideoThumbnailUpload,
  createVideoUpload,
  getVideo,
  updateVideo,
} from "../../../../../shared/api/videos"
import {
  ALLOWED_THUMBNAIL_ACCEPT,
  isAllowedThumbnailType,
  THUMBNAIL_REJECT_MESSAGE,
} from "../../../../../shared/upload-types"
import { putToPresignedUrl } from "../../../../../shared/upload-to-s3"

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

export default function WorkspaceContentPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  const router = useRouter()

  const [videoTitle, setVideoTitle] = useState("")
  const [videoDescription, setVideoDescription] = useState("")
  const [videoThumbnailFile, setVideoThumbnailFile] = useState<File | null>(
    null
  )
  const [videoThumbnailPreview, setVideoThumbnailPreview] = useState<string>("")
  const [videoThumbnailError, setVideoThumbnailError] = useState<string>("")
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
    null
  )
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadStep, setUploadStep] = useState(1)
  const [uploadState, setUploadState] = useState<{
    status: "idle" | "uploading" | "processing" | "ready" | "error"
    message?: string
    videoId?: string
    progress?: number
  }>({ status: "idle" })
  const uploadAbortRef = useRef<AbortController | null>(null)

  const [playlistTitle, setPlaylistTitle] = useState("")
  const [playlistSlug, setPlaylistSlug] = useState("")
  const [playlistDescription, setPlaylistDescription] = useState("")
  const [playlistLevel, setPlaylistLevel] = useState("")
  const [playlistTags, setPlaylistTags] = useState("")
  const [playlistThumbnailFile, setPlaylistThumbnailFile] =
    useState<File | null>(null)
  const [playlistThumbnailPreview, setPlaylistThumbnailPreview] = useState("")
  const [playlistThumbnailError, setPlaylistThumbnailError] = useState("")
  const [playlistSaving, setPlaylistSaving] = useState(false)
  const [playlists, setPlaylists] = useState<PlaylistResponse[]>([])

  const [createPlaylistOpen, setCreatePlaylistOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<"videos" | "courses">("videos")
  const [editPlaylist, setEditPlaylist] = useState<PlaylistResponse | null>(
    null,
  )
  const [editTitle, setEditTitle] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editLevel, setEditLevel] = useState("")
  const [editTags, setEditTags] = useState("")
  const [editThumbnailFile, setEditThumbnailFile] = useState<File | null>(null)
  const [editThumbnailPreview, setEditThumbnailPreview] = useState("")
  const [editError, setEditError] = useState("")
  const [editSaving, setEditSaving] = useState(false)
  const [playlistsLoading, setPlaylistsLoading] = useState(false)
  const [tags, setTags] = useState<TagResponse[]>([])
  const [tagsLoading, setTagsLoading] = useState(false)
  const [categories, setCategories] = useState<CategoryResponse[]>([])
  const [categoriesLoading, setCategoriesLoading] = useState(false)

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

  const loadPlaylists = async () => {
    if (!workspaceId) return
    setPlaylistsLoading(true)
    try {
      const response = await listPlaylists({ workspaceId })
      setPlaylists(response.data)
    } finally {
      setPlaylistsLoading(false)
    }
  }

  const loadTags = async () => {
    if (!workspaceId) return
    setTagsLoading(true)
    try {
      const response = await listTags({ workspaceId })
      setTags(response.data)
    } finally {
      setTagsLoading(false)
    }
  }

  const loadCategories = async () => {
    if (!workspaceId) return
    setCategoriesLoading(true)
    try {
      const response = await listCategories({ workspaceId })
      setCategories(response.data)
    } finally {
      setCategoriesLoading(false)
    }
  }

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
      setTags((prev) => [...prev, created])
      setSelectedTagIds((prev) => [...prev, created.id])
      setNewTagName("")
    } catch (error) {
      setTaxonomyError(
        error instanceof Error ? error.message : "Не удалось создать тег.",
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
      setCategories((prev) => [...prev, created])
      setSelectedCategoryIds((prev) => [...prev, created.id])
      setNewCategoryName("")
    } catch (error) {
      setTaxonomyError(
        error instanceof Error ? error.message : "Не удалось создать категорию.",
      )
    } finally {
      setCategoryCreating(false)
    }
  }

  useEffect(() => {
    void loadPlaylists()
    void loadTags()
    void loadCategories()
  }, [workspaceId])

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

  const handleUpload = async () => {
    if (!workspaceId || !videoFile || !videoTitle.trim()) return
    // Guard against a double-submit re-running the whole upload.
    if (uploadState.status === "uploading" || uploadState.status === "processing") {
      return
    }

    const abortController = new AbortController()
    uploadAbortRef.current = abortController

    setUploadState({
      status: "uploading",
      message: "Готовим загрузку...",
      progress: 0,
    })

    try {
      const trimmedTitle = videoTitle.trim()
      const trimmedDescription = videoDescription.trim()
      let thumbnailUrl: string | null = null
      const createResponse = await createVideoUpload({
        workspaceId,
        title: trimmedTitle,
        description: trimmedDescription ? trimmedDescription : undefined,
        contentType: videoFile.type || "video/mp4",
      })

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
      if (error instanceof DOMException && error.name === "AbortError") {
        setUploadState({ status: "idle", message: "Загрузка отменена" })
        return
      }
      setUploadState({
        status: "error",
        message: error instanceof Error ? error.message : "Ошибка загрузки",
      })
    } finally {
      uploadAbortRef.current = null
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

  const handleUploadOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && uploadState.status === "uploading") return
    setUploadOpen(nextOpen)
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

  const handlePlaylistThumbnailChange = (file: File | null) => {
    setPlaylistThumbnailError("")
    if (!file) {
      setPlaylistThumbnailFile(null)
      setPlaylistThumbnailPreview("")
      return
    }
    if (!isAllowedThumbnailType(file.type)) {
      setPlaylistThumbnailError(THUMBNAIL_REJECT_MESSAGE)
      return
    }
    setPlaylistThumbnailFile(file)
    setPlaylistThumbnailPreview(URL.createObjectURL(file))
  }

  const handleCreatePlaylist = async () => {
    if (!workspaceId || !playlistTitle.trim() || !playlistSlug.trim()) {
      return
    }

    const tags = playlistTags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)

    setPlaylistSaving(true)
    setPlaylistThumbnailError("")

    try {
      let playlist = await createPlaylist({
        workspaceId,
        data: {
          title: playlistTitle.trim(),
          slug: playlistSlug.trim(),
          description: playlistDescription.trim() || undefined,
          level: playlistLevel.trim() || undefined,
          tags,
        },
      })

      if (playlistThumbnailFile) {
        const upload = await createPlaylistThumbnailUpload({
          workspaceId,
          playlistId: playlist.id,
          contentType: playlistThumbnailFile.type,
        })
        await putToPresignedUrl(upload.upload.url, playlistThumbnailFile, {
          contentType: playlistThumbnailFile.type,
        })
        playlist = await updatePlaylist({
          workspaceId,
          playlistId: playlist.id,
          data: { thumbnailUrl: upload.publicUrl },
        })
      }

      setPlaylists((prev) => [playlist, ...prev])
      setPlaylistTitle("")
      setPlaylistSlug("")
      setPlaylistDescription("")
      setPlaylistLevel("")
      setPlaylistTags("")
      setPlaylistThumbnailFile(null)
      setPlaylistThumbnailPreview("")
      setCreatePlaylistOpen(false)
    } catch (error) {
      setPlaylistThumbnailError(
        error instanceof Error
          ? error.message
          : "Не удалось создать курс. Попробуйте ещё раз.",
      )
    } finally {
      setPlaylistSaving(false)
    }
  }

  const openEditPlaylist = (playlist: PlaylistResponse) => {
    setEditPlaylist(playlist)
    setEditTitle(playlist.title)
    setEditDescription(playlist.description ?? "")
    setEditLevel(playlist.level ?? "")
    setEditTags(playlist.tags.join(", "))
    setEditThumbnailFile(null)
    setEditThumbnailPreview(playlist.thumbnailUrl ?? "")
    setEditError("")
  }

  const handleEditThumbnailChange = (file: File | null) => {
    setEditError("")
    if (!file) {
      setEditThumbnailFile(null)
      setEditThumbnailPreview(editPlaylist?.thumbnailUrl ?? "")
      return
    }
    if (!isAllowedThumbnailType(file.type)) {
      setEditError(THUMBNAIL_REJECT_MESSAGE)
      return
    }
    setEditThumbnailFile(file)
    setEditThumbnailPreview(URL.createObjectURL(file))
  }

  const handleSaveEditPlaylist = async () => {
    if (!workspaceId || !editPlaylist || !editTitle.trim()) return

    setEditSaving(true)
    setEditError("")

    try {
      const tags = editTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)

      let thumbnailUrl: string | null | undefined = undefined
      if (editThumbnailFile) {
        const upload = await createPlaylistThumbnailUpload({
          workspaceId,
          playlistId: editPlaylist.id,
          contentType: editThumbnailFile.type,
        })
        await putToPresignedUrl(upload.upload.url, editThumbnailFile, {
          contentType: editThumbnailFile.type,
        })
        thumbnailUrl = upload.publicUrl
      }

      const updated = await updatePlaylist({
        workspaceId,
        playlistId: editPlaylist.id,
        data: {
          title: editTitle.trim(),
          description: editDescription.trim() || null,
          level: editLevel.trim() || null,
          tags,
          ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
        },
      })

      setPlaylists((prev) =>
        prev.map((item) => (item.id === editPlaylist.id ? updated : item)),
      )
      setEditPlaylist(null)
    } catch (error) {
      setEditError(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить изменения.",
      )
    } finally {
      setEditSaving(false)
    }
  }

  const handleDeletePlaylist = async (playlist: PlaylistResponse) => {
    if (!workspaceId) return
    const confirmed = window.confirm("Удалить плейлист?")
    if (!confirmed) return

    try {
      await deletePlaylist({ workspaceId, playlistId: playlist.id })
      setPlaylists((prev) => prev.filter((item) => item.id !== playlist.id))
    } catch {
      // Surface the failure instead of swallowing it (the row stays in the DB).
      window.alert("Не удалось удалить плейлист. Попробуйте ещё раз.")
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Контент</h1>
          <p className="text-sm text-muted-foreground">
            Видео и курсы воркспейса.
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" className="gap-2">
              <Plus className="size-4" />
              Создать
              <ChevronDown className="size-4 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => setUploadOpen(true)}>
              Загрузить видео
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setCreatePlaylistOpen(true)}>
              Новый курс
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-2 border-b border-border">
        {(
          [
            { id: "videos" as const, label: "Видео" },
            { id: "courses" as const, label: "Курсы" },
          ]
        ).map((tab) => {
          const active = tab.id === activeTab
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative -mb-px px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {activeTab === "videos" && workspaceId && (
        <VideoList workspaceId={workspaceId} />
      )}

      <Sheet open={uploadOpen} onOpenChange={handleUploadOpenChange}>
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
                      <span className="text-muted-foreground">
                        Плейлист:{" "}
                      </span>
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
                      <span className="text-muted-foreground">
                        Категории:{" "}
                      </span>
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

      {activeTab === "courses" && (
      <section className="space-y-4">
        <div className="flex items-center justify-end">
          {playlistsLoading && (
            <span className="text-xs text-muted-foreground">Обновление...</span>
          )}
        </div>

        <div className="divide-y rounded-lg border border-border">
          {playlists.map((playlist) => (
            <div
              key={playlist.id}
              className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-muted/40"
            >
              <button
                type="button"
                onClick={() =>
                  router.push(
                    `/workspace/${workspaceId}/content/courses/${playlist.id}`,
                  )
                }
                className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80"
              >
                {playlist.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={playlist.thumbnailUrl}
                    alt={playlist.title}
                    className="h-12 w-20 rounded-md border border-border object-cover"
                  />
                ) : (
                  <div className="flex h-12 w-20 items-center justify-center rounded-md border border-dashed border-border text-[10px] text-muted-foreground">
                    Нет превью
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">
                      {playlist.title}
                    </span>
                    {!playlist.isPublic && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        Черновик
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {playlist.slug}
                  </div>
                </div>
              </button>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => openEditPlaylist(playlist)}
                >
                  Редактировать
                </Button>
                <Button
                  variant="destructive"
                  type="button"
                  onClick={() => handleDeletePlaylist(playlist)}
                >
                  Удалить
                </Button>
              </div>
            </div>
          ))}
          {playlists.length === 0 && !playlistsLoading && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Курсов пока нет.
            </p>
          )}
        </div>
      </section>
      )}

      <Sheet
        open={createPlaylistOpen}
        onOpenChange={(open) => {
          setCreatePlaylistOpen(open)
          if (!open) {
            setPlaylistThumbnailError("")
          }
        }}
      >
        <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Новый курс</SheetTitle>
            <SheetDescription>
              Заполните основные поля — позже их можно будет отредактировать.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto">
            <div className="space-y-2">
              <Label htmlFor="playlist-title">Название</Label>
              <Input
                id="playlist-title"
                value={playlistTitle}
                onChange={(event) => setPlaylistTitle(event.target.value)}
                placeholder="Closed Guard"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="playlist-slug">Slug</Label>
              <Input
                id="playlist-slug"
                value={playlistSlug}
                onChange={(event) => setPlaylistSlug(event.target.value)}
                placeholder="closed-guard"
              />
              <p className="text-xs text-muted-foreground">
                Будет в URL курса. Изменить позже нельзя.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="playlist-level">Уровень</Label>
              <Input
                id="playlist-level"
                value={playlistLevel}
                onChange={(event) => setPlaylistLevel(event.target.value)}
                placeholder="beginner / intermediate / advanced"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="playlist-description">Описание</Label>
              <Textarea
                id="playlist-description"
                value={playlistDescription}
                onChange={(event) =>
                  setPlaylistDescription(event.target.value)
                }
                placeholder="О чём этот курс и для кого."
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="playlist-tags">Теги (через запятую)</Label>
              <Input
                id="playlist-tags"
                value={playlistTags}
                onChange={(event) => setPlaylistTags(event.target.value)}
                placeholder="guard, fundamentals"
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
                    handlePlaylistThumbnailChange(
                      event.target.files?.[0] ?? null,
                    )
                  }
                  className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm hover:file:bg-muted"
                />
                {playlistThumbnailPreview && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={playlistThumbnailPreview}
                    alt="Превью"
                    className="h-16 w-28 shrink-0 rounded-md border border-border object-cover"
                  />
                )}
              </div>
              {playlistThumbnailError && (
                <p className="text-xs text-destructive">
                  {playlistThumbnailError}
                </p>
              )}
            </div>
          </div>

          <SheetFooter>
            <div className="flex w-full items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreatePlaylistOpen(false)}
                disabled={playlistSaving}
              >
                Отмена
              </Button>
              <Button
                type="button"
                onClick={() => void handleCreatePlaylist()}
                disabled={
                  playlistSaving ||
                  !playlistTitle.trim() ||
                  !playlistSlug.trim()
                }
              >
                {playlistSaving ? "Создаём..." : "Создать курс"}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet
        open={Boolean(editPlaylist)}
        onOpenChange={(open) => {
          if (!open) {
            setEditPlaylist(null)
            setEditError("")
          }
        }}
      >
        <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Редактировать курс</SheetTitle>
            <SheetDescription>
              Slug менять нельзя — он используется в ссылках.
            </SheetDescription>
          </SheetHeader>

          {editPlaylist && (
            <div className="flex-1 space-y-4 overflow-y-auto">
              <div className="space-y-2">
                <Label htmlFor="edit-title">Название</Label>
                <Input
                  id="edit-title"
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-slug">Slug</Label>
                <Input
                  id="edit-slug"
                  value={editPlaylist.slug}
                  readOnly
                  disabled
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-description">Описание</Label>
                <Textarea
                  id="edit-description"
                  value={editDescription}
                  onChange={(event) => setEditDescription(event.target.value)}
                  rows={4}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-level">Уровень</Label>
                <Input
                  id="edit-level"
                  value={editLevel}
                  onChange={(event) => setEditLevel(event.target.value)}
                  placeholder="beginner / intermediate / advanced"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-tags">Теги (через запятую)</Label>
                <Input
                  id="edit-tags"
                  value={editTags}
                  onChange={(event) => setEditTags(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-thumbnail">Превью</Label>
                <div className="flex items-start gap-4">
                  <input
                    id="edit-thumbnail"
                    type="file"
                    accept={ALLOWED_THUMBNAIL_ACCEPT}
                    onChange={(event) =>
                      handleEditThumbnailChange(
                        event.target.files?.[0] ?? null,
                      )
                    }
                    className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-sm hover:file:bg-muted"
                  />
                  {editThumbnailPreview && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={editThumbnailPreview}
                      alt="Превью"
                      className="h-16 w-28 shrink-0 rounded-md border border-border object-cover"
                    />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Оставьте пустым, чтобы не менять текущее превью.
                </p>
              </div>

              {editError && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {editError}
                </p>
              )}
            </div>
          )}

          <SheetFooter>
            <div className="flex w-full items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setEditPlaylist(null)}
                disabled={editSaving}
              >
                Отмена
              </Button>
              <Button
                type="button"
                onClick={() => void handleSaveEditPlaylist()}
                disabled={editSaving || !editTitle.trim()}
              >
                {editSaving ? "Сохраняем..." : "Сохранить"}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
