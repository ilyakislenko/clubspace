import {
  type CoursePlaylistChapter,
  type CoursePlaylistDetail,
  type CoursePlaylistVideo,
} from "../../../shared/api/playlists"

export type WorkspaceVideo = {
  id: string
  title: string
  status: string
  thumbnailUrl?: string | null
  duration?: number | null
}

export const formatDuration = (seconds?: number | null): string | null => {
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

export const chapterDragId = (chapterId: string | null) =>
  chapterId === null ? NONE_CHAPTER_ID : `${CHAPTER_ID_PREFIX}${chapterId}`

export const isChapterDragId = (id: string | number): id is string =>
  typeof id === "string" && id.startsWith(CHAPTER_ID_PREFIX)

export const chapterIdFromDragId = (dragId: string): string | null => {
  const raw = dragId.slice(CHAPTER_ID_PREFIX.length)
  return raw === "none" ? null : raw
}

// ---- Chapter / video grouping ---------------------------------------------

export type ChapterGroup = {
  // null = pseudo-chapter "Без раздела".
  chapter: CoursePlaylistChapter | null
  videos: CoursePlaylistVideo[]
}

export const buildGroups = (course: CoursePlaylistDetail): ChapterGroup[] => {
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
