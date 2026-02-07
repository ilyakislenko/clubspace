"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"

import { Button } from "@bjj-academy/ui-kit/ui"
import {
  completeVideoUpload,
  getVideoPlayback,
  listVideos,
} from "../../../../../shared/api/videos"

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

export default function WorkspaceVideosPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [videos, setVideos] = useState<VideoSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedVideo, setSelectedVideo] = useState<VideoSummary | null>(null)
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [playbackLoading, setPlaybackLoading] = useState(false)

  const canLoad = useMemo(() => Boolean(workspaceId), [workspaceId])

  const loadVideos = async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const response = await listVideos({ workspaceId })
      setVideos(response.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadVideos()
  }, [workspaceId])

  const handleSelect = async (video: VideoSummary) => {
    setSelectedVideo(video)
    setPlaybackUrl(null)
    setPlaybackLoading(true)
    try {
      const playback = await getVideoPlayback({ videoId: video.id })
      setPlaybackUrl(playback.hlsUrl)
    } finally {
      setPlaybackLoading(false)
    }
  }

  const handleRetry = async (video: VideoSummary) => {
    if (!workspaceId) return
    setPlaybackLoading(true)
    try {
      await completeVideoUpload({
        workspaceId,
        videoId: video.id,
      })
      await loadVideos()
    } finally {
      setPlaybackLoading(false)
    }
  }

  const handleClosePlayer = () => {
    setSelectedVideo(null)
    setPlaybackUrl(null)
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Видео</h1>
        <p className="text-sm text-muted-foreground">
          Все видео воркспейса в одном списке.
        </p>
      </div>

      {selectedVideo && (
        <section className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">{selectedVideo.title}</div>
              <div className="text-xs text-muted-foreground">
                Статус: {selectedVideo.status}
              </div>
              {selectedVideo.errorMessage && (
                <div className="mt-1 text-xs text-destructive">
                  {selectedVideo.errorMessage}
                </div>
              )}
            </div>
            <Button variant="secondary" onClick={handleClosePlayer}>
              Закрыть
            </Button>
          </div>
          {playbackLoading && (
            <p className="text-sm text-muted-foreground">
              Загружаем плеер...
            </p>
          )}
          {!playbackLoading && playbackUrl && (
            <video
              className="w-full max-w-4xl rounded-md bg-black"
              controls
              src={playbackUrl}
            />
          )}
          {!playbackLoading && !playbackUrl && (
            <p className="text-sm text-muted-foreground">
              Плейлист ещё не готов.
            </p>
          )}
        </section>
      )}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Библиотека</h2>
          {loading && (
            <span className="text-xs text-muted-foreground">Обновление...</span>
          )}
          <Button variant="secondary" onClick={loadVideos} disabled={!canLoad}>
            Обновить
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((video) => (
            <button
              key={video.id}
              type="button"
              onClick={() => void handleSelect(video)}
              className="flex flex-col gap-3 rounded-lg border p-3 text-left transition hover:border-primary"
            >
              <div className="aspect-video w-full overflow-hidden rounded-md bg-muted">
                {video.thumbnailUrl ? (
                  <img
                    src={video.thumbnailUrl}
                    alt={video.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    Нет превью
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <div className="font-medium">{video.title}</div>
                <div className="text-xs text-muted-foreground">
                  Статус: {video.status}
                </div>
                {video.errorMessage && (
                  <div className="text-xs text-destructive">
                    {video.errorMessage}
                  </div>
                )}
              </div>
              {video.status === "failed" && (
                <div className="pt-2">
                  <Button
                    variant="secondary"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      void handleRetry(video)
                    }}
                  >
                    Повторить
                  </Button>
                </div>
              )}
            </button>
          ))}
        </div>

        {!loading && videos.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Видео пока не загружены.
          </p>
        )}
      </section>
    </div>
  )
}
