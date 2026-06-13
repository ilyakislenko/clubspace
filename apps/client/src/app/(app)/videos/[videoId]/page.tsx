"use client"

import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@bjj-academy/ui-kit/ui"
import { PlyrPlayer } from "../../../../features/video-player/plyr-player"
import { getCourse, type CourseDetail } from "../../../../shared/api/courses"
import {
  getVideo,
  getVideoPlayback,
  saveVideoProgress,
  type VideoDetail,
} from "../../../../shared/api/videos"

export default function VideoPage() {
  const params = useParams<{ videoId: string }>()
  const searchParams = useSearchParams()
  const courseId = searchParams.get("courseId")
  const videoId = params?.videoId
  const router = useRouter()

  const [video, setVideo] = useState<VideoDetail | null>(null)
  const [course, setCourse] = useState<CourseDetail | null>(null)
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [playbackError, setPlaybackError] = useState<string | null>(null)

  useEffect(() => {
    if (!videoId) return
    let cancelled = false

    void (async () => {
      const workspaceId =
        typeof window !== "undefined"
          ? window.localStorage.getItem("workspaceId")
          : null

      if (!workspaceId) {
        setError("Нет активного клуба.")
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)
      setPlaybackError(null)
      setPlaybackUrl(null)

      try {
        const [videoData, courseData] = await Promise.all([
          getVideo({ workspaceId, videoId }),
          courseId ? getCourse({ workspaceId, courseId }) : Promise.resolve(null),
        ])
        if (cancelled) return
        setVideo(videoData)
        setCourse(courseData)
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error ? err.message : "Не удалось загрузить видео.",
        )
        setLoading(false)
        return
      }

      try {
        const playback = await getVideoPlayback({ videoId })
        if (cancelled) return
        setPlaybackUrl(playback.hlsUrl)
      } catch (err) {
        if (cancelled) return
        setPlaybackError(
          err instanceof Error ? err.message : "Видео ещё не готово.",
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [videoId, courseId])

  const { prevVideoId, nextVideoId, currentIndex } = useMemo(() => {
    if (!course || !videoId) {
      return { prevVideoId: null, nextVideoId: null, currentIndex: -1 }
    }
    const idx = course.videos.findIndex((v) => v.id === videoId)
    return {
      currentIndex: idx,
      prevVideoId: idx > 0 ? course.videos[idx - 1].id : null,
      nextVideoId:
        idx >= 0 && idx < course.videos.length - 1
          ? course.videos[idx + 1].id
          : null,
    }
  }, [course, videoId])

  const navigateTo = (id: string | null) => {
    if (!id) return
    const query = course ? `?courseId=${course.id}` : ""
    router.push(`/videos/${id}${query}`)
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="aspect-video w-full animate-pulse rounded-lg bg-muted" />
        <div className="h-6 w-1/2 animate-pulse rounded bg-muted" />
      </div>
    )
  }

  if (error || !video) {
    return (
      <div className="space-y-4">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ?? "Видео не найдено."}
        </p>
        <Button variant="outline" onClick={() => router.push("/courses")}>
          К списку курсов
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        {course ? (
          <Link
            href={`/courses/${course.id}`}
            className="text-xs text-muted-foreground hover:underline"
          >
            ← {course.title}
          </Link>
        ) : (
          <Link
            href="/courses"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Курсы
          </Link>
        )}
      </div>

      {playbackUrl ? (
        <PlyrPlayer
          src={playbackUrl}
          poster={video.thumbnailUrl}
          title={video.title}
          autoPlay
          onProgress={({ position, duration, completed }) => {
            // Best-effort: web viewing should count toward coach-side
            // progress stats, but a failed sync must never break playback.
            void saveVideoProgress({
              videoId,
              position: Math.floor(position),
              duration: duration ? Math.floor(duration) : undefined,
              completed,
            }).catch(() => undefined)
          }}
        />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-border bg-muted text-sm text-muted-foreground">
          {playbackError ?? "Видео ещё не готово к просмотру."}
        </div>
      )}

      <div className="space-y-2">
        <h1 className="text-xl font-semibold md:text-2xl">{video.title}</h1>
        {course && currentIndex >= 0 && (
          <p className="text-xs text-muted-foreground">
            Урок {currentIndex + 1} из {course.videos.length}
          </p>
        )}
        {video.description && (
          <p className="whitespace-pre-line text-sm text-muted-foreground">
            {video.description}
          </p>
        )}
      </div>

      {course && (prevVideoId || nextVideoId) && (
        <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
          <Button
            variant="outline"
            onClick={() => navigateTo(prevVideoId)}
            disabled={!prevVideoId}
          >
            ← Предыдущее
          </Button>
          <Button
            onClick={() => navigateTo(nextVideoId)}
            disabled={!nextVideoId}
          >
            Следующее →
          </Button>
        </div>
      )}
    </div>
  )
}
