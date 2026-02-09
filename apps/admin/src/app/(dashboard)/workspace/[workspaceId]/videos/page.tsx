"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bjj-academy/ui-kit/ui"
import { listPlaylists, type PlaylistResponse } from "../../../../../shared/api/playlists"
import {
  completeVideoUpload,
  deleteVideo,
  listVideos,
  updateVideo,
} from "../../../../../shared/api/videos"

type VideoSummary = {
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
  createdAt: string
  updatedAt: string
}

export default function WorkspaceVideosPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  const router = useRouter()

  const [videos, setVideos] = useState<VideoSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [accessSavingId, setAccessSavingId] = useState<string | null>(null)
  const [playlists, setPlaylists] = useState<PlaylistResponse[]>([])
  const [playlistsLoading, setPlaylistsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<"videos" | "playlists">("videos")
  const [videosPage, setVideosPage] = useState(1)
  const [playlistsPage, setPlaylistsPage] = useState(1)
  const [videosTotal, setVideosTotal] = useState(0)
  const [playlistsTotal, setPlaylistsTotal] = useState(0)
  const pageSize = 30

  const canLoad = useMemo(() => Boolean(workspaceId), [workspaceId])

  const loadVideos = async (page = videosPage) => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const response = await listVideos({
        workspaceId,
        curPage: page,
        perPage: pageSize,
      })
      setVideos(response.data)
      setVideosTotal(response.total)
    } finally {
      setLoading(false)
    }
  }

  const loadPlaylists = async (page = playlistsPage) => {
    if (!workspaceId) return
    setPlaylistsLoading(true)
    try {
      const response = await listPlaylists({
        workspaceId,
        curPage: page,
        perPage: pageSize,
      })
      setPlaylists(response.data)
      setPlaylistsTotal(response.total)
    } finally {
      setPlaylistsLoading(false)
    }
  }

  useEffect(() => {
    if (!workspaceId) return
    if (activeTab === "videos") {
      void loadVideos(videosPage)
      return
    }
    void loadPlaylists(playlistsPage)
  }, [workspaceId, activeTab, videosPage, playlistsPage])

  const handleSelect = (video: VideoSummary) => {
    if (!workspaceId) return
    router.push(`/workspace/${workspaceId}/videos/${video.id}`)
  }

  const handleRetry = async (video: VideoSummary) => {
    if (!workspaceId) return
    try {
      await completeVideoUpload({
        workspaceId,
        videoId: video.id,
      })
      await loadVideos()
    } catch (error) {
      console.error(error)
    }
  }

  const handleDelete = async (video: VideoSummary) => {
    if (!workspaceId) return
    const confirmed = window.confirm("Удалить видео из системы?")
    if (!confirmed) return
    try {
      await deleteVideo({
        workspaceId,
        videoId: video.id,
      })
      setVideos((prev) => prev.filter((item) => item.id !== video.id))
    } catch (error) {
      console.error(error)
    }
  }

  const handleAccessChange = async (video: VideoSummary, isPublic: boolean) => {
    if (!workspaceId) return
    setAccessSavingId(video.id)
    try {
      await updateVideo({
        workspaceId,
        videoId: video.id,
        data: { isPublic },
      })
      setVideos((prev) =>
        prev.map((item) =>
          item.id === video.id ? { ...item, isPublic } : item
        )
      )
    } finally {
      setAccessSavingId(null)
    }
  }

  const videosTotalPages = Math.max(1, Math.ceil(videosTotal / pageSize))
  const playlistsTotalPages = Math.max(1, Math.ceil(playlistsTotal / pageSize))

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Видео</h1>
        <p className="text-sm text-muted-foreground">
          Все видео воркспейса в одном списке.
        </p>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          {[
            { id: "videos", label: "Видео" },
            { id: "playlists", label: "Плейлисты" },
          ].map((tab) => (
            <Button
              key={tab.id}
              type="button"
              variant={activeTab === tab.id ? "default" : "secondary"}
              onClick={() => {
                setActiveTab(tab.id as "videos" | "playlists")
              }}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {activeTab === "videos" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Видео</h2>
              {loading && (
                <span className="text-xs text-muted-foreground">
                  Обновление...
                </span>
              )}
              <Button
                variant="secondary"
                onClick={() => loadVideos(videosPage)}
                disabled={!canLoad}
              >
                Обновить
              </Button>
            </div>

            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Видео</th>
                    <th className="px-4 py-3">Статус</th>
                    <th className="px-4 py-3">Доступ</th>
                    <th className="px-4 py-3">Дата</th>
                    <th className="px-4 py-3 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {videos.map((video) => (
                    <tr key={video.id} className="border-t">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => handleSelect(video)}
                          className="flex items-center gap-3 text-left"
                        >
                          <div className="h-14 w-24 overflow-hidden rounded-md bg-muted">
                            {video.thumbnailUrl ? (
                              <img
                                src={video.thumbnailUrl}
                                alt={video.title}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                                Нет превью
                              </div>
                            )}
                          </div>
                          <div className="space-y-1">
                            <div className="font-medium">{video.title}</div>
                            {video.errorMessage && (
                              <div className="text-xs text-destructive">
                                {video.errorMessage}
                              </div>
                            )}
                          </div>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm">{video.status}</td>
                      <td className="px-4 py-3 text-sm">
                        <Select
                          value={video.isPublic ? "public" : "private"}
                          onValueChange={(value) => {
                            void handleAccessChange(video, value === "public")
                          }}
                          disabled={accessSavingId === video.id}
                        >
                          <SelectTrigger className="h-8 w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="public">Доступно</SelectItem>
                            <SelectItem value="private">Закрыто</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {new Date(video.createdAt).toLocaleDateString("ru-RU")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {video.status === "failed" && (
                            <Button
                              variant="secondary"
                              type="button"
                              onClick={() => void handleRetry(video)}
                            >
                              Повторить
                            </Button>
                          )}
                          <Button
                            variant="destructive"
                            type="button"
                            onClick={() => void handleDelete(video)}
                          >
                            Удалить
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!loading && videos.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Видео пока не загружены.
              </p>
            )}

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Страница {videosPage} из {videosTotalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={videosPage <= 1}
                  onClick={() => setVideosPage((prev) => Math.max(1, prev - 1))}
                >
                  Назад
                </Button>
                <Button
                  variant="secondary"
                  disabled={videosPage >= videosTotalPages}
                  onClick={() =>
                    setVideosPage((prev) => Math.min(videosTotalPages, prev + 1))
                  }
                >
                  Вперед
                </Button>
              </div>
            </div>
          </div>
        )}

        {activeTab === "playlists" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Плейлисты</h2>
              {playlistsLoading && (
                <span className="text-xs text-muted-foreground">
                  Обновление...
                </span>
              )}
              <Button
                variant="secondary"
                onClick={() => loadPlaylists(playlistsPage)}
                disabled={!canLoad}
              >
                Обновить
              </Button>
            </div>

            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Плейлист</th>
                    <th className="px-4 py-3">Доступ</th>
                    <th className="px-4 py-3">Последнее обновление</th>
                    <th className="px-4 py-3 text-right">Теги</th>
                  </tr>
                </thead>
                <tbody>
                  {playlists.map((playlist) => (
                    <tr key={playlist.id} className="border-t">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-12 w-20 overflow-hidden rounded-md bg-muted">
                            {playlist.thumbnailUrl ? (
                              <img
                                src={playlist.thumbnailUrl}
                                alt={playlist.title}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                                Нет превью
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="font-medium">{playlist.title}</div>
                            <div className="text-xs text-muted-foreground">
                              {playlist.slug}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {playlist.accessLevel ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {new Date(playlist.updatedAt).toLocaleDateString(
                          "ru-RU"
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {playlist.tags?.length
                          ? playlist.tags.join(", ")
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!playlistsLoading && playlists.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Плейлистов пока нет.
              </p>
            )}

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Страница {playlistsPage} из {playlistsTotalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  disabled={playlistsPage <= 1}
                  onClick={() =>
                    setPlaylistsPage((prev) => Math.max(1, prev - 1))
                  }
                >
                  Назад
                </Button>
                <Button
                  variant="secondary"
                  disabled={playlistsPage >= playlistsTotalPages}
                  onClick={() =>
                    setPlaylistsPage((prev) =>
                      Math.min(playlistsTotalPages, prev + 1)
                    )
                  }
                >
                  Вперед
                </Button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
