"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"

import { listCourses, type CourseSummary } from "../../../shared/api/courses"

export default function CoursesPage() {
  const [courses, setCourses] = useState<CourseSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), 250)
    return () => clearTimeout(handle)
  }, [query])

  useEffect(() => {
    let cancelled = false
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
    void (async () => {
      try {
        const response = await listCourses({
          workspaceId,
          perPage: 100,
          q: debouncedQuery || undefined,
        })
        if (cancelled) return
        setCourses(response.data)
        setError(null)
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
  }, [debouncedQuery])

  const isEmpty = useMemo(
    () => !loading && !error && courses.length === 0,
    [loading, error, courses.length],
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Курсы</h1>
          <p className="text-sm text-muted-foreground">
            Выбирайте курс и тренируйтесь.
          </p>
        </div>
        <div className="w-full sm:w-72">
          <label htmlFor="course-search" className="sr-only">
            Поиск курса
          </label>
          <input
            id="course-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по курсам..."
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
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

      {isEmpty && (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {debouncedQuery
            ? `Ничего не найдено по запросу «${debouncedQuery}».`
            : "Курсов пока нет. Загляните позже."}
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
                <div className="flex items-baseline justify-between gap-2">
                  <div className="font-medium leading-tight">
                    {course.title}
                  </div>
                  {course.level && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                      {course.level}
                    </span>
                  )}
                </div>
                {course.description && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {course.description}
                  </p>
                )}
                {course.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {course.tags.slice(0, 4).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
