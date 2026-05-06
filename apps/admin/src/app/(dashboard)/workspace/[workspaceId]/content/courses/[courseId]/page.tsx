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
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Check, GripVertical, Plus, Search, Trash2 } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { Fragment, useEffect, useMemo, useState } from "react"

import {
  attachVideosToPlaylist,
  createPlaylistChapter,
  deletePlaylistChapter,
  detachVideoFromPlaylist,
  getPlaylist,
  movePlaylistChapter,
  movePlaylistVideo,
  updatePlaylist,
  updatePlaylistChapter,
  updatePlaylistVideo,
  type CoursePlaylistChapter,
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

// ---- Sortable id helpers ---------------------------------------------------

// Sections live in the same SortableContext as videos. Their ids are
// prefixed so handleDragEnd can route drag events to the right code path.
const CHAPTER_ID_PREFIX = "chapter:"
const NONE_CHAPTER_ID = `${CHAPTER_ID_PREFIX}none`

const chapterDragId = (chapterId: string | null) =>
  chapterId === null ? NONE_CHAPTER_ID : `${CHAPTER_ID_PREFIX}${chapterId}`

const isChapterDragId = (id: string | number): id is string =>
  typeof id === "string" && id.startsWith(CHAPTER_ID_PREFIX)

const chapterIdFromDragId = (dragId: string): string | null => {
  const raw = dragId.slice(CHAPTER_ID_PREFIX.length)
  return raw === "none" ? null : raw
}

// ---- Chapter / video grouping ---------------------------------------------

type ChapterGroup = {
  // null = pseudo-chapter "Без раздела".
  chapter: CoursePlaylistChapter | null
  videos: CoursePlaylistVideo[]
}

const buildGroups = (course: CoursePlaylistDetail): ChapterGroup[] => {
  const ungrouped = course.videos
    .filter((v) => !v.chapterId)
    .slice()
    .sort((a, b) => a.order - b.order)

  const byChapter = new Map<string, CoursePlaylistVideo[]>()
  for (const v of course.videos) {
    if (!v.chapterId) continue
    const list = byChapter.get(v.chapterId) ?? []
    list.push(v)
    byChapter.set(v.chapterId, list)
  }
  for (const list of byChapter.values()) {
    list.sort((a, b) => a.order - b.order)
  }

  const chaptersInOrder = course.chapters
    .slice()
    .sort((a, b) => a.order - b.order)

  // Ungrouped group is always rendered first so users have a place to drop
  // things "out of any section" — even when it currently holds nothing.
  const groups: ChapterGroup[] = [{ chapter: null, videos: ungrouped }]
  for (const c of chaptersInOrder) {
    groups.push({ chapter: c, videos: byChapter.get(c.id) ?? [] })
  }
  return groups
}

// ---- Component ------------------------------------------------------------

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
  const [creatingChapter, setCreatingChapter] = useState(false)
  const [publishSaving, setPublishSaving] = useState(false)

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

  const groups = useMemo(
    () => (course ? buildGroups(course) : []),
    [course],
  )

  // Sortable id list mirrors the visual order: each group's header (drag
  // id `chapter:<id>` or `chapter:none` for ungrouped), then its videos.
  const sortableIds = useMemo(() => {
    const ids: string[] = []
    for (const g of groups) {
      ids.push(chapterDragId(g.chapter?.id ?? null))
      for (const v of g.videos) ids.push(v.id)
    }
    return ids
  }, [groups])

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

  const handleTogglePublish = async () => {
    if (!workspaceId || !courseId || !course) return
    const next = !course.isPublic
    const previous = course.isPublic
    setPublishSaving(true)
    setError(null)
    setCourse({ ...course, isPublic: next })
    try {
      await updatePlaylist({
        workspaceId,
        playlistId: courseId,
        data: { isPublic: next },
      })
    } catch (err) {
      setCourse({ ...course, isPublic: previous })
      setError(
        err instanceof Error ? err.message : "Не удалось изменить статус курса.",
      )
    } finally {
      setPublishSaving(false)
    }
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

  // ---- Chapter CRUD --------------------------------------------------------

  const handleCreateChapter = async () => {
    if (!workspaceId || !courseId) return
    setCreatingChapter(true)
    setError(null)
    try {
      const created = await createPlaylistChapter({
        workspaceId,
        playlistId: courseId,
        title: "Новый раздел",
      })
      setCourse((prev) =>
        prev ? { ...prev, chapters: [...prev.chapters, created] } : prev,
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось создать раздел.",
      )
    } finally {
      setCreatingChapter(false)
    }
  }

  const handleRenameChapter = async (chapterId: string, title: string) => {
    if (!workspaceId || !courseId) return
    const trimmed = title.trim()
    if (trimmed.length === 0) return
    setError(null)
    try {
      const updated = await updatePlaylistChapter({
        workspaceId,
        playlistId: courseId,
        chapterId,
        data: { title: trimmed },
      })
      setCourse((prev) =>
        prev
          ? {
              ...prev,
              chapters: prev.chapters.map((c) =>
                c.id === chapterId ? { ...c, title: updated.title } : c,
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

  const handleDeleteChapter = async (chapter: CoursePlaylistChapter) => {
    if (!workspaceId || !courseId) return
    const ok = window.confirm(
      `Удалить раздел «${chapter.title}»? Уроки внутри останутся в курсе и попадут в «Без раздела».`,
    )
    if (!ok) return
    setError(null)
    try {
      await deletePlaylistChapter({
        workspaceId,
        playlistId: courseId,
        chapterId: chapter.id,
      })
      setCourse((prev) =>
        prev
          ? {
              ...prev,
              chapters: prev.chapters.filter((c) => c.id !== chapter.id),
              videos: prev.videos.map((v) =>
                v.chapterId === chapter.id
                  ? { ...v, chapterId: null, chapterTitle: null }
                  : v,
              ),
            }
          : prev,
      )
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Не удалось удалить раздел.",
      )
    }
  }

  // ---- DnD ----------------------------------------------------------------

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!workspaceId || !courseId || !course) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    const previous = course

    const onError = (err: unknown, fallback: string) => {
      setCourse(previous)
      setError(err instanceof Error ? err.message : fallback)
    }

    if (isChapterDragId(active.id)) {
      // ---- section drag ----
      const sourceId = chapterIdFromDragId(active.id)
      // The pseudo "Без раздела" header is anchored at the top and not
      // draggable.
      if (sourceId === null) return

      // Resolve the target chapter — drop on another header => directly
      // that chapter; drop on a video => the chapter that contains it
      // (NEVER split into the middle of a chapter).
      let targetChapterId: string | null = null
      if (isChapterDragId(over.id)) {
        targetChapterId = chapterIdFromDragId(over.id)
      } else {
        const overVideo = course.videos.find((v) => v.id === over.id)
        targetChapterId = overVideo?.chapterId ?? null
      }
      if (targetChapterId === null) {
        // Dropped onto the ungrouped block — do not allow demoting a
        // chapter into ungrouped territory.
        return
      }
      if (targetChapterId === sourceId) return

      // Compute new order: place source chapter immediately before the
      // target chapter.
      const ordered = course.chapters
        .slice()
        .sort((a, b) => a.order - b.order)
      const sourceIdx = ordered.findIndex((c) => c.id === sourceId)
      const targetIdx = ordered.findIndex((c) => c.id === targetChapterId)
      if (sourceIdx === -1 || targetIdx === -1) return
      const without = ordered.filter((c) => c.id !== sourceId)
      const insertAt =
        targetIdx > sourceIdx
          ? without.findIndex((c) => c.id === targetChapterId) + 1
          : without.findIndex((c) => c.id === targetChapterId)
      const next = [
        ...without.slice(0, insertAt),
        ordered[sourceIdx],
        ...without.slice(insertAt),
      ].map((c, idx) => ({ ...c, order: idx }))

      setCourse({ ...course, chapters: next })
      setReordering(true)
      try {
        await movePlaylistChapter({
          workspaceId,
          playlistId: courseId,
          chapterId: sourceId,
          beforeChapterId: targetChapterId,
        })
      } catch (err) {
        onError(err, "Не удалось переместить раздел.")
      } finally {
        setReordering(false)
      }
      return
    }

    // ---- video drag ----
    if (typeof active.id !== "string") return
    const movedId = active.id
    const movedVideo = course.videos.find((v) => v.id === movedId)
    if (!movedVideo) return

    // Resolve destination chapter and the video we're inserting near.
    let destChapterId: string | null
    let neighbourVideo: CoursePlaylistVideo | null = null
    if (isChapterDragId(over.id)) {
      destChapterId = chapterIdFromDragId(over.id)
      // Drop on a section header => video joins that section as the
      // first lesson. Anchor before the current first video of that
      // section, if any.
      neighbourVideo =
        course.videos.find(
          (v) =>
            v.chapterId === destChapterId &&
            v.id !== movedId &&
            !course.videos.some(
              (x) =>
                x.chapterId === destChapterId &&
                x.id !== movedId &&
                x.order < v.order,
            ),
        ) ?? null
    } else {
      neighbourVideo = course.videos.find((v) => v.id === over.id) ?? null
      destChapterId = neighbourVideo?.chapterId ?? null
    }

    const chapterChanged =
      (movedVideo.chapterId ?? null) !== destChapterId
    const targetTitle = destChapterId
      ? course.chapters.find((c) => c.id === destChapterId)?.title ?? null
      : null

    // Optimistic update of local state — both order via global ordinal
    // shift and chapterId/Title.
    const others = course.videos.filter((v) => v.id !== movedId)
    let insertAt: number
    if (neighbourVideo) {
      insertAt = others.findIndex((v) => v.id === neighbourVideo!.id)
      if (insertAt < 0) insertAt = others.length
      // If we're staying within the same chapter and moving down, account
      // for the removal of the moved item from earlier in the list.
      if (
        !chapterChanged &&
        movedVideo.order < neighbourVideo.order
      ) {
        insertAt += 1
      }
    } else {
      insertAt = others.length
    }
    const reorderedVideos = [
      ...others.slice(0, insertAt),
      {
        ...movedVideo,
        chapterId: destChapterId,
        chapterTitle: targetTitle,
      },
      ...others.slice(insertAt),
    ].map((v, idx) => ({ ...v, order: idx }))

    setCourse({ ...course, videos: reorderedVideos })
    setReordering(true)
    try {
      if (chapterChanged) {
        await updatePlaylistVideo({
          workspaceId,
          playlistId: courseId,
          videoId: movedId,
          data: { chapterId: destChapterId },
        })
      }
      const movedAt = reorderedVideos.findIndex((v) => v.id === movedId)
      const afterId = movedAt > 0 ? reorderedVideos[movedAt - 1].id : null
      const beforeId =
        movedAt < reorderedVideos.length - 1
          ? reorderedVideos[movedAt + 1].id
          : null
      await movePlaylistVideo({
        workspaceId,
        playlistId: courseId,
        videoId: movedId,
        afterId,
        beforeId,
      })
    } catch (err) {
      onError(err, "Не удалось изменить порядок.")
    } finally {
      setReordering(false)
    }
  }

  // ---- Render -------------------------------------------------------------

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
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleTogglePublish()}
            disabled={publishSaving}
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
              course.isPublic
                ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
            }`}
            aria-pressed={course.isPublic}
            title={
              course.isPublic
                ? "Курс виден ученикам. Нажмите, чтобы скрыть."
                : "Курс скрыт от учеников (черновик). Нажмите, чтобы опубликовать."
            }
          >
            <span
              className={`size-2 rounded-full ${course.isPublic ? "bg-primary" : "bg-muted-foreground/40"}`}
            />
            {course.isPublic ? "Открыт" : "Черновик"}
          </button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleCreateChapter()}
            disabled={creatingChapter}
          >
            <Plus className="mr-1 size-4" />
            {creatingChapter ? "Создаём..." : "Новый раздел"}
          </Button>
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

        {course.videos.length === 0 && course.chapters.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            В курсе пока нет ни видео, ни разделов. «Добавить видео» / «Новый
            раздел» — создаёт их.
          </p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(event) => void handleDragEnd(event)}
          >
            <SortableContext
              items={sortableIds}
              strategy={verticalListSortingStrategy}
            >
              <ol className="divide-y divide-border rounded-lg border border-border">
                {groups.map((group) => (
                  <Fragment
                    key={group.chapter?.id ?? "ungrouped"}
                  >
                    <ChapterHeaderRow
                      chapter={group.chapter}
                      onRename={handleRenameChapter}
                      onDelete={handleDeleteChapter}
                      reordering={reordering}
                    />
                    {group.videos.length === 0 && group.chapter !== null && (
                      <li className="px-3 py-3 text-xs text-muted-foreground">
                        Перетащите урок в этот раздел.
                      </li>
                    )}
                    {group.videos.map((video, idxInGroup) => (
                      <SortableLessonRow
                        key={video.id}
                        video={video}
                        index={idxInGroup}
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

// ---------------------------------------------------------------------------
// Section header row
// ---------------------------------------------------------------------------

type ChapterHeaderRowProps = {
  // null = pseudo-section "Без раздела".
  chapter: CoursePlaylistChapter | null
  onRename: (chapterId: string, title: string) => Promise<void> | void
  onDelete: (chapter: CoursePlaylistChapter) => Promise<void> | void
  reordering: boolean
}

function ChapterHeaderRow({
  chapter,
  onRename,
  onDelete,
  reordering,
}: ChapterHeaderRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(chapter?.title ?? "")

  const dragId = chapterDragId(chapter?.id ?? null)
  const draggable = chapter !== null
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: dragId, disabled: !draggable })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  useEffect(() => {
    setDraft(chapter?.title ?? "")
  }, [chapter?.title])

  const commit = () => {
    if (!chapter) return
    setEditing(false)
    if (draft.trim() && draft.trim() !== chapter.title) {
      void onRename(chapter.id, draft)
    } else {
      setDraft(chapter.title)
    }
  }

  const cancel = () => {
    setEditing(false)
    setDraft(chapter?.title ?? "")
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-1 border-b border-border bg-muted/40"
    >
      {draggable ? (
        <button
          type="button"
          aria-label="Перетащить раздел"
          className="cursor-grab touch-none px-2 py-1.5 text-muted-foreground hover:text-foreground active:cursor-grabbing disabled:opacity-50"
          disabled={reordering}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      ) : (
        <span aria-hidden className="px-2 py-1.5 opacity-0">
          <GripVertical className="size-4" />
        </span>
      )}

      {editing && chapter ? (
        <>
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
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => chapter && setEditing(true)}
            disabled={!chapter}
            className={`flex-1 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider transition-colors ${
              chapter
                ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                : "italic text-muted-foreground/60"
            }`}
            title={
              chapter
                ? "Нажмите, чтобы переименовать раздел"
                : undefined
            }
          >
            {chapter?.title ?? "Без раздела"}
          </button>
          {chapter && (
            <button
              type="button"
              aria-label="Удалить раздел"
              onClick={() => void onDelete(chapter)}
              className="px-2 py-1.5 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </>
      )}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Lesson row
// ---------------------------------------------------------------------------

type SortableLessonRowProps = {
  video: CoursePlaylistVideo
  index: number
  onOpen: () => void
  onRemove: () => void
  removing: boolean
  reordering: boolean
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
