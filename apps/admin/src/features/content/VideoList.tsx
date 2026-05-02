"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bjj-academy/ui-kit/ui"
import {
  completeVideoUpload,
  deleteVideo,
  listVideos,
  updateVideo,
} from "../../shared/api/videos"

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

type Props = { workspaceId: string }

const PAGE_SIZE = 30

export function VideoList({ workspaceId }: Props) {
  const router = useRouter()
  const [videos, setVideos] = useState<VideoSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [accessSavingId, setAccessSavingId] = useState<string | null>(null)

  const load = async (nextPage = page) => {
    setLoading(true)
    try {
      const response = await listVideos({
        workspaceId,
        curPage: nextPage,
        perPage: PAGE_SIZE,
      })
      setVideos(response.data)
      setTotal(response.total)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, page])

  // Live-refresh while there are videos still being transcoded.
  useEffect(() => {
    const inFlight = videos.some(
      (video) => video.status !== "ready" && video.status !== "failed",
    )
    if (!inFlight) return
    const interval = setInterval(() => {
      void load(page)
    }, 5_000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videos, page])

  const handleRetry = async (video: VideoSummary) => {
    try {
      await completeVideoUpload({ workspaceId, videoId: video.id })
      await load()
    } catch (error) {
      console.error(error)
    }
  }

  const handleDelete = async (video: VideoSummary) => {
    if (!window.confirm("Удалить видео из системы?")) return
    try {
      await deleteVideo({ workspaceId, videoId: video.id })
      setVideos((prev) => prev.filter((item) => item.id !== video.id))
    } catch (error) {
      console.error(error)
    }
  }

  const handleAccessChange = async (
    video: VideoSummary,
    isPublic: boolean,
  ) => {
    setAccessSavingId(video.id)
    try {
      await updateVideo({
        workspaceId,
        videoId: video.id,
        data: { isPublic },
      })
      setVideos((prev) =>
        prev.map((item) =>
          item.id === video.id ? { ...item, isPublic } : item,
        ),
      )
    } finally {
      setAccessSavingId(null)
    }
  }

  const handleSelect = (video: VideoSummary) => {
    router.push(`/workspace/${workspaceId}/videos/${video.id}`)
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        {loading && (
          <span className="text-xs text-muted-foreground">Обновление...</span>
        )}
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
                        // eslint-disable-next-line @next/next/no-img-element
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
        <p className="text-sm text-muted-foreground">Видео пока не загружены.</p>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Страница {page} из {totalPages}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Назад
            </Button>
            <Button
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            >
              Вперёд
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
