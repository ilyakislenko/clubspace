"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { Fragment, useCallback, useEffect, useRef, useState } from "react"

import { Button, Input } from "@clubspace/ui-kit/ui"

import {
  listAtRiskMembers,
  logAtRiskContact,
  type AtRiskList,
  type AtRiskMember,
  type AtRiskReason,
} from "../../../../../shared/api/retention"
import {
  EMPTY_ANALYTICS_FILTER,
  analyticsScope,
  personName,
} from "../../../../../shared/lib/analytics"
import {
  AT_RISK_CHIP,
  AT_RISK_LABEL,
  AT_RISK_LEVEL_LABEL,
  AT_RISK_LEVEL_TEXT,
  AT_RISK_REFRESH_MS,
} from "../../../../../shared/lib/at-risk"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { groupOptionLabel } from "../../../../../shared/lib/group-label"
import { formatRelativeDays } from "../../../../../shared/lib/member-activity"
import { formatPhone } from "../../../../../shared/lib/phone"
import { pluralRu } from "../../../../../shared/lib/plural-ru"
import { useThrottledCallback } from "../../../../../shared/lib/throttle"
import { useVocabulary } from "../../../../../shared/lib/vocabulary"
import { useWorkspaceRealtime } from "../../../../../shared/realtime/useWorkspaceRealtime"
import { GuardianContacts } from "../../../../../features/users/GuardianContacts"
import { AnalyticsFilters, formatMoney } from "../analytics/analytics-toolbar"

const PER_PAGE = 50
// The server's page cap: a refresh reloads everything already shown.
const MAX_PER_PAGE = 200

const CHIPS: { key: AtRiskReason | null; label: string }[] = [
  { key: null, label: "Все" },
  { key: "lapsed", label: "Абонемент кончился" },
  { key: "newcomer", label: "Новички" },
  { key: "absent", label: "Давно не были" },
  { key: "declining", label: "Реже, чем раньше" },
]

// «Кому позвонить»: the one call list (the dashboard tile and the apps show
// the same count). Who and why come from the live rules, the risk score and
// the money at stake from the hourly snapshot; the server scopes it to the
// caller's groups and hides money below club admin.
export default function CallListPage() {
  const vocabulary = useVocabulary()
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [filter, setFilter] = useState(EMPTY_ANALYTICS_FILTER)
  const [reason, setReason] = useState<AtRiskReason | null>(null)
  const [snoozed, setSnoozed] = useState(false)
  const [list, setList] = useState<AtRiskList | null>(null)
  const [rows, setRows] = useState<AtRiskMember[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  // Rows already on screen, so a refresh doesn't fold «Показать ещё» back.
  const shown = useRef(0)

  const query = useCallback(
    (page: number, perPage: number) =>
      listAtRiskMembers({
        workspaceId: workspaceId!,
        ...analyticsScope(filter),
        reason: snoozed ? undefined : (reason ?? undefined),
        snoozed,
        page,
        perPage,
      }),
    [workspaceId, filter, reason, snoozed],
  )

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      const perPage = Math.min(MAX_PER_PAGE, Math.max(PER_PAGE, shown.current))
      const res = await query(1, perPage)
      setList(res)
      setRows(res.data)
      shown.current = res.data.length
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить список."))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, query])

  useEffect(() => {
    shown.current = 0
    setLoading(true)
    void load()
  }, [load])

  const loadMore = async () => {
    if (!list || loadingMore) return
    setLoadingMore(true)
    try {
      const page = Math.floor(rows.length / PER_PAGE) + 1
      const res = await query(page, PER_PAGE)
      // Rows a refresh already holds are not repeated.
      const seen = new Set(rows.map((r) => r.userId))
      const next = [...rows, ...res.data.filter((r) => !seen.has(r.userId))]
      setList(res)
      setRows(next)
      shown.current = next.length
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить список."))
    } finally {
      setLoadingMore(false)
    }
  }

  const refresh = useThrottledCallback(() => void load(), AT_RISK_REFRESH_MS)
  useWorkspaceRealtime(
    workspaceId,
    ["members", "attendance", "subscription"],
    refresh,
  )

  const startEditing = (userId: string) => {
    setEditingId(userId)
    setNote("")
    setError(null)
  }

  const save = async (m: AtRiskMember) => {
    if (!workspaceId || saving) return
    setSaving(true)
    setError(null)
    try {
      await logAtRiskContact({
        workspaceId,
        userId: m.userId,
        note: note.trim() || null,
      })
      setEditingId(null)
      await load()
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить отметку."))
    } finally {
      setSaving(false)
    }
  }

  const summary = list?.summary
  const count = (key: AtRiskReason | null) =>
    summary ? (key === null ? summary.total : summary[key]) : 0
  const hasMore = !!list && rows.length < list.total

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Кому позвонить</h1>
        <p className="text-sm text-muted-foreground">
          Ученики, которые могут уйти. Один звонок {vocabulary.coach.gen}{" "}
          заметно продлевает членство.
        </p>
        {summary && (
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{summary.total}</span>{" "}
            {pluralRu(summary.total, "ученик", "ученика", "учеников")} стоит
            позвонить
            {summary.high > 0 && <> · с высоким риском — {summary.high}</>}
            {summary.moneyAtStake !== null && summary.moneyAtStake > 0 && (
              <>
                {" "}
                · на кону ~{formatMoney(summary.moneyAtStake, summary.currency)}{" "}
                в месяц
              </>
            )}
          </p>
        )}
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <AnalyticsFilters
        workspaceId={workspaceId}
        value={filter}
        onChange={setFilter}
      />

      <div className="flex flex-wrap items-center gap-2">
        {!snoozed &&
          CHIPS.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => setReason(c.key)}
              className={`rounded-full px-3 py-1 text-sm ${
                reason === c.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground hover:bg-muted/70"
              }`}
            >
              {c.label} · {count(c.key)}
            </button>
          ))}
        {(snoozed || (summary?.snoozed ?? 0) > 0) && (
          <label className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={snoozed}
              onChange={(e) => setSnoozed(e.target.checked)}
            />
            Связались недавно ({summary?.snoozed ?? 0})
          </label>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg border border-border bg-muted"
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {snoozed
            ? "За две недели ни с кем не связывались."
            : "Сейчас звонить никому не нужно."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Участник</th>
                <th className="p-3">Причина</th>
                <th className="p-3">Что видно</th>
                <th className="p-3">Риск</th>
                <th className="p-3">Группы</th>
                <th className="p-3">Телефон</th>
                <th className="p-3">Последний контакт</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((m) => (
                <Fragment key={m.userId}>
                  <tr className="align-top">
                    <td className="p-3">
                      <Link
                        href={`/workspace/${workspaceId}/users/${m.userId}`}
                        className="font-medium hover:underline"
                      >
                        {personName(m)}
                      </Link>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${AT_RISK_CHIP[m.reason]}`}
                      >
                        {AT_RISK_LABEL[m.reason]}
                      </span>
                    </td>
                    <td className="min-w-64 p-3">{m.factsText}</td>
                    <td className="whitespace-nowrap p-3 text-xs">
                      {m.score !== null && m.level !== null ? (
                        <span className={`tabular-nums ${AT_RISK_LEVEL_TEXT[m.level]}`}>
                          {m.score} · {AT_RISK_LEVEL_LABEL[m.level]}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {/* null: money is the club admins' to see. */}
                      {m.monthlySpend !== null && m.monthlySpend > 0 && (
                        <div className="text-muted-foreground">
                          ~{formatMoney(m.monthlySpend, m.currency)}/мес
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {m.groups.map((g) => groupOptionLabel(g)).join(", ")}
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {m.phone ? (
                        <a
                          href={`tel:${m.phone}`}
                          className="text-primary hover:underline"
                        >
                          {formatPhone(m.phone)}
                        </a>
                      ) : m.guardians.length === 0 ? (
                        <span className="italic text-muted-foreground">
                          не указан
                        </span>
                      ) : null}
                      <GuardianContacts
                        guardians={m.guardians}
                        className="mt-1 whitespace-normal text-xs text-muted-foreground"
                      />
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {m.lastContact
                        ? `${formatRelativeDays(m.lastContact.at)} — ${m.lastContact.byName}${
                            m.lastContact.note ? ` «${m.lastContact.note}»` : ""
                          }`
                        : "—"}
                    </td>
                    <td className="p-3">
                      {!m.snoozed && editingId !== m.userId ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => startEditing(m.userId)}
                        >
                          Связались
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                  {editingId === m.userId && (
                    // A row of its own: inside the last cell the note pushed the
                    // table past the right edge on a 1440 screen.
                    <tr>
                      <td colSpan={8} className="px-3 pb-3 pt-0">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <Input
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Заметка (необязательно)"
                            maxLength={500}
                            className="max-w-md"
                            autoFocus
                          />
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void save(m)}
                            disabled={saving}
                          >
                            {saving ? "Сохраняю…" : "Сохранить"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => setEditingId(null)}
                            disabled={saving}
                          >
                            Отмена
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMore || loading}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Загружаем..." : "Показать ещё"}
          </Button>
        </div>
      )}
    </div>
  )
}
