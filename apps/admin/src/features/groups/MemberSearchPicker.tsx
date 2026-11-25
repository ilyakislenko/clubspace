"use client"

import { useEffect, useState } from "react"

import { Input } from "@clubspace/ui-kit/ui"

import { listWorkspaceMembers, type WorkspaceMember } from "../../shared/api/members"
import { formatMemberLabel } from "./helpers"

const PAGE = 20

type Props = {
  workspaceId: string
  // Already chosen (or not allowed): hidden from the results.
  excludeIds: ReadonlySet<string>
  // Who may be picked at all (e.g. students only); everyone when omitted.
  accept?: (member: WorkspaceMember) => boolean
  onPick: (member: WorkspaceMember) => void
  disabled?: boolean
  autoFocus?: boolean
  placeholder?: string
}

/**
 * Search box over the club's members: a server-side `q` search (name, e-mail,
 * phone), so a club of any size is searchable without downloading the roster.
 * Results show while the box has focus or a query.
 */
export function MemberSearchPicker({
  workspaceId,
  excludeIds,
  accept,
  onPick,
  disabled,
  autoFocus,
  placeholder = "Имя, e-mail или телефон",
}: Props) {
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [open, setOpen] = useState(!!autoFocus)
  const [results, setResults] = useState<WorkspaceMember[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    listWorkspaceMembers({
      workspaceId,
      q: debounced || undefined,
      sort: "name",
      perPage: PAGE,
    })
      .then((page) => {
        if (!alive) return
        setResults(page.data)
        setTotal(page.total)
      })
      .catch(() => {
        if (alive) setResults([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [workspaceId, open, debounced])

  const visible = results.filter((m) => !excludeIds.has(m.userId) && (!accept || accept(m)))

  return (
    <div
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <Input
        type="search"
        value={query}
        autoFocus={autoFocus}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false)
        }}
        placeholder={placeholder}
        aria-label="Поиск участника"
        className="h-9"
      />
      {open && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {visible.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">
              {loading ? "Ищем…" : debounced ? "Никого не найдено" : "Начните вводить имя"}
            </li>
          ) : (
            visible.map((m) => (
              <li key={m.userId} role="option" aria-selected={false}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    onPick(m)
                    setQuery("")
                  }}
                  className="w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                >
                  {formatMemberLabel(m)}
                  {m.email && <span className="ml-1 text-xs text-muted-foreground">{m.email}</span>}
                </button>
              </li>
            ))
          )}
          {total > results.length && (
            <li className="px-2 py-1 text-xs text-muted-foreground">
              Показаны первые {results.length} — уточните поиск
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
