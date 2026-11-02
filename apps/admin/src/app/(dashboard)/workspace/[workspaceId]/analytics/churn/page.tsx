"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { Button, Input } from "@clubspace/ui-kit/ui"

import { GuardianContacts } from "../../../../../../features/users/GuardianContacts"
import {
  listChurnRisk,
  type ChurnRiskList,
  type ChurnRiskMember,
} from "../../../../../../shared/api/analytics"
import { logAtRiskContact } from "../../../../../../shared/api/retention"
import {
  CHURN_LEVEL_CHIP,
  CHURN_LEVEL_LABEL,
  EMPTY_ANALYTICS_FILTER,
  analyticsScope,
  personName,
  splitChurnList,
} from "../../../../../../shared/lib/analytics"
import { errorMessage } from "../../../../../../shared/lib/error-message"
import { groupOptionLabel } from "../../../../../../shared/lib/group-label"
import { formatRelativeDays } from "../../../../../../shared/lib/member-activity"
import { formatPhone } from "../../../../../../shared/lib/phone"
import {
  AnalyticsCard,
  AnalyticsError,
  AnalyticsFilters,
  AnalyticsFreshness,
  AnalyticsSkeleton,
  formatMoney,
} from "../analytics-toolbar"

export default function ChurnPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId

  const [filter, setFilter] = useState(EMPTY_ANALYTICS_FILTER)
  const [list, setList] = useState<ChurnRiskList | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [showContacted, setShowContacted] = useState(false)

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      setList(await listChurnRisk({ workspaceId, ...analyticsScope(filter) }))
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить список."))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, filter])

  useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  const startEditing = (userId: string) => {
    setEditingId(userId)
    setNote("")
    setError(null)
  }

  const save = async (m: ChurnRiskMember) => {
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
  const { toCall, contacted } = splitChurnList(list?.data ?? [])

  const renderMember = (m: ChurnRiskMember) => (
    <li key={m.userId} className="space-y-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/workspace/${workspaceId}/users/${m.userId}`}
              className="font-medium hover:underline"
            >
              {personName(m)}
            </Link>
            <span
              className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${CHURN_LEVEL_CHIP[m.level]}`}
              title={CHURN_LEVEL_LABEL[m.level]}
            >
              {m.score} · {CHURN_LEVEL_LABEL[m.level]}
            </span>
            {m.monthlySpend > 0 && (
              <span className="text-sm text-muted-foreground">
                ~{formatMoney(m.monthlySpend, m.currency)}/мес
              </span>
            )}
          </div>
          {m.groups.length > 0 && (
            <div className="text-xs text-muted-foreground">
              {m.groups
                .map((g) => groupOptionLabel(g))
                .join(", ")}
            </div>
          )}
        </div>
        <div className="text-sm">
          {m.phone ? (
            <a href={`tel:${m.phone}`} className="text-primary hover:underline">
              {formatPhone(m.phone)}
            </a>
          ) : m.guardians.length === 0 ? (
            <span className="italic text-muted-foreground">
              телефон не указан
            </span>
          ) : null}
          <GuardianContacts
            guardians={m.guardians}
            className="mt-1 text-xs text-muted-foreground"
          />
        </div>
      </div>

      {m.reasons.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {m.reasons.slice(0, 3).map((r) => (
            <li key={r.code}>{r.text}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>
          Был последний раз:{" "}
          {m.lastVisitAt ? formatRelativeDays(m.lastVisitAt) : "ни разу"}
        </span>
        <span>
          Последний контакт:{" "}
          {m.lastContact
            ? `${formatRelativeDays(m.lastContact.at)} — ${m.lastContact.byName}${
                m.lastContact.note ? ` «${m.lastContact.note}»` : ""
              }`
            : "—"}
        </span>
      </div>

      {editingId === m.userId ? (
        <div className="flex max-w-xl items-center gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Заметка (необязательно)"
            maxLength={500}
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
      ) : m.canContact ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => startEditing(m.userId)}
        >
          Связались
        </Button>
      ) : null}
    </li>
  )

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Кому позвонить сегодня</h1>
        <p className="text-sm text-muted-foreground">
          Ученики, которые могут уйти, — по убыванию риска. Звонок тренера
          заметно продлевает членство.
        </p>
        <AnalyticsFreshness
          workspaceId={workspaceId}
          computedAt={list?.computedAt}
          onRefreshed={load}
        />
      </div>

      <AnalyticsFilters
        workspaceId={workspaceId}
        value={filter}
        onChange={setFilter}
      />

      <AnalyticsError message={error} />

      {summary && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <AnalyticsCard label="Под риском" value={summary.total} />
          <AnalyticsCard
            label="Высокий риск"
            value={summary.high}
            tone={summary.high > 0 ? "danger" : "default"}
          />
          <AnalyticsCard
            label="На кону"
            value={formatMoney(summary.moneyAtStake, summary.currency)}
            subtitle="в месяц у учеников под риском"
            tone={summary.moneyAtStake > 0 ? "warn" : "default"}
          />
          <AnalyticsCard
            label="Связались"
            value={summary.contactedRecently}
            subtitle="недавно"
          />
        </div>
      )}

      {loading ? (
        <AnalyticsSkeleton />
      ) : toCall.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {list?.computedAt === null
            ? "Список появится после первого пересчёта."
            : "Сейчас звонить никому не нужно."}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {toCall.map(renderMember)}
        </ul>
      )}

      {contacted.length > 0 && (
        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setShowContacted((v) => !v)}
            className="text-sm font-medium hover:underline"
            aria-expanded={showContacted}
          >
            {showContacted ? "▾" : "▸"} Связались ({contacted.length})
          </button>
          {showContacted && (
            <ul className="divide-y divide-border rounded-lg border border-border opacity-80">
              {contacted.map(renderMember)}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
