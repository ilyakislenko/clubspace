"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  agree,
  cap,
  fromFirstSession,
  type ClubVocabulary,
} from "@clubspace/ui-kit/brand"
import { Button } from "@clubspace/ui-kit/ui"

import {
  listAwaitingPayment,
  listRenewalCandidates,
  type AwaitingPayment,
  type AwaitingPaymentResult,
  type RenewalCandidate,
  type RenewalCandidateList,
} from "../../../../../shared/api/subscriptions"
import {
  EMPTY_ANALYTICS_FILTER,
  analyticsScope,
  personName,
} from "../../../../../shared/lib/analytics"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { formatPhone } from "../../../../../shared/lib/phone"
import { pluralRu } from "../../../../../shared/lib/plural-ru"
import { useThrottledCallback } from "../../../../../shared/lib/throttle"
import { useVocabulary } from "../../../../../shared/lib/vocabulary"
import { useWorkspaceRealtime } from "../../../../../shared/realtime/useWorkspaceRealtime"
import { DirectionScopeChips } from "../../../../../features/directions/DirectionScopePicker"
import { formatAmount } from "../../../../../features/subscriptions/subscription-display"
import { GuardianContacts } from "../../../../../features/users/GuardianContacts"
import { AnalyticsFilters } from "../analytics/analytics-toolbar"

const PER_PAGE = 50
const AWAITING_PER_PAGE = 20
// The server's page cap: a refresh reloads everything already shown.
const MAX_PER_PAGE = 200
// Abonement changes arrive live; the list re-reads at most this often.
const REFRESH_MS = 30_000

// A class pack counts the club's own classes («тренировки» / «занятия»).
const reasonLabel = (
  reason: RenewalCandidate["reason"],
  { session }: ClubVocabulary,
): string =>
  reason === "out_of_classes"
    ? `${cap(session.nomPl)} закончились`
    : reason === "low_classes"
      ? `${agree(session, "Осталась", "Осталось")} 1 ${session.nom}`
      : "Срок заканчивается"

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })

// access_expiring also covers a term that just ended — say so.
const endedAt = (c: RenewalCandidate): string | null => {
  if (c.reason !== "access_expiring") return null
  const end = c.endDate ?? c.accessUntil
  return end != null && new Date(end).getTime() < Date.now() ? end : null
}

const reasonText = (c: RenewalCandidate, vocabulary: ClubVocabulary): string => {
  const ended = endedAt(c)
  return ended ? `Закончился ${fmtDate(ended)}` : reasonLabel(c.reason, vocabulary)
}

const reasonChip = (c: RenewalCandidate): string =>
  c.reason === "out_of_classes" || endedAt(c)
    ? "bg-red-50 text-red-700 ring-red-600/20"
    : "bg-amber-50 text-amber-700 ring-amber-600/20"

const abonementText = (c: RenewalCandidate): string | null =>
  c.classesTotal != null
    ? `осталось ${c.classesRemaining ?? 0} из ${c.classesTotal}`
    : c.endDate && !endedAt(c)
      ? `до ${fmtDate(c.endDate)}`
      : null

// Rows already shown are not repeated when the pages shift between requests.
const appendNew = <T,>(shown: T[], next: T[], key: (r: T) => string): T[] => {
  const seen = new Set(shown.map(key))
  return [...shown, ...next.filter((r) => !seen.has(key(r)))]
}

// «Продлить»: students due for renewal (the server's one rule — the dashboard
// tile counts the same people) and the abonements still waiting for payment.
// Both open the member card, where an abonement is assigned or marked paid.
export function RenewList({ workspaceId }: { workspaceId: string }) {
  const vocabulary = useVocabulary()
  const [filter, setFilter] = useState(EMPTY_ANALYTICS_FILTER)
  const [list, setList] = useState<RenewalCandidateList | null>(null)
  const [rows, setRows] = useState<RenewalCandidate[]>([])
  const [awaiting, setAwaiting] = useState<AwaitingPaymentResult | null>(null)
  const [awaitingRows, setAwaitingRows] = useState<AwaitingPayment[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Rows on screen, so a refresh doesn't fold «Показать ещё» back.
  const shown = useRef({ rows: 0, awaiting: 0 })

  const load = useCallback(async () => {
    const scope = analyticsScope(filter)
    const fit = (n: number, base: number) =>
      Math.min(MAX_PER_PAGE, Math.max(base, n))
    try {
      const [renewals, unpaid] = await Promise.all([
        listRenewalCandidates({
          workspaceId,
          ...scope,
          perPage: fit(shown.current.rows, PER_PAGE),
        }),
        listAwaitingPayment({
          workspaceId,
          ...scope,
          perPage: fit(shown.current.awaiting, AWAITING_PER_PAGE),
        }),
      ])
      setList(renewals)
      setRows(renewals.data)
      setAwaiting(unpaid)
      setAwaitingRows(unpaid.data)
      shown.current = { rows: renewals.data.length, awaiting: unpaid.data.length }
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить список."))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, filter])

  useEffect(() => {
    shown.current = { rows: 0, awaiting: 0 }
    setLoading(true)
    void load()
  }, [load])

  const refresh = useThrottledCallback(() => void load(), REFRESH_MS)
  useWorkspaceRealtime(workspaceId, ["members", "subscription"], refresh)

  const more = async (which: "rows" | "awaiting") => {
    if (loadingMore) return
    setLoadingMore(true)
    const scope = analyticsScope(filter)
    try {
      if (which === "rows") {
        const res = await listRenewalCandidates({
          workspaceId,
          ...scope,
          curPage: Math.floor(rows.length / PER_PAGE) + 1,
          perPage: PER_PAGE,
        })
        const next = appendNew(rows, res.data, (r) => r.userId)
        setList(res)
        setRows(next)
        shown.current.rows = next.length
      } else {
        const res = await listAwaitingPayment({
          workspaceId,
          ...scope,
          curPage: Math.floor(awaitingRows.length / AWAITING_PER_PAGE) + 1,
          perPage: AWAITING_PER_PAGE,
        })
        const next = appendNew(awaitingRows, res.data, (r) => r.subscriptionId)
        setAwaiting(res)
        setAwaitingRows(next)
        shown.current.awaiting = next.length
      }
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить список."))
    } finally {
      setLoadingMore(false)
    }
  }

  const total = list?.total ?? 0

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Продлить</h1>
        <p className="text-sm text-muted-foreground">
          У этих учеников заканчиваются {vocabulary.session.nomPl} или срок абонемента. Новый
          абонемент назначается и оплата отмечается в карточке ученика.
        </p>
        {list && (
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{total}</span>{" "}
            {pluralRu(total, "ученику", "ученикам", "ученикам")} пора продлить
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

      {!loading && awaiting && awaiting.total > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium">
            Ожидают оплаты{" "}
            <span className="text-muted-foreground">
              · {awaiting.members}{" "}
              {pluralRu(awaiting.members, "ученик", "ученика", "учеников")}
            </span>
          </h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {awaitingRows.map((a) => (
              <li key={a.subscriptionId}>
                <Link
                  href={`/workspace/${workspaceId}/users/${a.userId}`}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 transition hover:bg-muted"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">
                      {a.memberName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {a.planName} ·{" "}
                      {a.startDate
                        ? `с ${fmtDate(a.startDate)}`
                        : `начнётся ${fromFirstSession(vocabulary)}`}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums">
                    {formatAmount(a.amount, a.currency)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {awaitingRows.length < awaiting.total && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={loadingMore}
              onClick={() => void more("awaiting")}
            >
              Показать ещё
            </Button>
          )}
        </section>
      )}

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
          Сейчас продлевать никому не нужно.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Ученик</th>
                <th className="p-3">Причина</th>
                <th className="p-3">Абонемент</th>
                <th className="p-3">Телефон</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => {
                const balance = abonementText(c)
                return (
                  <tr key={c.userId} className="align-top">
                    <td className="p-3">
                      <Link
                        href={`/workspace/${workspaceId}/users/${c.userId}`}
                        className="font-medium hover:underline"
                      >
                        {personName(c)}
                      </Link>
                    </td>
                    <td className="p-3">
                      <span
                        className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${reasonChip(c)}`}
                      >
                        {reasonText(c, vocabulary)}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                        {c.planName && (
                          <span className="text-sm text-foreground">
                            {c.planName}
                          </span>
                        )}
                        <DirectionScopeChips directions={c.directions} />
                        {balance && <span>{balance}</span>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap p-3">
                      {c.phone ? (
                        <a
                          href={`tel:${c.phone}`}
                          className="text-primary hover:underline"
                        >
                          {formatPhone(c.phone)}
                        </a>
                      ) : c.guardians.length === 0 ? (
                        <span className="italic text-muted-foreground">
                          не указан
                        </span>
                      ) : null}
                      <GuardianContacts
                        guardians={c.guardians}
                        className="mt-1 whitespace-normal text-xs text-muted-foreground"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length < total && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={() => void more("rows")}
          >
            {loadingMore ? "Загружаем..." : "Показать ещё"}
          </Button>
        </div>
      )}
    </div>
  )
}
