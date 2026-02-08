"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@bjj-academy/ui-kit/ui"
import { PlyrPlayer } from "../../../../../../features/video-player/plyr-player"
import {
  getVideo,
  getVideoPlayback,
  listVideos,
} from "../../../../../../shared/api/videos"

type VideoSummary = {
  id: string
  workspaceId: string
  title: string
  description?: string | null
  status: string
  url: string
  duration?: number | null
  thumbnailUrl?: string | null
  errorMessage?: string | null
  createdAt: string
  updatedAt: string
}

type VideoDetails = {
  id: string
  workspaceId: string
  title: string
  description?: string | null
  status: string
  url: string
  duration?: number | null
  thumbnailUrl?: string | null
}

export default function WorkspaceVideoWatchPage() {
  const params = useParams<{ workspaceId: string; videoId: string }>()
  const workspaceId = params?.workspaceId
  const videoId = params?.videoId
  const router = useRouter()
  const searchParams = useSearchParams()
  const playlistId = searchParams.get("playlistId")

  const [video, setVideo] = useState<VideoDetails | null>(null)
  const [videos, setVideos] = useState<VideoSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [playbackLoading, setPlaybackLoading] = useState(false)
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [playbackError, setPlaybackError] = useState<string | null>(null)

  const canLoad = useMemo(
    () => Boolean(workspaceId && videoId),
    [workspaceId, videoId]
  )

  const loadSidebar = async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const response = await listVideos({ workspaceId })
      setVideos(response.data)
    } finally {
      setLoading(false)
    }
  }

  const loadVideo = async () => {
    if (!workspaceId || !videoId) return
    setPlaybackUrl(null)
    setPlaybackError(null)
    setPlaybackLoading(true)
    try {
      const details = await getVideo({ workspaceId, videoId })
      setVideo(details)
      const playback = await getVideoPlayback({ videoId })
      setPlaybackUrl(playback.hlsUrl)
    } catch (error) {
      setPlaybackError(
        error instanceof Error ? error.message : "Не удалось загрузить видео."
      )
    } finally {
      setPlaybackLoading(false)
    }
  }

  useEffect(() => {
    void loadSidebar()
  }, [workspaceId])

  useEffect(() => {
    void loadVideo()
  }, [workspaceId, videoId])

  const handleSelect = (nextVideo: VideoSummary) => {
    if (!workspaceId) return
    const query = playlistId ? `?playlistId=${playlistId}` : ""
    router.push(`/workspace/${workspaceId}/videos/${nextVideo.id}${query}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Просмотр видео</h1>
          <p className="text-sm text-muted-foreground">
            {playlistId
              ? "Режим плейлиста будет подключен позже."
              : "Выберите видео из списка справа."}
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

      {canLoad && (
        <div className="flex gap-6">
          <div className="flex-1">
            <div className="mx-auto w-full max-w-4xl space-y-4">
              {video && (
                <div className="space-y-1">
                  <div className="text-xl font-semibold">{video.title}</div>
                  <div className="text-xs text-muted-foreground">
                    Статус: {video.status}
                  </div>
                </div>
              )}

              <div className="rounded-lg">
                {playbackLoading && (
                  <p className="text-sm text-muted-foreground">
                    Загружаем плеер...
                  </p>
                )}
                {!playbackLoading && playbackUrl && (
                  <PlyrPlayer
                    src={playbackUrl}
                    poster={video?.thumbnailUrl}
                    title={video?.title}
                  />
                )}
                {!playbackLoading && !playbackUrl && playbackError && (
                  <p className="text-sm text-destructive">{playbackError}</p>
                )}
                {!playbackLoading && !playbackUrl && (
                  <p className="text-sm text-muted-foreground">
                    Видео ещё не готово к просмотру.
                  </p>
                )}
              </div>

              {video?.description && (
                <div className="rounded-lg border p-4 text-sm text-muted-foreground">
                  {video.description}
                </div>
              )}
            </div>
          </div>

          <aside className="w-80 shrink-0 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Еще видео</h2>
              {loading && (
                <span className="text-xs text-muted-foreground">
                  Обновление...
                </span>
              )}
            </div>
            <div className="space-y-2">
              {videos.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item)}
                  className={`flex w-full gap-3 rounded-lg border p-2 text-left transition hover:border-primary ${
                    item.id === videoId ? "border-primary" : "border-border"
                  }`}
                >
                  <div className="h-16 w-28 overflow-hidden rounded-md bg-muted">
                    {item.thumbnailUrl ? (
                      <img
                        src={item.thumbnailUrl}
                        alt={item.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                        Нет превью
                      </div>
                    )}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="line-clamp-2 text-sm font-medium">
                      {item.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Статус: {item.status}
                    </div>
                  </div>
                </button>
              ))}
              {!loading && videos.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Видео пока не загружены.
                </p>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}