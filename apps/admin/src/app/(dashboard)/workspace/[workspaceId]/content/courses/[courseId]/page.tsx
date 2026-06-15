"use client"

import { Button } from "@bjj-academy/ui-kit/ui"
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
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { Plus } from "lucide-react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { Fragment, useEffect, useMemo, useState } from "react"

import {
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
import { AttachVideoSheet } from "../../../../../../../features/content/course-detail/AttachVideoSheet"
import { ChapterHeaderRow } from "../../../../../../../features/content/course-detail/ChapterHeaderRow"
import { PublishedAtBadge } from "../../../../../../../features/content/course-detail/PublishedAtBadge"
import { ScheduleSheet } from "../../../../../../../features/content/course-detail/ScheduleSheet"
import { SortableLessonRow } from "../../../../../../../features/content/course-detail/SortableLessonRow"
import {
  buildGroups,
  chapterDragId,
  chapterIdFromDragId,
  isChapterDragId,
} from "../../../../../../../features/content/course-detail/helpers"

export default function CourseDetailPage() {
  const params = useParams<{ workspaceId: string; courseId: string }>()
  const workspaceId = params?.workspaceId
  const courseId = params?.courseId
  const router = useRouter()

  const [course, setCourse] = useState<CoursePlaylistDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [attachOpen, setAttachOpen] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)
  const [creatingChapter, setCreatingChapter] = useState(false)
  const [publishSaving, setPublishSaving] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)

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

  const inCourseIds = useMemo(
    () => new Set((course?.videos ?? []).map((v) => v.id)),
    [course],
  )

  const groups = useMemo(() => (course ? buildGroups(course) : []), [course])

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

  // Live = published and the publish date has passed. Draft (null) and
  // scheduled (future) are both "not yet visible to members".
  const isLive = useMemo(
    () =>
      Boolean(course?.publishedAt) &&
      new Date(course!.publishedAt as string).getTime() <= Date.now(),
    [course],
  )

  // Publish toggle, YouTube-style: visibility is driven solely by publishedAt.
  // If the course is already live, unpublish it (back to draft = null);
  // otherwise publish it right now. A future scheduled date is overridden by
  // an explicit "publish now".
  const handleTogglePublish = async () => {
    if (!workspaceId || !courseId || !course) return
    const live =
      Boolean(course.publishedAt) &&
      new Date(course.publishedAt as string).getTime() <= Date.now()
    const nextIso = live ? null : new Date().toISOString()
    const previous = course.publishedAt
    setPublishSaving(true)
    setError(null)
    setCourse({ ...course, publishedAt: nextIso })
    try {
      await updatePlaylist({
        workspaceId,
        playlistId: courseId,
        data: { publishedAt: nextIso },
      })
    } catch (err) {
      setCourse({ ...course, publishedAt: previous })
      setError(
        err instanceof Error ? err.message : "Не удалось изменить статус курса.",
      )
    } finally {
      setPublishSaving(false)
    }
  }

  // Save the scheduled publish moment. Passing null clears it; passing
  // a Date plus the time string composes an ISO timestamp interpreted
  // in the admin's local timezone (the moment is absolute, not wall-clock,
  // so timezone of admin doesn't matter for the actual switch flip).
  const handleSavePublishedAt = async (date: Date | null, time: string) => {
    if (!workspaceId || !courseId || !course) return
    let nextIso: string | null = null
    if (date) {
      const [h, m] = time.split(":").map((p) => parseInt(p, 10))
      const composed = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        h || 0,
        m || 0,
        0,
        0,
      )
      nextIso = composed.toISOString()
    }
    const previous = course.publishedAt
    setPublishSaving(true)
    setError(null)
    setCourse({ ...course, publishedAt: nextIso })
    try {
      await updatePlaylist({
        workspaceId,
        playlistId: courseId,
        data: { publishedAt: nextIso },
      })
    } catch (err) {
      setCourse({ ...course, publishedAt: previous })
      setError(
        err instanceof Error
          ? err.message
          : "Не удалось сохранить дату публикации.",
      )
    } finally {
      setPublishSaving(false)
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
      setError(err instanceof Error ? err.message : "Не удалось убрать видео.")
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
      setError(err instanceof Error ? err.message : "Не удалось создать раздел.")
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
        err instanceof Error ? err.message : "Не удалось переименовать раздел.",
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
      setError(err instanceof Error ? err.message : "Не удалось удалить раздел.")
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

    const chapterChanged = (movedVideo.chapterId ?? null) !== destChapterId
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
      if (!chapterChanged && movedVideo.order < neighbourVideo.order) {
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
            {course.tags.length > 0 && <span>· {course.tags.join(", ")}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleTogglePublish()}
            disabled={publishSaving}
            className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
              isLive
                ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
                : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50"
            }`}
            aria-pressed={isLive}
            title={
              isLive
                ? "Курс виден ученикам. Нажмите, чтобы вернуть в черновик."
                : "Курс скрыт от учеников. Нажмите, чтобы опубликовать сейчас."
            }
          >
            <span
              className={`size-2 rounded-full ${isLive ? "bg-primary" : "bg-muted-foreground/40"}`}
            />
            {isLive ? "Опубликован" : "Черновик"}
          </button>
          <PublishedAtBadge
            publishedAt={course.publishedAt}
            onOpen={() => setScheduleOpen(true)}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleCreateChapter()}
            disabled={creatingChapter}
          >
            <Plus className="mr-1 size-4" />
            {creatingChapter ? "Создаём..." : "Новый раздел"}
          </Button>
          <Button onClick={() => setAttachOpen(true)}>Добавить видео</Button>
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
                  <Fragment key={group.chapter?.id ?? "ungrouped"}>
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

      {workspaceId && courseId && (
        <AttachVideoSheet
          workspaceId={workspaceId}
          courseId={courseId}
          open={attachOpen}
          onOpenChange={setAttachOpen}
          inCourseIds={inCourseIds}
          onAttached={loadCourse}
          onError={setError}
        />
      )}

      <ScheduleSheet
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        publishedAt={course.publishedAt}
        saving={publishSaving}
        onSave={async (date, time) => {
          await handleSavePublishedAt(date, time)
          setScheduleOpen(false)
        }}
      />
    </div>
  )
}
