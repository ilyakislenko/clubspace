"use client"

import { useEffect, useState, type ReactNode } from "react"

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"

import { DirectionFilter } from "../../../../../features/directions/DirectionFilter"
import { useDirections } from "../../../../../features/directions/use-directions"
import { formatAmount } from "../../../../../features/subscriptions/subscription-display"
import { refreshAnalytics } from "../../../../../shared/api/analytics"
import {
  listGroups,
  listGyms,
  type Gym,
  type GroupSummary,
} from "../../../../../shared/api/groups"
import {
  ANALYTICS_ALL,
  analyticsCoachOptions,
  analyticsGroupOptions,
  type AnalyticsFilter,
} from "../../../../../shared/lib/analytics"
import { errorMessage } from "../../../../../shared/lib/error-message"
import { isWorkspaceAdmin } from "../../../../../shared/lib/permissions"
import { useMyMembership } from "../../../../../shared/lib/use-my-membership"
import { useDirectionScope } from "../../../../../shared/workspace/use-direction-scope"
import { groupOptionLabel } from "../../../../../shared/lib/group-label"

const numberFmt = new Intl.NumberFormat("ru-RU")

// Same rule as the overview page: «5 000 ₽» when the club has a currency,
// the bare number otherwise.
export const formatMoney = (amount: number, currency: string | null) =>
  currency ? formatAmount(amount, currency) : numberFmt.format(amount)

const computedAtFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
})

/**
 * Gym / direction / group / coach pickers shared by every «Аналитика» page.
 * The lists are best-effort (a failed load leaves the picker empty); the
 * server scopes the numbers to the caller's groups regardless.
 */
export function AnalyticsFilters({
  workspaceId,
  value,
  onChange,
  children,
}: {
  workspaceId: string | undefined
  value: AnalyticsFilter
  onChange: (next: AnalyticsFilter) => void
  // Extra page-specific controls rendered at the end of the bar.
  children?: ReactNode
}) {
  const scope = useDirectionScope(workspaceId)
  const { directions } = useDirections(workspaceId)
  const [gyms, setGyms] = useState<Gym[]>([])
  const [groups, setGroups] = useState<GroupSummary[]>([])

  useEffect(() => {
    if (!workspaceId) return
    void listGyms({ workspaceId })
      .then((res) => setGyms(res.data))
      .catch(() => setGyms([]))
    void listGroups({ workspaceId })
      .then((res) => setGroups(res.data))
      .catch(() => setGroups([]))
  }, [workspaceId])

  const coaches = analyticsCoachOptions(groups)
  const groupOptions = analyticsGroupOptions(groups, value)

  // A narrower gym / direction / coach can hide the picked group — reset it.
  const narrow = (patch: Partial<AnalyticsFilter>) =>
    onChange({ ...value, ...patch, groupId: ANALYTICS_ALL })

  return (
    <div className="flex flex-wrap items-center gap-3">
      {gyms.length > 1 && (
        <div className="w-48">
          <Select value={value.gymId} onValueChange={(v) => narrow({ gymId: v })}>
            <SelectTrigger aria-label="Зал">
              <SelectValue placeholder="Зал" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANALYTICS_ALL}>Все залы</SelectItem>
              {gyms.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <DirectionFilter
        directions={scope.filterOptions(directions)}
        value={value.directionId}
        onChange={(v) => narrow({ directionId: v })}
        includeClubOnly={false}
      />
      <div className="w-48">
        <Select
          value={value.groupId}
          onValueChange={(v) => onChange({ ...value, groupId: v })}
        >
          <SelectTrigger aria-label="Группа">
            <SelectValue placeholder="Группа" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANALYTICS_ALL}>Все группы</SelectItem>
            {groupOptions.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {groupOptionLabel(g)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {coaches.length > 1 && (
        <div className="w-48">
          <Select
            value={value.coachId}
            onValueChange={(v) => narrow({ coachId: v })}
          >
            <SelectTrigger aria-label="Тренер">
              <SelectValue placeholder="Тренер" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANALYTICS_ALL}>Все тренеры</SelectItem>
              {coaches.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {children}
    </div>
  )
}

/**
 * «Обновлено: …» from the snapshot's computedAt, or a «still computing» note
 * before the first snapshot. Admins get «Пересчитать», which rebuilds the
 * snapshots now and then lets the page reload.
 */
export function AnalyticsFreshness({
  workspaceId,
  computedAt,
  onRefreshed,
}: {
  workspaceId: string | undefined
  computedAt: string | null | undefined
  onRefreshed: () => void | Promise<void>
}) {
  const canAdmin = isWorkspaceAdmin(useMyMembership(workspaceId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    if (!workspaceId || busy) return
    setBusy(true)
    setError(null)
    try {
      await refreshAnalytics({ workspaceId })
      await onRefreshed()
    } catch (err) {
      setError(errorMessage(err, "Не удалось пересчитать аналитику."))
    } finally {
      setBusy(false)
    }
  }

  // Undefined = the page is still loading; don't flash «ещё считаются».
  if (computedAt === undefined) return null

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      <span>
        {computedAt
          ? `Обновлено: ${computedAtFmt.format(new Date(computedAt))}`
          : "Данные ещё считаются — обычно до часа"}
      </span>
      {canAdmin && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void refresh()}
          disabled={busy}
        >
          {busy ? "Пересчитываю…" : "Пересчитать"}
        </Button>
      )}
      {error && <span className="text-destructive">{error}</span>}
    </div>
  )
}

export function AnalyticsCard({
  label,
  value,
  subtitle,
  tone = "default",
}: {
  label: string
  value: ReactNode
  subtitle?: ReactNode
  tone?: "default" | "warn" | "danger"
}) {
  return (
    <div className="space-y-1 rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`text-3xl font-semibold tabular-nums ${TONE_TEXT[tone]}`}>
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      )}
    </div>
  )
}

const TONE_TEXT: Record<"default" | "warn" | "danger", string> = {
  default: "",
  warn: "text-amber-600 dark:text-amber-500",
  danger: "text-destructive",
}

export function AnalyticsError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  )
}

export function AnalyticsSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-14 animate-pulse rounded-lg border border-border bg-muted"
        />
      ))}
    </div>
  )
}
