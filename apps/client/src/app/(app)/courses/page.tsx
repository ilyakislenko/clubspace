"use client"

import Link from "next/link"
import { useEffect, useState } from "react"

import { listCourses, type CourseSummary } from "../../../shared/api/courses"

export default function CoursesPage() {
  const [courses, setCourses] = useState<CourseSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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
        const response = await listCourses({ workspaceId, perPage: 100 })
        if (cancelled) return
        setCourses(response.data)
      } catch (err) {
        if (cancelled) return
        setError(
          err instanceof Error ? err.message : "Не удалось загрузить курсы.",
        )
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Курсы</h1>
        <p className="text-sm text-muted-foreground">
          Выбирайте курс и тренируйтесь.
        </p>
      </div>

      {loading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="h-44 animate-pulse rounded-lg border border-border bg-muted"
            />
          ))}
        </div>
      )}

      {error && !loading && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {!loading && !error && courses.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Курсов пока нет. Загляните позже.
        </p>
      )}

      {!loading && !error && courses.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((course) => (
            <Link
              key={course.id}
              href={`/courses/${course.id}`}
              className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition hover:border-primary"
            >
              <div className="aspect-video w-full overflow-hidden bg-muted">
                {course.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={course.thumbnailUrl}
                    alt={course.title}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
                    Нет превью
                  </div>
                )}
              </div>
              <div className="space-y-1 p-4">
                <div className="font-medium leading-tight">{course.title}</div>
                {course.description && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {course.description}
                  </p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
