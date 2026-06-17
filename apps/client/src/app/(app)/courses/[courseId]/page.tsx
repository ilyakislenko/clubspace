"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { Button } from "@bjj-academy/ui-kit/ui"
import { getCourse, type CourseDetail } from "../../../../shared/api/courses"
import { errorMessage } from "../../../../shared/lib/error-message"

const formatDuration = (seconds?: number | null) => {
  if (!seconds || seconds <= 0) return null
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${minutes}:${secs.toString().padStart(2, "0")}`
}

export default function CoursePage() {
  const params = useParams<{ courseId: string }>()
  const courseId = params?.courseId
  const router = useRouter()

  const [course, setCourse] = useState<CourseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!courseId) return
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

      try {
        const data = await getCourse({ workspaceId, courseId })
        if (cancelled) return
        setCourse(data)
      } catch (err) {
        if (cancelled) return
        setError(
          errorMessage(err, "Не удалось загрузить курс."),
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [courseId])

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, idx) => (
            <div
              key={idx}
              className="h-20 animate-pulse rounded-lg border border-border bg-muted"
            />
          ))}
        </div>
      </div>
    )
  }

  if (error || !course) {
    return (
      <div className="space-y-4">
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error ?? "Курс не найден."}
        </p>
        <Button variant="outline" onClick={() => router.push("/courses")}>
          К списку курсов
        </Button>
      </div>
    )
  }

  const readyVideos = course.videos.filter((video) => video.status === "ready")
  const firstReadyId = readyVideos[0]?.id ?? null

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/courses"
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Курсы
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{course.title}</h1>
          {course.description && (
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              {course.description}
            </p>
          )}
        </div>
        {firstReadyId && (
          <Button
            onClick={() =>
              router.push(`/videos/${firstReadyId}?courseId=${course.id}`)
            }
          >
            Смотреть курс
          </Button>
        )}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">
          Уроки {course.videos.length > 0 && `(${course.videos.length})`}
        </div>
        {course.videos.length === 0 && (
          <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            В этом курсе пока нет видео.
          </p>
        )}
        <ol className="space-y-2">
          {course.videos.map((video, index) => {
            const duration = formatDuration(video.duration)
            const isReady = video.status === "ready"
            return (
              <li
                key={video.id}
                className={`overflow-hidden rounded-lg border ${
                  isReady ? "border-border" : "border-border/60 bg-muted/30"
                }`}
              >
                <Link
                  href={
                    isReady
                      ? `/videos/${video.id}?courseId=${course.id}`
                      : `/courses/${course.id}`
                  }
                  className={`flex items-center gap-4 p-3 transition ${
                    isReady ? "hover:bg-muted" : "cursor-not-allowed opacity-70"
                  }`}
                  onClick={(event) => {
                    if (!isReady) event.preventDefault()
                  }}
                >
                  <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                    {video.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={video.thumbnailUrl}
                        alt={video.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        №{index + 1}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {video.title}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>Урок {index + 1}</span>
                      {duration && <span>· {duration}</span>}
                      {!isReady && <span>· В обработке</span>}
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ol>
      </div>
    </div>
  )
}
