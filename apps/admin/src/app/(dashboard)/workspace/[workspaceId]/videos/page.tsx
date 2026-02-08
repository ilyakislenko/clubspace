"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@bjj-academy/ui-kit/ui"
import {
  completeVideoUpload,
  deleteVideo,
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
  const router = useRouter()

  const [videos, setVideos] = useState<VideoSummary[]>([])
  const [loading, setLoading] = useState(false)

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

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Видео</h1>
        <p className="text-sm text-muted-foreground">
          Все видео воркспейса в одном списке.
        </p>
      </div>

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
            <div
              key={video.id}
              className="flex flex-col gap-3 rounded-lg border border-border p-3 text-left transition hover:border-primary"
            >
              <button
                type="button"
                onClick={() => handleSelect(video)}
                className="flex flex-col gap-3 text-left"
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
              </button>
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
              <div className="pt-2">
                <Button
                  variant="destructive"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    void handleDelete(video)
                  }}
                >
                  Удалить
                </Button>
              </div>
            </div>
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
