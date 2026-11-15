"use client"

import { useParams } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { useWorkspaceRealtime } from "../../../../shared/realtime/useWorkspaceRealtime"
import {
  getWorkspaceStats,
  type WorkspaceStats,
} from "../../../../shared/api/stats"
import { listAtRiskMembers } from "../../../../shared/api/retention"
import { listAwaitingPayment } from "../../../../shared/api/subscriptions"
import { AT_RISK_REFRESH_MS } from "../../../../shared/lib/at-risk"
import { errorMessage } from "../../../../shared/lib/error-message"
import { hasAccess, isClubAdmin, isSportLead } from "../../../../shared/lib/permissions"
import { useThrottledCallback } from "../../../../shared/lib/throttle"
import { useMyMembership } from "../../../../shared/lib/use-my-membership"
import {
  featureOn,
  useWorkspaceFeatures,
} from "../../../../shared/lib/use-workspace-features"
import { useVocabulary } from "../../../../shared/lib/vocabulary"
import { cap } from "@clubspace/ui-kit/brand"
import { formatAmount } from "../../../../features/subscriptions/subscription-display"
import { OnboardingChecklist } from "../../../../features/billing/OnboardingChecklist"
import { DecisionList } from "../../../../features/dashboard/DecisionList"
import { AttendanceBlock, MoneyBlock } from "../../../../features/dashboard/Figures"
import { TodayClasses } from "../../../../features/dashboard/TodayClasses"
import { useTodayClasses } from "../../../../features/dashboard/use-today-classes"
import { useRequestCounts } from "../../../../features/requests/use-request-counts"

const numberFmt = new Intl.NumberFormat("ru-RU")
const formatMoney = (amount: number, currency: string | null) =>
  currency ? formatAmount(amount, currency) : numberFmt.format(amount)

// Best-effort counts: a failed request drops its row, not the page.
const countOrNull = async (load: () => Promise<number>): Promise<number | null> => {
  try {
    return await load()
  } catch {
    return null
  }
}

/**
 * «Сегодня» by exceptions (docs/design/2026-11-08-admin-cleanup.md §4): what
 * waits for a decision, today's classes, then — for club admins — the money
 * and, for leads, attendance. A coach sees their own rows and classes only;
 * every number is a glossary metric (B2).
 */
export default function WorkspaceOverviewPage() {
  const params = useParams<{ workspaceId: string }>()
  const vocabulary = useVocabulary()
  const workspaceId = params?.workspaceId
  const membership = useMyMembership(workspaceId)
  const canAdmin = isClubAdmin(membership)
  const canLead = isSportLead(membership)
  // Sport leads and direction managers: the content library, attendance.
  const isLead = hasAccess(membership, "lead")
  const features = useWorkspaceFeatures(workspaceId)
  const showSubscriptions = featureOn(features, "subscription")
  const showAttendance = featureOn(features, "attendance")
  const showVideos = featureOn(features, "videos")

  const [stats, setStats] = useState<WorkspaceStats | null>(null)
  const [atRisk, setAtRisk] = useState<number | null>(null)
  const [awaitingCount, setAwaitingCount] = useState<number | null>(null)
  // «Заявки»: join, freeze, personal, video — the server counts what this
  // viewer may decide, the same read as the «Ученики» tab badge.
  const requests = useRequestCounts(workspaceId)
  const [error, setError] = useState<string | null>(null)

  const loadStats = useCallback(async () => {
    if (!workspaceId) return
    try {
      setStats(await getWorkspaceStats({ workspaceId }))
      setError(null)
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить данные."))
    }
  }, [workspaceId])

  // The rows whose lists depend on the role wait for the membership.
  const role = membership ? `${canLead}:${showSubscriptions}` : null
  const loadRows = useCallback(async () => {
    if (!workspaceId || role === null) return
    // The debt list is the sport leads'.
    setAwaitingCount(
      canLead && showSubscriptions
        ? await countOrNull(async () => (await listAwaitingPayment({ workspaceId, perPage: 1 })).members)
        : null,
    )
    // `role` stands for canLead + showSubscriptions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, role])

  // «Кому позвонить», the same number as the list header and the apps (the
  // server scopes it for coaches). Only the summary is needed.
  const loadAtRisk = useCallback(async () => {
    if (!workspaceId) return
    setAtRisk(
      await countOrNull(async () => (await listAtRiskMembers({ workspaceId, perPage: 1 })).summary.total),
    )
  }, [workspaceId])

  useEffect(() => {
    void loadStats()
    void loadAtRisk()
  }, [loadStats, loadAtRisk])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  // The at-risk list recomputes club-wide, so its refetch is throttled.
  const refreshAtRisk = useThrottledCallback(() => void loadAtRisk(), AT_RISK_REFRESH_MS)

  // «Заявки» reload themselves on the `requests` signal (useRequestCounts).
  useWorkspaceRealtime(workspaceId, ["members", "attendance", "subscription"], () => {
    void loadStats()
    void loadRows()
    refreshAtRisk()
  })

  const classes = useTodayClasses(
    workspaceId,
    membership ? !(canLead || isLead) : undefined,
  )

  const decisions = {
    call: atRisk,
    renew: canLead && showSubscriptions ? (stats?.retention.renewalsDue ?? null) : null,
    awaiting: awaitingCount,
    requests: requests?.counts.total ?? null,
    video: isLead && showVideos && stats ? stats.counts.videos - stats.counts.videosReady : null,
  }
  const money = canAdmin && showSubscriptions ? (stats?.revenue ?? null) : null
  // A failed schedule keeps its block (with the error), never reads as «no classes».
  const showClasses = classes.status === "failed" || (classes.status === "ready" && classes.items.length > 0)
  const hasDecisions = Object.values(decisions).some((n) => n !== null && n > 0)
  const attendance = isLead && showAttendance ? stats : null
  const settled = !!stats && membership !== null && classes.status !== "loading"

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Сегодня</h1>

      {canAdmin && workspaceId && <OnboardingChecklist workspaceId={workspaceId} />}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {workspaceId && (hasDecisions || showClasses) && (
        <div className={`grid items-start gap-6 ${hasDecisions && showClasses ? "lg:grid-cols-2" : ""}`}>
          <DecisionList
            workspaceId={workspaceId}
            counts={decisions}
            awaitingAmount={
              stats?.revenue && stats.revenue.awaitingPayment.amount > 0
                ? formatMoney(stats.revenue.awaitingPayment.amount, stats.revenue.currency)
                : null
            }
            requestCounts={requests?.counts ?? null}
          />
          {classes.status === "failed" ? (
            <section className="space-y-2">
              <h2 className="text-sm font-medium">{cap(vocabulary.session.nomPl)} сегодня</h2>
              <p className="rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-destructive">
                Не удалось загрузить расписание на сегодня.
              </p>
            </section>
          ) : classes.status === "ready" && classes.items.length > 0 ? (
            <TodayClasses
              workspaceId={workspaceId}
              today={classes.today}
              nowMin={classes.nowMin}
              items={classes.items}
            />
          ) : null}
        </div>
      )}

      {settled && !hasDecisions && !showClasses && (
        <p className="text-sm text-muted-foreground">
          Сегодня нет {vocabulary.session.genPl}, и ничего не ждёт решения.
        </p>
      )}

      {workspaceId && (money || attendance) && (
        <div className={`grid items-start gap-6 ${money && attendance ? "lg:grid-cols-2" : ""}`}>
          {money && (
            <MoneyBlock
              workspaceId={workspaceId}
              revenue={money}
              format={(amount) => formatMoney(amount, money.currency)}
            />
          )}
          {attendance && <AttendanceBlock stats={attendance} />}
        </div>
      )}
    </div>
  )
}
