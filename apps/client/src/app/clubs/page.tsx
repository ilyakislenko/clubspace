import type { Metadata } from "next"
import Link from "next/link"

import { ClubLogo } from "../../features/public-club/ClubProfile"
import {
  CLUB_TYPE_OPTIONS,
  clubTypeLabel,
} from "../../features/public-club/club-format"
import { searchPublicClubs } from "../../shared/api/public-clubs"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Клубы",
  description: "Найдите спортивный клуб рядом и вступите в него через ClubSpace",
}

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.trim() || undefined

// Club catalog: only clubs that opted in from «Публичная страница». A plain
// GET form, so it works without JavaScript and every search has a URL.
export default async function ClubsPage({ searchParams }: Props) {
  const sp = await searchParams
  const q = one(sp.q)
  const city = one(sp.city)
  const type = CLUB_TYPE_OPTIONS.some((o) => o.value === one(sp.type))
    ? one(sp.type)
    : undefined
  const curPage = Math.max(1, Number(one(sp.page)) || 1)

  const result = await searchPublicClubs({ q, city, type, curPage })
  const pages = Math.max(1, Math.ceil(result.total / result.perPage))

  const pageHref = (page: number) => {
    const params = new URLSearchParams()
    if (q) params.set("q", q)
    if (city) params.set("city", city)
    if (type) params.set("type", type)
    if (page > 1) params.set("page", String(page))
    const qs = params.toString()
    return `/clubs${qs ? `?${qs}` : ""}`
  }

  const field =
    "h-10 rounded-md border border-border bg-background px-3 text-sm"

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-10">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Клубы</h1>
        <p className="text-sm text-muted-foreground">
          Найдите клуб и вступите в него в приложении ClubSpace.
        </p>
      </header>

      <form method="get" className="flex flex-wrap gap-2" role="search">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Название или город"
          aria-label="Название или город"
          className={`${field} min-w-[200px] flex-1`}
        />
        <input
          name="city"
          list="club-cities"
          defaultValue={city}
          placeholder="Город"
          aria-label="Город"
          className={`${field} w-40`}
        />
        <datalist id="club-cities">
          {result.cities.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <select
          name="type"
          defaultValue={type ?? ""}
          aria-label="Вид спорта"
          className={field}
        >
          <option value="">Все виды</option>
          {CLUB_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-10 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground"
        >
          Найти
        </button>
      </form>

      {result.data.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {q || city || type
            ? "Ничего не нашлось. Попробуйте другой запрос."
            : "Клубы ещё не добавлены в каталог."}
        </p>
      ) : (
        <ul className="space-y-3">
          {result.data.map((club) => (
            <li key={club.slug}>
              <Link
                href={`/c/${club.slug}`}
                className="flex gap-4 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted"
              >
                <ClubLogo name={club.name} logoUrl={club.logoUrl} size="md" />
                <div className="min-w-0 space-y-1">
                  <div className="font-semibold">{club.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {[clubTypeLabel(club.type), club.city]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                  {club.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {club.description}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm">
          {curPage > 1 ? (
            <Link href={pageHref(curPage - 1)} className="text-primary hover:underline">
              ← Назад
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">
            {curPage} из {pages}
          </span>
          {curPage < pages ? (
            <Link href={pageHref(curPage + 1)} className="text-primary hover:underline">
              Дальше →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </main>
  )
}
