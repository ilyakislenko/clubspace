"use client"

import Link from "next/link"
import type { ReactNode } from "react"

import type { WorkspaceStats } from "../../shared/api/stats"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { revenueChangePct } from "./decisions"

// One number of a summary block: sentence-case label, the value, one note.
function Figure({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="whitespace-nowrap text-2xl font-semibold tabular-nums">{value}</div>
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  )
}

/**
 * Club money for club admins: the two monthly figures of the glossary (B2),
 * revenue with its change against the previous 30 days. The expected revenue
 * lives on «Выручка и прогноз», one link away.
 */
export function MoneyBlock({
  workspaceId,
  revenue,
  format,
}: {
  workspaceId: string
  revenue: NonNullable<WorkspaceStats["revenue"]>
  format: (amount: number) => string
}) {
  const change = revenueChangePct(revenue.revenue30d, revenue.revenuePrev30d)
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">Деньги</h2>
        <Link href={`/workspace/${workspaceId}/analytics/forecast`} className="text-xs text-primary hover:underline">
          Выручка и прогноз
        </Link>
      </div>
      <div className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2">
        <Figure
          label="Регулярный доход в месяц"
          value={format(revenue.mrr)}
          note="оплаченные действующие абонементы в пересчёте на 30 дней"
        />
        <Figure
          label="Выручка за 30 дней"
          value={format(revenue.revenue30d)}
          note={
            change === null ? (
              "фактически оплачено за последние 30 дней"
            ) : (
              <span title={`Предыдущие 30 дней: ${format(revenue.revenuePrev30d)}`}>
                <span className={change >= 0 ? "font-medium text-emerald-600" : "font-medium text-destructive"}>
                  {change > 0 ? "+" : change < 0 ? "−" : ""}
                  {Math.abs(change)}%
                </span>{" "}
                к предыдущим 30 дням
              </span>
            )
          }
        />
      </div>
    </section>
  )
}

const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100)}% учеников`

// Attendance at a glance (glossary `students_attended_*`, `checkins_today`).
export function AttendanceBlock({ stats }: { stats: WorkspaceStats }) {
  const vocabulary = useVocabulary()
  const students = stats.counts.students
  const at = `Были на ${vocabulary.session.prepPl}`
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Посещаемость</h2>
      <div className="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-3">
        <Figure
          label={`${at} за неделю`}
          value={stats.attendance.attendedStudents7d}
          note={students > 0 ? pct(stats.attendance.attendedStudents7d, students) : undefined}
        />
        <Figure
          label={`${at} за 30 дней`}
          value={stats.attendance.attendedStudents30d}
          note={students > 0 ? pct(stats.attendance.attendedStudents30d, students) : undefined}
        />
        <Figure label="Отметок сегодня" value={stats.today.checkins} />
      </div>
    </section>
  )
}
