"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"

import { Button, Input, Label, Textarea } from "@bjj-academy/ui-kit/ui"
import { Check, Copy, Plus, Search, X } from "lucide-react"
import { PlyrPlayer } from "../../../../../../features/video-player/plyr-player"
import {
  listPlaylists,
  type PlaylistResponse,
} from "../../../../../../shared/api/playlists"
import { listTags, type TagResponse } from "../../../../../../shared/api/tags"
import {
  getVideo,
  getVideoPlayback,
  updateVideo,
  type VideoCategory,
} from "../../../../../../shared/api/videos"

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

  const [description, setDescription] = useState("")
  const [descriptionSaving, setDescriptionSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [isPublicSaving, setIsPublicSaving] = useState(false)

  const [playlists, setPlaylists] = useState<PlaylistResponse[]>([])
  const [playlistsLoading, setPlaylistsLoading] = useState(false)
  const [playlistSearch, setPlaylistSearch] = useState("")
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<string[]>([])
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const [playlistSaving, setPlaylistSaving] = useState(false)
  const playlistRef = useRef<HTMLDivElement | null>(null)

  const [tags, setTags] = useState<TagResponse[]>([])
  const [tagsLoading, setTagsLoading] = useState(false)
  const [tagSearch, setTagSearch] = useState("")
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([])
  const [tagOpen, setTagOpen] = useState(false)
  const [tagSaving, setTagSaving] = useState(false)
  const tagRef = useRef<HTMLDivElement | null>(null)

  const canLoad = useMemo(
    () => Boolean(workspaceId && videoId),
    [workspaceId, videoId]
  )

  const filteredPlaylists = useMemo(() => {
    if (!playlistSearch.trim()) return playlists
    const query = playlistSearch.toLowerCase()
    return playlists.filter((playlist) =>
      playlist.title.toLowerCase().includes(query)
    )
  }, [playlists, playlistSearch])

  const filteredTags = useMemo(() => {
    if (!tagSearch.trim()) return tags
    const query = tagSearch.toLowerCase()
    return tags.filter((tag) => tag.name.toLowerCase().includes(query))
  }, [tags, tagSearch])

  const selectedTags = useMemo(
    () => tags.filter((tag) => selectedTagIds.includes(tag.id)),
    [tags, selectedTagIds]
  )

  const descriptionDirty =
    description.trim() !== (video?.description?.trim() ?? "")

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

  const loadVideo = async () => {
    if (!workspaceId || !videoId) return
    setPlaybackUrl(null)
    setPlaybackError(null)
    setLoadError(null)
    setPlaybackLoading(true)
    try {
      const details = await getVideo({ workspaceId, videoId })
      setVideo(details)
      try {
        const playback = await getVideoPlayback({ videoId })
        setPlaybackUrl(playback.hlsUrl)
      } catch (playbackErr) {
        setPlaybackError(
          playbackErr instanceof Error
            ? playbackErr.message
            : "Видео ещё не готово к просмотру."
        )
      }
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Не удалось загрузить видео."
      )
    } finally {
      setPlaybackLoading(false)
    }
  }

  useEffect(() => {
    void loadVideo()
  }, [workspaceId, videoId])

  useEffect(() => {
    void loadPlaylists()
    void loadTags()
  }, [workspaceId])

  useEffect(() => {
    if (!video) return
    setSelectedPlaylistIds(video.playlists.map((playlist) => playlist.id))
    setSelectedTagIds(video.tags.map((tag) => tag.id))
    setDescription(video.description ?? "")
  }, [video])

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as Node
      if (playlistOpen && playlistRef.current && !playlistRef.current.contains(target)) {
        setPlaylistOpen(false)
      }
      if (tagOpen && tagRef.current && !tagRef.current.contains(target)) {
        setTagOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [playlistOpen, tagOpen])

  const errorMessage = (error: unknown) =>
    error instanceof Error ? error.message : "Не удалось сохранить изменения."

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
      setVideo({ ...video, description: trimmed ? trimmed : null })
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

  const handleToggleIsPublic = async () => {
    if (!workspaceId || !video) return
    const next = !video.isPublic
    const previous = video.isPublic
    setIsPublicSaving(true)
    setActionError(null)
    setVideo({ ...video, isPublic: next })
    try {
      await updateVideo({
        workspaceId,
        videoId: video.id,
        data: { isPublic: next },
      })
    } catch (error) {
      setVideo({ ...video, isPublic: previous })
      setActionError(errorMessage(error))
    } finally {
      setIsPublicSaving(false)
    }
  }

  const togglePlaylist = async (playlistIdToToggle: string) => {
    if (!workspaceId || !video) return
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

      {loadError && (
        <p className="text-sm text-destructive">{loadError}</p>
      )}

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
              <div className="text-2xl font-semibold">{video.title}</div>
              <div className="text-xs text-muted-foreground">
                Статус: {video.status}
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

            <div className="space-y-2" ref={tagRef}>
              <div className="flex items-center gap-2 text-sm font-medium">
                <Label className="text-sm font-medium">Теги</Label>
                <button
                  type="button"
                  onClick={() => setTagOpen((prev) => !prev)}
                  aria-label="Добавить тег"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border hover:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                {tagSaving && (
                  <span className="text-xs text-muted-foreground">
                    Сохраняем...
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedTags.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    Теги не добавлены.
                  </span>
                )}
                {selectedTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs"
                  >
                    {tag.name}
                    <button
                      type="button"
                      onClick={() => void toggleTag(tag.id)}
                      aria-label={`Удалить тег ${tag.name}`}
                      className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-muted"
                      disabled={tagSaving}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              {tagOpen && (
                <div className="relative">
                  <div className="absolute z-10 mt-1 w-full max-w-md rounded-md border border-border bg-background p-3 shadow-lg">
                    <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <Input
                        value={tagSearch}
                        onChange={(event) => setTagSearch(event.target.value)}
                        placeholder="Поиск тегов"
                        className="h-7 border-none px-0 text-sm focus-visible:ring-0"
                      />
                    </div>
                    <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
                      {tagsLoading && (
                        <div className="text-xs text-muted-foreground">
                          Загружаем теги...
                        </div>
                      )}
                      {!tagsLoading && filteredTags.length === 0 && (
                        <div className="text-xs text-muted-foreground">
                          Теги не найдены.
                        </div>
                      )}
                      {filteredTags.map((tag) => {
                        const checked = selectedTagIds.includes(tag.id)
                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => void toggleTag(tag.id)}
                            className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                          >
                            <span className="flex h-5 w-5 items-center justify-center rounded border border-border">
                              {checked && <Check className="h-4 w-4" />}
                            </span>
                            <span className="flex-1 text-sm">{tag.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {tag.type}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

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

            <div className="space-y-2" ref={playlistRef}>
              <Label>Плейлисты</Label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPlaylistOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                >
                  <span className="truncate text-left">
                    {selectedPlaylistIds.length
                      ? playlists
                          .filter((playlist) =>
                            selectedPlaylistIds.includes(playlist.id)
                          )
                          .map((playlist) => playlist.title)
                          .join(", ")
                      : "Выберите плейлист"}
                  </span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {playlistSaving ? "Сохраняем..." : "Выбрать"}
                  </span>
                </button>

                {playlistOpen && (
                  <div className="absolute z-10 mt-2 w-full rounded-md border border-border bg-background p-3 shadow-lg">
                    <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <Input
                        value={playlistSearch}
                        onChange={(event) =>
                          setPlaylistSearch(event.target.value)
                        }
                        placeholder="Введите название плейлиста"
                        className="h-7 border-none px-0 text-sm focus-visible:ring-0"
                      />
                    </div>
                    <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">
                      {playlistsLoading && (
                        <div className="text-xs text-muted-foreground">
                          Загружаем плейлисты...
                        </div>
                      )}
                      {!playlistsLoading && filteredPlaylists.length === 0 && (
                        <div className="text-xs text-muted-foreground">
                          Плейлисты не найдены.
                        </div>
                      )}
                      {filteredPlaylists.map((playlist) => {
                        const checked = selectedPlaylistIds.includes(
                          playlist.id
                        )
                        return (
                          <button
                            key={playlist.id}
                            type="button"
                            onClick={() => void togglePlaylist(playlist.id)}
                            className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                          >
                            <span className="flex h-5 w-5 items-center justify-center rounded border border-border">
                              {checked && <Check className="h-4 w-4" />}
                            </span>
                            <span className="text-sm">{playlist.title}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
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
              {!playbackLoading && !playbackUrl && playbackError && (
                <p className="text-sm text-destructive">{playbackError}</p>
              )}
              {!playbackLoading && !playbackUrl && !playbackError && (
                <p className="text-sm text-muted-foreground">
                  Видео ещё не готово к просмотру.
                </p>
              )}
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
