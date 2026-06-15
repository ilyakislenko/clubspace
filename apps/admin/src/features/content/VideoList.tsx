"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@bjj-academy/ui-kit/ui"
import { listCategories, type CategoryResponse } from "../../shared/api/categories"
import { listTags, type TagResponse } from "../../shared/api/tags"
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

const STATUS_LABEL: Record<string, string> = {
  ready: "Готово",
  uploaded: "Загружено",
  uploading: "Загружается",
  processing: "Обработка",
  failed: "Ошибка",
}

const STATUS_CLASS: Record<string, string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  uploaded: "bg-sky-50 text-sky-700 ring-sky-600/20",
  uploading: "bg-amber-50 text-amber-700 ring-amber-600/20",
  processing: "bg-amber-50 text-amber-700 ring-amber-600/20",
  failed: "bg-red-50 text-red-700 ring-red-600/20",
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    STATUS_CLASS[status] ?? "bg-zinc-100 text-zinc-700 ring-zinc-600/20"
  const label = STATUS_LABEL[status] ?? status
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}
    >
      {label}
    </span>
  )
}

export function VideoList({ workspaceId }: Props) {
  const router = useRouter()
  const [videos, setVideos] = useState<VideoSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [accessSavingId, setAccessSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Filters. `searchInput` is the immediate text-field value; `searchQuery`
  // is the debounced version used to actually fire requests so each
  // keystroke doesn't hit the API.
  const [searchInput, setSearchInput] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [tagId, setTagId] = useState<string>("")
  const [categoryId, setCategoryId] = useState<string>("")
  const [tags, setTags] = useState<TagResponse[]>([])
  const [categories, setCategories] = useState<CategoryResponse[]>([])

  // Monotonic id of the most recently *issued* list request. Responses that
  // aren't from the latest request are ignored, so a slow earlier fetch
  // (rapid page/filter switches, or the 5s poll racing a manual reload)
  // can't overwrite fresher results out of order.
  const requestIdRef = useRef(0)

  useEffect(() => {
    const handle = setTimeout(() => setSearchQuery(searchInput.trim()), 300)
    return () => clearTimeout(handle)
  }, [searchInput])

  // Reset to page 1 whenever any filter changes — paginated results from a
  // previous filter shouldn't bleed into the new query.
  useEffect(() => {
    setPage(1)
  }, [searchQuery, tagId, categoryId])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      listTags({ workspaceId }),
      listCategories({ workspaceId }),
    ])
      .then(([tagRes, catRes]) => {
        if (cancelled) return
        setTags(tagRes.data)
        setCategories(catRes.data)
      })
      .catch(() => {
        // Filter selects are nice-to-have; failure to load options
        // shouldn't break the video list itself.
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const load = async (nextPage = page) => {
    const requestId = ++requestIdRef.current
    setLoading(true)
    try {
      const response = await listVideos({
        workspaceId,
        curPage: nextPage,
        perPage: PAGE_SIZE,
        q: searchQuery || undefined,
        tagId: tagId || undefined,
        categoryId: categoryId || undefined,
      })
      // A newer request has since been issued — discard this stale response.
      if (requestId !== requestIdRef.current) return
      setVideos(response.data)
      setTotal(response.total)
      setError(null)
    } catch {
      if (requestId !== requestIdRef.current) return
      setError("Не удалось загрузить список видео. Обновите страницу.")
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    void load(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, page, searchQuery, tagId, categoryId])

  const filtersActive = useMemo(
    () => Boolean(searchQuery || tagId || categoryId),
    [searchQuery, tagId, categoryId],
  )

  const handleResetFilters = () => {
    setSearchInput("")
    setSearchQuery("")
    setTagId("")
    setCategoryId("")
  }

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
    } catch {
      setError("Не удалось перезапустить обработку видео.")
    }
  }

  const handleDelete = async (video: VideoSummary) => {
    if (!window.confirm("Удалить видео из системы?")) return
    try {
      await deleteVideo({ workspaceId, videoId: video.id })
      setVideos((prev) => prev.filter((item) => item.id !== video.id))
      setError(null)
    } catch {
      setError("Не удалось удалить видео. Попробуйте ещё раз.")
    }
  }

  const handleAccessChange = async (
    video: VideoSummary,
    isPublic: boolean,
  ) => {
    setAccessSavingId(video.id)
    setError(null)
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
    } catch {
      // Without this the toggle silently snaps back with no explanation.
      setError("Не удалось изменить уровень доступа. Попробуйте ещё раз.")
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
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Поиск по названию или описанию"
          className="h-9 w-full min-w-[180px] flex-1 sm:max-w-xs"
        />
        <Select
          value={tagId || "any"}
          onValueChange={(value) => setTagId(value === "any" ? "" : value)}
        >
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="Все теги" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Все теги</SelectItem>
            {tags.map((tag) => (
              <SelectItem key={tag.id} value={tag.id}>
                {tag.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={categoryId || "any"}
          onValueChange={(value) =>
            setCategoryId(value === "any" ? "" : value)
          }
        >
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue placeholder="Все категории" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Все категории</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtersActive && (
          <Button
            variant="ghost"
            type="button"
            onClick={handleResetFilters}
            className="h-9"
          >
            Сбросить
          </Button>
        )}
        <div className="ml-auto text-xs text-muted-foreground">
          {loading ? "Обновление..." : `Найдено: ${total}`}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

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
              <tr
                key={video.id}
                className="border-t border-border transition-colors hover:bg-muted/40"
              >
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
                <td className="px-4 py-3 text-sm">
                  <StatusBadge status={video.status} />
                </td>
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

      {!loading && !error && videos.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {filtersActive
            ? "По заданным фильтрам ничего не найдено."
            : "Видео пока не загружены."}
        </p>
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
