"use client"

import { MoreHorizontal } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
} from "@clubspace/ui-kit/ui"

import {
  addGroupMember,
  listGroupMembers,
  removeGroupMember,
  type GroupRosterMember,
  type GroupRosterPage,
} from "../../shared/api/groups"
import { personName } from "../../shared/lib/analytics"
import { AT_RISK_CHIP, AT_RISK_LABEL } from "../../shared/lib/at-risk"
import { errorMessage } from "../../shared/lib/error-message"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { classesLabel, periodLabel } from "../subscriptions/subscription-display"
import { MemberSearchPicker } from "./MemberSearchPicker"

const PER_PAGE = 25

type Props = {
  workspaceId: string
  groupId: string
  // Runs the group: adds / removes students, sees abonements and risk.
  canEdit: boolean
  // The tariff page is the club admins'; others see the plan name only.
  linkPlans: boolean
  // The roster changed (the card's student count follows).
  onChanged: () => void
}

/** A group's students: server-side search and paging, add and remove. */
export function GroupRoster({ workspaceId, groupId, canEdit, linkPlans, onChanged }: Props) {
  const [query, setQuery] = useState("")
  const [q, setQ] = useState("")
  const [curPage, setCurPage] = useState(1)
  const [page, setPage] = useState<GroupRosterPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [recentIds, setRecentIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(query.trim())
      setCurPage(1)
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  const load = useCallback(async () => {
    try {
      setPage(
        await listGroupMembers({
          workspaceId,
          groupId,
          q: q || undefined,
          curPage,
          perPage: PER_PAGE,
        }),
      )
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить учеников"))
    }
  }, [workspaceId, groupId, q, curPage])

  useEffect(() => {
    void load()
  }, [load])

  const add = async (userId: string) => {
    setBusy(true)
    setError(null)
    try {
      await addGroupMember({ workspaceId, groupId, userId })
      setRecentIds((prev) => new Set(prev).add(userId))
      await load()
      onChanged()
    } catch (err) {
      setError(errorMessage(err, "Не удалось добавить ученика"))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (m: GroupRosterMember) => {
    if (!window.confirm(`Убрать ${personName(m)} из группы? В клубе ученик останется.`)) return
    setBusy(true)
    setError(null)
    try {
      await removeGroupMember({ workspaceId, groupId, userId: m.userId })
      setRecentIds((prev) => {
        const next = new Set(prev)
        next.delete(m.userId)
        return next
      })
      // The last row of the last page gone: step back a page.
      if (page && page.data.length === 1 && curPage > 1) setCurPage(curPage - 1)
      else await load()
      onChanged()
    } catch (err) {
      setError(errorMessage(err, "Не удалось убрать ученика"))
    } finally {
      setBusy(false)
    }
  }

  const total = page?.total ?? 0
  const from = total === 0 ? 0 : (curPage - 1) * PER_PAGE + 1
  const to = Math.min(curPage * PER_PAGE, total)
  const searching = q !== ""

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Ученики</h2>
        <div className="flex items-center gap-2">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Найти в группе"
            aria-label="Найти ученика в группе"
            className="h-8 w-56"
          />
          {canEdit && !adding && (
            <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
              Добавить ученика
            </Button>
          )}
        </div>
      </div>

      {canEdit && adding && (
        <div className="flex items-start gap-2 rounded-lg border border-border p-2">
          <div className="flex-1">
            <MemberSearchPicker
              workspaceId={workspaceId}
              excludeIds={recentIds}
              onPick={(m) => void add(m.userId)}
              disabled={busy}
              autoFocus
              placeholder="Кого добавить: имя, e-mail или телефон"
            />
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Готово
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {page === null ? (
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      ) : page.data.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {searching ? `Никого не найдено по «${q}».` : "В группе пока нет учеников."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Ученик</th>
                {canEdit && <th className="px-3 py-2 font-medium">Абонемент</th>}
                {canEdit && <th className="px-3 py-2 font-medium">Риск ухода</th>}
                {canEdit && <th className="w-10 px-3 py-2" aria-label="Действия" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {page.data.map((m) => (
                <RosterRow
                  key={m.userId}
                  workspaceId={workspaceId}
                  member={m}
                  canEdit={canEdit}
                  linkPlans={linkPlans}
                  busy={busy}
                  onRemove={() => void remove(m)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PER_PAGE && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {from}–{to} из {total}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={curPage === 1}
            onClick={() => setCurPage(curPage - 1)}
          >
            Назад
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={to >= total}
            onClick={() => setCurPage(curPage + 1)}
          >
            Дальше
          </Button>
        </div>
      )}
    </section>
  )
}

function RosterRow({
  workspaceId,
  member,
  canEdit,
  linkPlans,
  busy,
  onRemove,
}: {
  workspaceId: string
  member: GroupRosterMember
  canEdit: boolean
  linkPlans: boolean
  busy: boolean
  onRemove: () => void
}) {
  const vocabulary = useVocabulary()
  return (
    <tr>
      <td className="px-3 py-2">
        <Link
          href={`/workspace/${workspaceId}/users/${member.userId}`}
          className="font-medium hover:underline"
        >
          {personName(member)}
        </Link>
      </td>
      {canEdit && (
        <td className="px-3 py-2">
          {member.subscriptions.length === 0 ? (
            <span className="text-muted-foreground">Нет действующего</span>
          ) : (
            <ul className="space-y-1">
              {member.subscriptions.map((s) => {
                const classes = classesLabel(s)
                return (
                  <li key={s.id}>
                    {linkPlans ? (
                      <Link
                        href={`/workspace/${workspaceId}/subscriptions/plans/${s.planId}`}
                        className="hover:underline"
                      >
                        {s.planName}
                      </Link>
                    ) : (
                      s.planName
                    )}
                    <span className="text-xs text-muted-foreground">
                      {" "}
                      · {periodLabel(s, vocabulary)}
                      {classes ? ` · ${classes}` : ""}
                    </span>
                    {!s.isPaid && (
                      <span className="ml-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700">
                        Ожидает оплаты
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </td>
      )}
      {canEdit && (
        <td className="px-3 py-2">
          {member.risk && (
            <span
              title={member.risk.text}
              className={`inline-block rounded px-1.5 py-0.5 text-xs ${AT_RISK_CHIP[member.risk.reason]}`}
            >
              {AT_RISK_LABEL[member.risk.reason]}
            </span>
          )}
        </td>
      )}
      {canEdit && (
        <td className="px-2 py-2 text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={`Действия: ${personName(member)}`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-destructive" onSelect={onRemove}>
                Убрать из группы
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      )}
    </tr>
  )
}
