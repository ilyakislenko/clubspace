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
import { Fragment, useEffect, useMemo, useState } from "react"

import {
  attachVideosToPlaylist,
  detachVideoFromPlaylist,
  getPlaylist,
  movePlaylistVideo,
  updatePlaylistVideo,
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

type ChapterRun = {
  // Stable key (chapter title or sentinel for ungrouped + run index).
  key: string
  // null means "Без раздела" — lessons not yet assigned.
  title: string | null
  videoIds: string[]
  // Lessons enriched with their global ordinal so the row can show №N.
  lessons: { video: CoursePlaylistVideo; lessonIndex: number }[]
}

const buildChapterRuns = (videos: CoursePlaylistVideo[]): ChapterRun[] => {
  const runs: ChapterRun[] = []
  videos.forEach((video, index) => {
    const title = video.chapterTitle ?? null
    const last = runs[runs.length - 1]
    if (last && last.title === title) {
      last.videoIds.push(video.id)
      last.lessons.push({ video, lessonIndex: index })
    } else {
      runs.push({
        key: `${runs.length}:${title ?? ""}`,
        title,
        videoIds: [video.id],
        lessons: [{ video, lessonIndex: index }],
      })
    }
  })
  return runs
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

  const chapterRuns = useMemo(
    () => buildChapterRuns(course?.videos ?? []),
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

  const handleRenameChapter = async (
    videoIds: string[],
    nextValue: string,
  ) => {
    if (!workspaceId || !courseId || videoIds.length === 0) return
    const trimmed = nextValue.trim()
    const normalised = trimmed.length === 0 ? null : trimmed

    setError(null)
    try {
      await Promise.all(
        videoIds.map((videoId) =>
          updatePlaylistVideo({
            workspaceId,
            playlistId: courseId,
            videoId,
            data: { chapterTitle: normalised },
          }),
        ),
      )
      const ids = new Set(videoIds)
      setCourse((prev) =>
        prev
          ? {
              ...prev,
              videos: prev.videos.map((v) =>
                ids.has(v.id) ? { ...v, chapterTitle: normalised } : v,
              ),
            }
          : prev,
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Не удалось переименовать раздел.",
      )
    }
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!workspaceId || !courseId || !course) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = course.videos.findIndex((v) => v.id === active.id)
    const newIndex = course.videos.findIndex((v) => v.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return

    const next = arrayMove(course.videos, oldIndex, newIndex)
    const movedId = active.id as string
    const movedAt = next.findIndex((v) => v.id === movedId)
    const afterId = movedAt > 0 ? next[movedAt - 1].id : null
    const beforeId =
      movedAt < next.length - 1 ? next[movedAt + 1].id : null

    const previous = course.videos
    setCourse({ ...course, videos: next })
    setReordering(true)
    setError(null)
    try {
      await movePlaylistVideo({
        workspaceId,
        playlistId: courseId,
        videoId: movedId,
        afterId,
        beforeId,
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
                {chapterRuns.map((run) => (
                  <Fragment key={run.key}>
                    <ChapterHeaderRow
                      title={run.title}
                      videoIds={run.videoIds}
                      onRename={handleRenameChapter}
                    />
                    {run.lessons.map(({ video, lessonIndex }) => (
                      <SortableLessonRow
                        key={video.id}
                        video={video}
                        index={lessonIndex}
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
                  </Fragment>
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

type ChapterHeaderRowProps = {
  // null = pseudo-section "Без раздела" for ungrouped lessons.
  title: string | null
  videoIds: string[]
  onRename: (videoIds: string[], nextTitle: string) => Promise<void> | void
}

function ChapterHeaderRow({ title, videoIds, onRename }: ChapterHeaderRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title ?? "")

  useEffect(() => {
    setDraft(title ?? "")
  }, [title])

  const commit = () => {
    setEditing(false)
    if ((draft.trim() || null) !== title) {
      void onRename(videoIds, draft)
    }
  }

  const cancel = () => {
    setEditing(false)
    setDraft(title ?? "")
  }

  if (editing) {
    return (
      <li className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <Input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit()
            if (event.key === "Escape") cancel()
          }}
          placeholder="Например: Атаки с гарда"
          className="h-7 max-w-xs text-xs"
        />
        <Button type="button" size="sm" variant="ghost" onClick={commit}>
          Сохранить
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={cancel}>
          Отмена
        </Button>
      </li>
    )
  }

  return (
    <li className="border-b border-border bg-muted/40">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={`block w-full px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider transition-colors hover:bg-muted ${
          title
            ? "text-muted-foreground"
            : "text-muted-foreground/60 italic"
        }`}
        title="Нажмите, чтобы переименовать раздел"
      >
        {title ?? "Без раздела — нажмите, чтобы назначить"}
      </button>
    </li>
  )
}

const LESSON_STATUS_LABEL: Record<string, string> = {
  ready: "Готово",
  uploaded: "Загружено",
  uploading: "Загружается",
  processing: "Обработка",
  failed: "Ошибка",
}

const LESSON_STATUS_CLASS: Record<string, string> = {
  ready: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  uploaded: "bg-sky-50 text-sky-700 ring-sky-600/20",
  uploading: "bg-amber-50 text-amber-700 ring-amber-600/20",
  processing: "bg-amber-50 text-amber-700 ring-amber-600/20",
  failed: "bg-red-50 text-red-700 ring-red-600/20",
}

function LessonStatusBadge({ status }: { status: string }) {
  const cls =
    LESSON_STATUS_CLASS[status] ?? "bg-zinc-100 text-zinc-700 ring-zinc-600/20"
  const label = LESSON_STATUS_LABEL[status] ?? status
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cls}`}
    >
      {label}
    </span>
  )
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
      className="flex flex-wrap items-center gap-3 p-3 transition-colors hover:bg-muted/40"
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
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80"
        >
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
          <div className="min-w-0 flex-1 space-y-1">
            <div className="truncate text-sm font-medium">{video.title}</div>
            <div className="flex flex-wrap items-center gap-2">
              <LessonStatusBadge status={video.status} />
              {duration && (
                <span className="text-xs text-muted-foreground">
                  {duration}
                </span>
              )}
            </div>
          </div>
        </button>
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
