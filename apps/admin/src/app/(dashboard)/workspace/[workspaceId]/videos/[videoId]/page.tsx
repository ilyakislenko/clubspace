"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

import { Button, Input, Label, Textarea } from "@clubspace/ui-kit/ui"
import { Check, Copy } from "lucide-react"
import { PlyrPlayer } from "../../../../../../features/video-player/plyr-player"
import { PlaylistSelectField } from "../../../../../../features/content/video-detail/PlaylistSelectField"
import { SubtitlesSection } from "../../../../../../features/content/video-detail/SubtitlesSection"
import { TagSelectField } from "../../../../../../features/content/video-detail/TagSelectField"
import { TimestampsSection } from "../../../../../../features/content/video-detail/TimestampsSection"
import {
  listPlaylists,
  type PlaylistResponse,
} from "../../../../../../shared/api/playlists"
import { listTags, type TagResponse } from "../../../../../../shared/api/tags"
import { errorMessage } from "../../../../../../shared/lib/error-message"
import {
  isVideoProcessing,
  videoStatusLabel,
} from "../../../../../../shared/lib/video-status"
import {
  createVideoThumbnailUpload,
  getVideo,
  getVideoPlayback,
  updateVideo,
  type VideoCategory,
  type VideoSubtitleTrack,
} from "../../../../../../shared/api/videos"
import {
  ALLOWED_THUMBNAIL_ACCEPT,
  isAllowedThumbnailType,
  THUMBNAIL_REJECT_MESSAGE,
} from "../../../../../../shared/upload-types"

type VideoDetails = {
  id: string
  workspaceId: string
  title: string
  description?: string | null
  status: string
  isPublic: boolean
  url: string
  duration?: number | null
  thumbnailUrl?: string | null
  errorMessage?: string | null
  tags: Array<{ id: string; name: string }>
  categories: VideoCategory[]
  playlists: Array<{ id: string; title: string }>
  timestamps: Array<{ id: string; positionSec: number; title: string }>
  subtitles: VideoSubtitleTrack[]
}

export default function WorkspaceVideoWatchPage() {
  const params = useParams<{ workspaceId: string; videoId: string }>()
  const workspaceId = params?.workspaceId
  const videoId = params?.videoId
  const router = useRouter()

  const [video, setVideo] = useState<VideoDetails | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [playbackLoading, setPlaybackLoading] = useState(false)
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [playbackError, setPlaybackError] = useState<string | null>(null)

  const [title, setTitle] = useState("")
  const [titleSaving, setTitleSaving] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)

  const [description, setDescription] = useState("")
  const [descriptionSaving, setDescriptionSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [isPublicSaving, setIsPublicSaving] = useState(false)

  const [thumbnailSaving, setThumbnailSaving] = useState(false)
  const thumbnailInputRef = useRef<HTMLInputElement | null>(null)

  const [playlists, setPlaylists] = useState<PlaylistResponse[]>([])
  const [playlistsLoading, setPlaylistsLoading] = useState(false)
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<string[]>([])
  const [playlistSaving, setPlaylistSaving] = useState(false)

  const [tags, setTags] = useState<TagResponse[]>([])
  const [tagsLoading, setTagsLoading] = useState(false)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [tagSaving, setTagSaving] = useState(false)

  const canLoad = useMemo(
    () => Boolean(workspaceId && videoId),
    [workspaceId, videoId]
  )

  const descriptionDirty =
    description.trim() !== (video?.description?.trim() ?? "")

  const titleDirty = title.trim() !== (video?.title.trim() ?? "")

  const loadPlaylists = async () => {
    if (!workspaceId) return
    setPlaylistsLoading(true)
    try {
      const response = await listPlaylists({ workspaceId, perPage: 200 })
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

  // Monotonic id of the latest issued load. Navigating between videos keeps
  // this component mounted (only the route param changes), so a slow load for
  // the previous video could otherwise resolve after the new one and overwrite
  // its details/playback. Ignore any response that isn't from the latest load.
  const loadVideoRequestRef = useRef(0)

  const loadVideo = async () => {
    if (!workspaceId || !videoId) return
    const requestId = ++loadVideoRequestRef.current
    setPlaybackUrl(null)
    setPlaybackError(null)
    setLoadError(null)
    setPlaybackLoading(true)
    try {
      const details = await getVideo({ workspaceId, videoId })
      if (requestId !== loadVideoRequestRef.current) return
      setVideo(details)
      try {
        const playback = await getVideoPlayback({ videoId })
        if (requestId !== loadVideoRequestRef.current) return
        setPlaybackUrl(playback.hlsUrl)
      } catch {
        if (requestId !== loadVideoRequestRef.current) return
        // A not-ready video legitimately has no HLS yet (the playback endpoint
        // 400s), so surface the processing/failed state instead of leaking the
        // raw "Request failed with status code 400" into the UI.
        setPlaybackError(
          isVideoProcessing(details.status)
            ? "Видео обрабатывается — плеер появится, когда обработка завершится."
            : details.status === "failed"
              ? "Видео не удалось обработать."
              : "Не удалось загрузить плеер. Попробуйте обновить страницу."
        )
      }
    } catch (error) {
      if (requestId !== loadVideoRequestRef.current) return
      setLoadError(
        errorMessage(error, "Не удалось загрузить видео.")
      )
    } finally {
      if (requestId === loadVideoRequestRef.current) setPlaybackLoading(false)
    }
  }

  useEffect(() => {
    void loadVideo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, videoId])

  useEffect(() => {
    void loadPlaylists()
    void loadTags()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  useEffect(() => {
    if (!video) return
    setSelectedPlaylistIds(video.playlists.map((playlist) => playlist.id))
    setSelectedTagIds(video.tags.map((tag) => tag.id))
    setDescription(video.description ?? "")
    setTitle(video.title)
  }, [video])

  const handleCopyLink = async () => {
    if (!playbackUrl) return
    try {
      await navigator.clipboard.writeText(playbackUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      setActionError(errorMessage(error))
    }
  }

  const handleSaveDescription = async () => {
    if (!workspaceId || !video) return
    const trimmed = description.trim()
    setDescriptionSaving(true)
    setActionError(null)
    try {
      await updateVideo({
        workspaceId,
        videoId: video.id,
        data: { description: trimmed ? trimmed : null },
      })
      setVideo((prev) =>
        prev ? { ...prev, description: trimmed ? trimmed : null } : prev,
      )
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setDescriptionSaving(false)
    }
  }

  const handleResetDescription = () => {
    setDescription(video?.description ?? "")
    setActionError(null)
  }

  const handleSaveTitle = async () => {
    if (!workspaceId || !video) return
    const trimmed = title.trim()
    if (trimmed.length === 0) {
      setActionError("Название не может быть пустым.")
      return
    }
    if (trimmed === video.title) {
      setEditingTitle(false)
      return
    }
    setTitleSaving(true)
    setActionError(null)
    try {
      const updated = await updateVideo({
        workspaceId,
        videoId: video.id,
        data: { title: trimmed },
      })
      setVideo((prev) => (prev ? { ...prev, title: updated.title ?? trimmed } : prev))
      setTitle(updated.title ?? trimmed)
      setEditingTitle(false)
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setTitleSaving(false)
    }
  }

  const handleCancelTitle = () => {
    setTitle(video?.title ?? "")
    setEditingTitle(false)
    setActionError(null)
  }

  const handleToggleIsPublic = async () => {
    if (!workspaceId || !video) return
    const next = !video.isPublic
    const previous = video.isPublic
    setIsPublicSaving(true)
    setActionError(null)
    setVideo((prev) => (prev ? { ...prev, isPublic: next } : prev))
    try {
      await updateVideo({
        workspaceId,
        videoId: video.id,
        data: { isPublic: next },
      })
    } catch (error) {
      setVideo((prev) => (prev ? { ...prev, isPublic: previous } : prev))
      setActionError(errorMessage(error))
    } finally {
      setIsPublicSaving(false)
    }
  }

  const handleThumbnailFile = async (file: File) => {
    if (!workspaceId || !video) return
    if (!isAllowedThumbnailType(file.type)) {
      setActionError(THUMBNAIL_REJECT_MESSAGE)
      return
    }
    setThumbnailSaving(true)
    setActionError(null)
    try {
      const upload = await createVideoThumbnailUpload({
        workspaceId,
        videoId: video.id,
        contentType: file.type,
      })
      const putResult = await fetch(upload.upload.url, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      })
      if (!putResult.ok) {
        throw new Error(`Не удалось загрузить файл (HTTP ${putResult.status})`)
      }
      const updated = await updateVideo({
        workspaceId,
        videoId: video.id,
        data: { thumbnailUrl: upload.publicUrl },
      })
      setVideo((prev) =>
        prev ? { ...prev, thumbnailUrl: updated.thumbnailUrl ?? null } : prev,
      )
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setThumbnailSaving(false)
      if (thumbnailInputRef.current) {
        thumbnailInputRef.current.value = ""
      }
    }
  }

  const handleThumbnailRemove = async () => {
    if (!workspaceId || !video || !video.thumbnailUrl) return
    if (!window.confirm("Удалить превью?")) return
    setThumbnailSaving(true)
    setActionError(null)
    try {
      await updateVideo({
        workspaceId,
        videoId: video.id,
        data: { thumbnailUrl: null },
      })
      setVideo((prev) => (prev ? { ...prev, thumbnailUrl: null } : prev))
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setThumbnailSaving(false)
    }
  }

  const togglePlaylist = async (playlistIdToToggle: string) => {
    if (!workspaceId || !video) return
    // Ignore taps while a save is in flight — overlapping PATCHes capture
    // stale rollback snapshots and can desync the UI from the server.
    if (playlistSaving) return
    const previous = selectedPlaylistIds
    const nextIds = previous.includes(playlistIdToToggle)
      ? previous.filter((id) => id !== playlistIdToToggle)
      : [...previous, playlistIdToToggle]

    setSelectedPlaylistIds(nextIds)
    setPlaylistSaving(true)
    setActionError(null)
    try {
      await updateVideo({
        workspaceId,
        videoId: video.id,
        data: { playlistIds: nextIds },
      })
    } catch (error) {
      setSelectedPlaylistIds(previous)
      setActionError(errorMessage(error))
    } finally {
      setPlaylistSaving(false)
    }
  }

  const toggleTag = async (tagIdToToggle: string) => {
    if (!workspaceId || !video) return
    // Ignore taps while a save is in flight (see togglePlaylist).
    if (tagSaving) return
    const previous = selectedTagIds
    const nextIds = previous.includes(tagIdToToggle)
      ? previous.filter((id) => id !== tagIdToToggle)
      : [...previous, tagIdToToggle]

    setSelectedTagIds(nextIds)
    setTagSaving(true)
    setActionError(null)
    try {
      await updateVideo({
        workspaceId,
        videoId: video.id,
        data: { tagIds: nextIds },
      })
    } catch (error) {
      setSelectedTagIds(previous)
      setActionError(errorMessage(error))
    } finally {
      setTagSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Сведения о видео</h1>
          <p className="text-sm text-muted-foreground">
            Управляйте метаданными и доступом видео.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => router.push(`/workspace/${workspaceId}/videos`)}
        >
          Назад к библиотеке
        </Button>
      </div>

      {!canLoad && (
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      )}

      {loadError && <p className="text-sm text-destructive">{loadError}</p>}

      {actionError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-xs underline"
          >
            Закрыть
          </button>
        </div>
      )}

      {canLoad && video && (
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex-1 space-y-5">
            <div className="space-y-1">
              {editingTitle ? (
                <div className="flex items-center gap-2">
                  <Input
                    autoFocus
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void handleSaveTitle()
                      if (event.key === "Escape") handleCancelTitle()
                    }}
                    placeholder="Название урока"
                    className="text-2xl font-semibold"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleSaveTitle()}
                    disabled={titleSaving || !titleDirty || title.trim().length === 0}
                  >
                    {titleSaving ? "Сохраняем..." : "Сохранить"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleCancelTitle}
                    disabled={titleSaving}
                  >
                    Отмена
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  className="-mx-1 rounded px-1 text-left text-2xl font-semibold transition-colors hover:bg-muted"
                  title="Нажмите, чтобы переименовать"
                >
                  {video.title}
                </button>
              )}
              <div className="text-xs text-muted-foreground">
                Статус: {videoStatusLabel(video.status)}
              </div>
              {video.status === "failed" && video.errorMessage && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  Ошибка обработки: {video.errorMessage}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="video-description">Описание</Label>
                {descriptionDirty && (
                  <span className="text-xs text-muted-foreground">
                    Не сохранено
                  </span>
                )}
              </div>
              <Textarea
                id="video-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Добавьте описание для зрителей."
                className="min-h-[120px]"
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleSaveDescription()}
                  disabled={!descriptionDirty || descriptionSaving}
                >
                  {descriptionSaving ? "Сохраняем..." : "Сохранить описание"}
                </Button>
                {descriptionDirty && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleResetDescription}
                    disabled={descriptionSaving}
                  >
                    Отменить
                  </Button>
                )}
              </div>
            </div>

            <TimestampsSection
              workspaceId={video.workspaceId}
              videoId={video.id}
              duration={video.duration}
              timestamps={video.timestamps}
              onAdded={(created) =>
                setVideo((prev) =>
                  prev
                    ? {
                        ...prev,
                        timestamps: [...prev.timestamps, created].sort(
                          (a, b) => a.positionSec - b.positionSec,
                        ),
                      }
                    : prev,
                )
              }
              onRemoved={(id) =>
                setVideo((prev) =>
                  prev
                    ? {
                        ...prev,
                        timestamps: prev.timestamps.filter((t) => t.id !== id),
                      }
                    : prev,
                )
              }
              onError={setActionError}
            />

            <SubtitlesSection
              workspaceId={video.workspaceId}
              videoId={video.id}
              subtitles={video.subtitles}
              onUploaded={(created) =>
                setVideo((prev) =>
                  prev
                    ? {
                        ...prev,
                        subtitles: [
                          ...prev.subtitles.filter(
                            (s) => s.language !== created.language,
                          ),
                          created,
                        ],
                      }
                    : prev,
                )
              }
              onRemoved={(id) =>
                setVideo((prev) =>
                  prev
                    ? {
                        ...prev,
                        subtitles: prev.subtitles.filter((s) => s.id !== id),
                      }
                    : prev,
                )
              }
              onError={setActionError}
            />

            <TagSelectField
              tags={tags}
              tagsLoading={tagsLoading}
              selectedTagIds={selectedTagIds}
              saving={tagSaving}
              onToggle={(id) => void toggleTag(id)}
            />

            {video.categories.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">Категории</Label>
                <div className="flex flex-wrap gap-2">
                  {video.categories.map((category) => (
                    <span
                      key={category.id}
                      className="rounded-full border border-border px-3 py-1 text-xs"
                    >
                      {category.name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <PlaylistSelectField
              playlists={playlists}
              playlistsLoading={playlistsLoading}
              selectedPlaylistIds={selectedPlaylistIds}
              saving={playlistSaving}
              onToggle={(id) => void togglePlaylist(id)}
            />
          </div>

          <aside className="w-full max-w-sm space-y-4">
            <div className="rounded-lg border border-border p-3">
              {playbackLoading && (
                <p className="text-sm text-muted-foreground">
                  Загружаем плеер...
                </p>
              )}
              {!playbackLoading && playbackUrl && (
                <PlyrPlayer
                  src={playbackUrl}
                  poster={video.thumbnailUrl}
                  title={video.title}
                />
              )}
              {!playbackLoading && !playbackUrl && (
                <p
                  className={
                    video.status === "failed"
                      ? "text-sm text-destructive"
                      : "text-sm text-muted-foreground"
                  }
                >
                  {playbackError ?? "Видео ещё не готово к просмотру."}
                </p>
              )}
            </div>

            <div className="space-y-3 rounded-lg border border-border p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">Превью</div>
                {thumbnailSaving && (
                  <span className="text-xs text-muted-foreground">
                    Сохраняем...
                  </span>
                )}
              </div>
              <div className="aspect-video w-full overflow-hidden rounded-md border border-border bg-muted">
                {video.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={video.thumbnailUrl}
                    alt={video.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    Превью не задано
                  </div>
                )}
              </div>
              <input
                ref={thumbnailInputRef}
                type="file"
                accept={ALLOWED_THUMBNAIL_ACCEPT}
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleThumbnailFile(file)
                }}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => thumbnailInputRef.current?.click()}
                  disabled={thumbnailSaving}
                >
                  {video.thumbnailUrl ? "Заменить" : "Загрузить"}
                </Button>
                {video.thumbnailUrl && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleThumbnailRemove()}
                    disabled={thumbnailSaving}
                  >
                    Удалить
                  </Button>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-border p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">Публичный доступ</div>
                  <div className="text-xs text-muted-foreground">
                    {video.isPublic
                      ? "Видео доступно по прямой ссылке."
                      : "Видео видят только участники workspace."}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={video.isPublic}
                  onClick={() => void handleToggleIsPublic()}
                  disabled={isPublicSaving}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
                    video.isPublic ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition ${
                      video.isPublic ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-border p-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  Ссылка на видео:
                </div>
                <button
                  type="button"
                  onClick={() => void handleCopyLink()}
                  className="inline-flex items-center gap-2 text-xs text-primary disabled:opacity-50"
                  disabled={!playbackUrl}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copied ? "Скопировано" : "Копировать"}
                </button>
              </div>
              <div className="mt-2 break-all text-xs text-muted-foreground">
                {playbackUrl ?? "Ссылка появится после обработки"}
              </div>
            </div>

            <div className="rounded-lg border border-border p-4 text-sm">
              <div className="text-xs text-muted-foreground">Качество</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className="rounded-full border border-border px-3 py-1 text-xs">
                  Авто
                </span>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
