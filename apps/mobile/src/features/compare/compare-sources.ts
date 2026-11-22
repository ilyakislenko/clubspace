// Where a «Сравнить рядом» side can take its clip from. The picker shows one
// tab per entry of COMPARE_SOURCES and knows nothing else about them: a new
// source is one more provider in that list.
import type { ApiTypes } from "@clubspace/api-client"

import {
  listMyStudyPlans,
  type StudyPlanItem,
} from "../../shared/api/study-plans"
import { searchVideos } from "../../shared/api/video-search"
import {
  getVideoReview,
  getVideoReviewPlayback,
  listMyVideoReviews,
  type VideoReviewStatus,
} from "../../shared/api/video-reviews"
import {
  listMyVideoNotes,
  type MyVideoNotesItem,
} from "../../shared/api/video-study"
import { getVideo } from "../../shared/api/videos"
import { readResource } from "../../shared/cache/resource-cache"
import { pluralRu } from "../../shared/format-ru"
import { getCachedVideo, listOfflineEntries } from "../offline/offline-store"
import { loadStudyPlan, plansCacheKey } from "../study-plans/plan-store"
import { readCachedVideoNotes } from "../video/my-video-notes-cache"

// What a side plays: a club lesson (resolved like VideoScreen — stream, or the
// downloaded copy offline), or any other stream behind a lazily fetched,
// possibly short-lived URL.
export type CompareMedia =
  | { kind: "lesson"; videoId: string }
  | { kind: "stream"; title: string; resolveUri: () => Promise<string> }

// One pickable thing: a moment (`endSec: null`) or an A–B segment of a media.
export type CompareClip = {
  key: string
  media: CompareMedia
  title: string
  startSec: number
  endSec: number | null
}

// A heading in the list (a lesson, a plan) with its clips — given, or loaded
// when the group is opened (`loadClips`).
export type CompareGroup = {
  key: string
  title: string
  subtitle?: string
  clips?: CompareClip[]
  loadClips?: () => Promise<CompareClip[]>
}

export type CompareSourceContext = {
  workspaceId: string
  query: string
  online: boolean
  // The lesson the comparison started from: its own chapters come first.
  currentVideo: { id: string; title: string }
}

export type CompareSource = {
  id: string
  label: string
  searchPlaceholder: string
  load: (ctx: CompareSourceContext) => Promise<CompareGroup[]>
}

const OFFLINE_EMPTY = "Нет сети, а сохранённого списка на устройстве нет."
// Server search wants a couple of letters.
const MIN_SEARCH_LENGTH = 2

const lesson = (videoId: string): CompareMedia => ({ kind: "lesson", videoId })
const matches = (text: string, query: string) =>
  text.toLowerCase().includes(query.trim().toLowerCase())

// ---- «Закладки»: the member's bookmarks and segments («Мои заметки») ----

const bookmarksSource: CompareSource = {
  id: "bookmarks",
  label: "Закладки",
  searchPlaceholder: "Урок, название или заметка",
  load: async ({ workspaceId, query, online }) => {
    let items: MyVideoNotesItem[] | null = null
    if (online) {
      try {
        items = (await listMyVideoNotes({ workspaceId, q: query })).items
      } catch {
        // Unreachable server: the copy on the device below.
      }
    }
    items ??= await readCachedVideoNotes(workspaceId, query)
    if (!items) throw new Error(OFFLINE_EMPTY)
    return items
      .filter((item) => item.bookmarks.length > 0)
      .map((item) => ({
        key: item.video.id,
        title: item.video.title,
        subtitle: item.course?.title,
        clips: item.bookmarks.map((b) => ({
          key: b.id,
          media: lesson(item.video.id),
          title: b.label || "Без названия",
          startSec: b.positionSec,
          endSec: b.endSec,
        })),
      }))
  },
}

// ---- «Главы»: chapters of any lesson the member can open ----

// The lesson's start plus its chapters (online, else the downloaded details).
const lessonChapters = async (
  workspaceId: string,
  videoId: string,
): Promise<CompareClip[]> => {
  let timestamps
  try {
    timestamps = (await getVideo({ workspaceId, videoId })).timestamps
  } catch (err) {
    const cached = await getCachedVideo(videoId)
    if (!cached) throw err
    timestamps = cached.video.timestamps
  }
  return [
    { key: "start", media: lesson(videoId), title: "Начало", startSec: 0, endSec: null },
    ...timestamps.map((t) => ({
      key: t.id,
      media: lesson(videoId),
      title: t.title,
      startSec: t.positionSec,
      endSec: null,
    })),
  ]
}

const lessonGroup = (
  workspaceId: string,
  video: { id: string; title: string },
  subtitle?: string,
): CompareGroup => ({
  key: video.id,
  title: video.title,
  subtitle,
  loadClips: () => lessonChapters(workspaceId, video.id),
})

const chaptersSource: CompareSource = {
  id: "chapters",
  label: "Главы",
  searchPlaceholder: "Название урока",
  load: async ({ workspaceId, query, online, currentVideo }) => {
    const groups: CompareGroup[] = []
    const seen = new Set<string>()
    const add = (group: CompareGroup) => {
      if (seen.has(group.key)) return
      seen.add(group.key)
      groups.push(group)
    }
    if (!query.trim() || matches(currentVideo.title, query)) {
      add(lessonGroup(workspaceId, currentVideo, "Этот урок"))
    }
    let searched = false
    if (online && query.trim().length >= MIN_SEARCH_LENGTH) {
      try {
        const found = await searchVideos({ workspaceId, q: query.trim() })
        found.items.forEach((item) =>
          add(lessonGroup(workspaceId, item.video, item.course?.title)),
        )
        searched = true
      } catch {
        // Unreachable server: downloaded lessons below.
      }
    }
    if (!searched) {
      const downloaded = await listOfflineEntries()
      downloaded
        .filter((e) => e.status === "ready" && matches(e.video.title, query))
        .forEach((e) =>
          add(lessonGroup(workspaceId, e.video, e.course?.title ?? "Загружено")),
        )
    }
    return groups
  },
}

// ---- «Планы»: the member's study plans ----

type PlansList = ApiTypes.ListMyStudyPlansOutputOutput

const planClips = (items: readonly StudyPlanItem[]): CompareClip[] =>
  items
    .filter((item) => item.accessible)
    .map((item) => ({
      key: item.id,
      media: lesson(item.videoId),
      title: item.video ? `${item.title} · ${item.video.title}` : item.title,
      startSec: item.startSec,
      endSec: item.endSec,
    }))

const plansSource: CompareSource = {
  id: "plans",
  label: "Планы",
  searchPlaceholder: "Название плана",
  load: async ({ workspaceId, query, online }) => {
    let list: PlansList | null = null
    if (online) {
      try {
        list = await listMyStudyPlans({ workspaceId })
      } catch {
        // Unreachable server: the cached list below.
      }
    }
    list ??= (await readResource<PlansList>(plansCacheKey(workspaceId)))?.data ?? null
    if (!list) throw new Error(OFFLINE_EMPTY)
    return list.items
      .filter((plan) => matches(plan.title, query))
      .map((plan) => ({
        key: plan.id,
        title: plan.title,
        subtitle: `${plan.itemCount} ${pluralRu(plan.itemCount, "пункт", "пункта", "пунктов")}`,
        loadClips: async () =>
          planClips((await loadStudyPlan(workspaceId, plan.id)).items),
      }))
  },
}

// ---- «Мои разборы»: the member's own clips sent for a coach's review ----

// A clip plays once transcoded (the request is past uploading / failing).
const REVIEW_PLAYABLE: Record<VideoReviewStatus, boolean> = {
  uploading: false,
  processing: false,
  failed: false,
  open: true,
  answered: true,
  closed: true,
}

const reviewsSource: CompareSource = {
  id: "reviews",
  label: "Мои разборы",
  searchPlaceholder: "Название разбора",
  load: async ({ workspaceId, query, online }) => {
    // Member clips are streamed only: no copy on the device.
    if (!online) throw new Error("Разборы доступны только с интернетом.")
    const { items } = await listMyVideoReviews({ workspaceId })
    return items
      .filter((r) => REVIEW_PLAYABLE[r.status] && matches(r.title, query))
      .map((r) => {
        // The signed link is fetched when the side opens (it expires).
        const media: CompareMedia = {
          kind: "stream",
          title: r.title,
          resolveUri: async () =>
            (await getVideoReviewPlayback({ workspaceId, requestId: r.id })).hlsUrl,
        }
        return {
          key: r.id,
          title: r.title,
          subtitle: r.commentCount
            ? `${r.commentCount} ${pluralRu(r.commentCount, "комментарий", "комментария", "комментариев")}`
            : undefined,
          // The start, then the moments the coach commented on.
          loadClips: async () => {
            const review = await getVideoReview({ workspaceId, requestId: r.id })
            return [
              { key: "start", media, title: "Начало", startSec: 0, endSec: null },
              ...review.comments.map((c) => ({
                key: c.id,
                media,
                title: c.text || "Комментарий",
                startSec: c.atSec,
                endSec: c.endSec,
              })),
            ]
          },
        }
      })
  },
}

export const COMPARE_SOURCES: readonly CompareSource[] = [
  bookmarksSource,
  chaptersSource,
  plansSource,
  reviewsSource,
]
