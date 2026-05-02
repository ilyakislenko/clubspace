"use client"

import {
  Button,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@bjj-academy/ui-kit/ui"
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Check, GripVertical, Search } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import {
  attachVideosToPlaylist,
  detachVideoFromPlaylist,
  getPlaylist,
  reorderPlaylistVideos,
  type CoursePlaylistDetail,
  type CoursePlaylistVideo,
} from "../../../../../../../shared/api/playlists"
import { listVideos } from "../../../../../../../shared/api/videos"

type WorkspaceVideo = {
  id: string
  title: string
  status: string
  thumbnailUrl?: string | null
  duration?: number | null
}

const formatDuration = (seconds?: number | null): string | null => {
  if (!seconds || seconds <= 0) return null
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${minutes}:${secs.toString().padStart(2, "0")}`
}

export default function CourseDetailPage() {
  const params = useParams<{ workspaceId: string; courseId: string }>()
  const workspaceId = params?.workspaceId
  const courseId = params?.courseId
  const router = useRouter()

  const [course, setCourse] = useState<CoursePlaylistDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [attachOpen, setAttachOpen] = useState(false)
  const [allVideos, setAllVideos] = useState<WorkspaceVideo[]>([])
  const [allVideosLoading, setAllVideosLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set())
  const [attachSaving, setAttachSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const loadCourse = async () => {
    if (!workspaceId || !courseId) return
    setError(null)
    try {
      const data = await getPlaylist({ workspaceId, playlistId: courseId })
      setCourse(data)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось загрузить курс.",
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    void loadCourse()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, courseId])

  const openAttach = async () => {
    setAttachOpen(true)
    setSearch("")
    setPickedIds(new Set())
    if (!workspaceId) return
    setAllVideosLoading(true)
    try {
      const response = await listVideos({ workspaceId, perPage: 200 })
      setAllVideos(
        response.data.map((v) => ({
          id: v.id,
          title: v.title,
          status: v.status,
          thumbnailUrl: v.thumbnailUrl,
          duration: v.duration,
        })),
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось загрузить видео.",
      )
    } finally {
      setAllVideosLoading(false)
    }
  }

  const inCourseIds = useMemo(
    () => new Set((course?.videos ?? []).map((v) => v.id)),
    [course],
  )

  const candidates = useMemo(() => {
    const query = search.trim().toLowerCase()
    return allVideos.filter((video) => {
      if (inCourseIds.has(video.id)) return false
      if (!query) return true
      return video.title.toLowerCase().includes(query)
    })
  }, [allVideos, inCourseIds, search])

  const togglePick = (id: string) => {
    setPickedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleAttach = async () => {
    if (!workspaceId || !courseId || pickedIds.size === 0) return
    setAttachSaving(true)
    setError(null)
    try {
      await attachVideosToPlaylist({
        workspaceId,
        playlistId: courseId,
        videoIds: Array.from(pickedIds),
      })
      await loadCourse()
      setAttachOpen(false)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось добавить видео.",
      )
    } finally {
      setAttachSaving(false)
    }
  }

  const handleRemove = async (video: CoursePlaylistVideo) => {
    if (!workspaceId || !courseId) return
    if (!window.confirm(`Убрать «${video.title}» из курса?`)) return
    setRemovingId(video.id)
    setError(null)
    try {
      await detachVideoFromPlaylist({
        workspaceId,
        playlistId: courseId,
        videoId: video.id,
      })
      setCourse((prev) =>
        prev
          ? { ...prev, videos: prev.videos.filter((v) => v.id !== video.id) }
          : prev,
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось убрать видео.",
      )
    } finally {
      setRemovingId(null)
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!workspaceId || !courseId || !course) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = course.videos.findIndex((v) => v.id === active.id)
    const newIndex = course.videos.findIndex((v) => v.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    const next = arrayMove(course.videos, oldIndex, newIndex).map(
      (video, index) => ({ ...video, order: index + 1 }),
    )
    const previous = course.videos
    setCourse({ ...course, videos: next })
    setReordering(true)
    setError(null)
    try {
      await reorderPlaylistVideos({
        workspaceId,
        playlistId: courseId,
        videoIds: next.map((v) => v.id),
      })
    } catch (err) {
      setCourse({ ...course, videos: previous })
      setError(
        err instanceof Error ? err.message : "Не удалось изменить порядок.",
      )
    } finally {
      setReordering(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg border border-border bg-muted/50" />
      </div>
    )
  }

  if (error && !course) {
    return (
      <div className="space-y-4">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
        <Button
          variant="outline"
          onClick={() => router.push(`/workspace/${workspaceId}/content`)}
        >
          К списку курсов
        </Button>
      </div>
    )
  }

  if (!course) return null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/workspace/${workspaceId}/content`}
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Контент
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{course.title}</h1>
          {course.description && (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {course.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>slug: {course.slug}</span>
            {course.level && <span>· уровень: {course.level}</span>}
            {course.tags.length > 0 && (
              <span>· {course.tags.join(", ")}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={openAttach}>Добавить видео</Button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="space-y-2">
        <div className="text-sm font-medium">
          Уроки {course.videos.length > 0 && `(${course.videos.length})`}
        </div>

        {course.videos.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            В курсе пока нет видео. Нажмите «Добавить видео», чтобы прикрепить.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => void handleDragEnd(event)}
          >
            <SortableContext
              items={course.videos.map((v) => v.id)}
              strategy={verticalListSortingStrategy}
            >
              <ol className="divide-y divide-border rounded-lg border border-border">
                {course.videos.map((video, index) => (
                  <SortableLessonRow
                    key={video.id}
                    video={video}
                    index={index}
                    onOpen={() =>
                      router.push(
                        `/workspace/${workspaceId}/videos/${video.id}`,
                      )
                    }
                    onRemove={() => void handleRemove(video)}
                    removing={removingId === video.id}
                    reordering={reordering}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        )}
      </section>

      <Sheet
        open={attachOpen}
        onOpenChange={(open) => {
          setAttachOpen(open)
          if (!open) {
            setSearch("")
            setPickedIds(new Set())
          }
        }}
      >
        <SheetContent className="flex w-full flex-col gap-4 sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Добавить видео в курс</SheetTitle>
            <SheetDescription>
              Выберите одно или несколько видео — они появятся в конце курса.
            </SheetDescription>
          </SheetHeader>

          <div className="flex items-center gap-2 rounded-md border border-border px-2">
            <Search className="size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Поиск по названию"
              className="h-9 border-none p-0 focus-visible:ring-0"
            />
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto">
            {allVideosLoading && (
              <div className="text-sm text-muted-foreground">Загружаем...</div>
            )}
            {!allVideosLoading && candidates.length === 0 && (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                {search.trim()
                  ? "Ничего не найдено."
                  : "Все видео воркспейса уже в курсе."}
              </p>
            )}
            {candidates.map((video) => {
              const checked = pickedIds.has(video.id)
              return (
                <button
                  key={video.id}
                  type="button"
                  onClick={() => togglePick(video.id)}
                  className="flex w-full items-center gap-3 rounded-md border border-border p-2 text-left hover:bg-muted"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-border">
                    {checked && <Check className="size-4" />}
                  </span>
                  <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-muted">
                    {video.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={video.thumbnailUrl}
                        alt={video.title}
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {video.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Статус: {video.status}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          <SheetFooter>
            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">
                Выбрано: {pickedIds.size}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setAttachOpen(false)}
                  disabled={attachSaving}
                >
                  Отмена
                </Button>
                <Button
                  type="button"
                  onClick={() => void handleAttach()}
                  disabled={attachSaving || pickedIds.size === 0}
                >
                  {attachSaving ? "Добавляем..." : "Добавить"}
                </Button>
              </div>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

    </div>
  )
}

type SortableLessonRowProps = {
  video: CoursePlaylistVideo
  index: number
  onOpen: () => void
  onRemove: () => void
  removing: boolean
  reordering: boolean
}

function SortableLessonRow({
  video,
  index,
  onOpen,
  onRemove,
  removing,
  reordering,
}: SortableLessonRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: video.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    background: isDragging ? "var(--muted, #f4f4f5)" : undefined,
  }

  const duration = formatDuration(video.duration)

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex flex-wrap items-center gap-3 p-3"
    >
      <button
        type="button"
        aria-label="Перетащить"
        className="cursor-grab touch-none p-1 text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:opacity-50"
        disabled={reordering}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>
      <span className="w-6 text-xs text-muted-foreground">№{index + 1}</span>
      <div className="h-12 w-20 shrink-0 overflow-hidden rounded-md bg-muted">
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
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full text-left"
        >
          <div className="truncate text-sm font-medium">{video.title}</div>
          <div className="text-xs text-muted-foreground">
            Статус: {video.status}
            {duration ? ` · ${duration}` : ""}
          </div>
        </button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRemove}
        disabled={removing}
      >
        {removing ? "Убираем..." : "Убрать"}
      </Button>
    </li>
  )
}
