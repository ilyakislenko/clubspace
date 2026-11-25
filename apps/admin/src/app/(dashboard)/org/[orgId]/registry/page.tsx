"use client"

import { Search } from "lucide-react"
import { useEffect, useState } from "react"

import { Button, Input } from "@clubspace/ui-kit/ui"

import {
  listOrganizationClubs,
  listOrgLadderTemplates,
  searchOrganizationRegistry,
  type OrgLadderTemplate,
  type OrgRegistryRow,
} from "../../../../../shared/api/organizations"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { inputCls } from "../../../../../shared/lib/input-class"
import { useOrg } from "../../../../../features/org/org-context"
import { BeltDot } from "../../../../../features/org/BeltDot"
import { RegistryPersonSheet } from "../../../../../features/org/RegistryPersonSheet"
import { beltText, confirmedByText, formatDate } from "../../../../../features/org/org-view"

const PER_PAGE = 50

type Filters = { q: string; clubId: string; templateLevelId: string; awardedFrom: string; awardedTo: string }
const NO_FILTERS: Filters = { q: "", clubId: "", templateLevelId: "", awardedFrom: "", awardedTo: "" }

// «Реестр поясов»: belts confirmed by the member clubs, only of people who
// consented to the federation (design §3.1). Search first; row tap opens the
// person's history.
export default function OrgRegistryPage() {
  const { org } = useOrg()
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  // The search box applies after a pause in typing.
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<OrgRegistryRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clubs, setClubs] = useState<{ id: string; name: string }[]>([])
  const [templates, setTemplates] = useState<OrgLadderTemplate[]>([])
  const [person, setPerson] = useState<{ key: string; name: string } | null>(null)

  useEffect(() => {
    listOrganizationClubs({ organizationId: org.id })
      .then((res) =>
        setClubs(
          res.data
            .filter((c) => c.status === "ACTIVE")
            .map((c) => ({ id: c.club.workspaceId, name: c.club.name })),
        ),
      )
      .catch(() => setClubs([]))
    listOrgLadderTemplates({ organizationId: org.id })
      .then((res) => setTemplates(res.data))
      .catch(() => setTemplates([]))
  }, [org.id])

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((f) => (f.q === query.trim() ? f : { ...f, q: query.trim() }))
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    searchOrganizationRegistry({
      organizationId: org.id,
      q: filters.q || undefined,
      clubId: filters.clubId || undefined,
      templateLevelId: filters.templateLevelId || undefined,
      awardedFrom: filters.awardedFrom || undefined,
      awardedTo: filters.awardedTo || undefined,
      curPage: page,
      perPage: PER_PAGE,
    })
      .then((res) => {
        if (cancelled) return
        setRows(res.data)
        setTotal(res.total)
        setError(null)
      })
      .catch((e) => !cancelled && setError(errorMessage(e, "Не удалось загрузить реестр")))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [org.id, filters, page])

  const setFilter = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }))
    setPage(1)
  }

  const levelOptions = templates.flatMap((t) =>
    t.levels.map((lv) => ({ id: lv.id, label: templates.length > 1 ? `${t.name} · ${lv.name}` : lv.name })),
  )
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const filtered = filters.clubId || filters.templateLevelId || filters.awardedFrom || filters.awardedTo || filters.q

  return (
    <div className="max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">Реестр поясов</h1>

      <div className="space-y-3">
        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Имя или фамилия"
            aria-label="Поиск по имени"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {clubs.length > 1 && (
            <select
              className={inputCls}
              value={filters.clubId}
              onChange={(e) => setFilter({ clubId: e.target.value })}
              aria-label="Клуб"
            >
              <option value="">Все клубы</option>
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {levelOptions.length > 0 && (
            <select
              className={inputCls}
              value={filters.templateLevelId}
              onChange={(e) => setFilter({ templateLevelId: e.target.value })}
              aria-label="Уровень стандарта"
            >
              <option value="">Любой уровень стандарта</option>
              {levelOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-2 text-muted-foreground">
            с
            <input
              type="date"
              className={inputCls}
              value={filters.awardedFrom}
              onChange={(e) => setFilter({ awardedFrom: e.target.value })}
              aria-label="Дата присвоения с"
            />
          </label>
          <label className="flex items-center gap-2 text-muted-foreground">
            по
            <input
              type="date"
              className={inputCls}
              value={filters.awardedTo}
              onChange={(e) => setFilter({ awardedTo: e.target.value })}
              aria-label="Дата присвоения по"
            />
          </label>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading && rows.length === 0 ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg border border-border bg-muted" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {filtered ? "Никого не нашли." : "В реестре пока никого нет."}
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {rows.map((row) => (
            <li key={`${row.personKey}-${row.ladderName}`}>
              <button
                type="button"
                className="grid w-full grid-cols-1 gap-1 px-4 py-3 text-left text-sm hover:bg-muted/50 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4"
                onClick={() => setPerson({ key: row.personKey, name: row.personName })}
              >
                <span className="truncate font-medium">{row.personName}</span>
                <span className="flex min-w-0 items-center gap-2">
                  <BeltDot color={row.levelColor} />
                  <span className="truncate">{beltText(row)}</span>
                </span>
                <span className="truncate text-muted-foreground">{confirmedByText(row.clubName)}</span>
                <span className="tabular-nums text-muted-foreground">{formatDate(row.awardedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>Показаны ученики, давшие согласие федерации</span>
        {totalPages > 1 && (
          <span className="flex items-center gap-2">
            <span>
              Страница {page} из {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
              ← Назад
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Вперёд →
            </Button>
          </span>
        )}
      </div>

      <RegistryPersonSheet
        organizationId={org.id}
        personKey={person?.key ?? null}
        personName={person?.name ?? ""}
        onClose={() => setPerson(null)}
      />
    </div>
  )
}
