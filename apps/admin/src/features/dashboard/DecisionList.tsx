"use client"

import { ChevronDown, ChevronRight } from "lucide-react"
import Link from "next/link"
import { useState, type ReactNode } from "react"

import type { PendingFreezeRequest } from "../../shared/api/subscriptions"
import { pluralRu } from "../../shared/lib/plural-ru"
import { openDecisions, type DecisionCounts, type DecisionKey } from "./decisions"

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" })
const freezeLine = (r: PendingFreezeRequest) =>
  `${r.days} ${pluralRu(r.days, "день", "дня", "дней")} с ${dateFmt.format(new Date(`${r.fromDate}T00:00:00`))} · ${r.planName}`

const ROW = "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/60"

function RowBody({ label, hint, count, trailing }: { label: string; hint?: string; count: number; trailing: ReactNode }) {
  return (
    <>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{label}</span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span className="shrink-0 text-base font-semibold tabular-nums">{count}</span>
      {trailing}
    </>
  )
}

const chevron = <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />

/**
 * «Нужно решение»: what is waiting for staff right now, one row per kind and
 * only while there is something (decisions.ts). A row opens the list where it
 * is decided; several freeze requests unfold into one row per member, as only
 * the member card decides them.
 */
export function DecisionList({
  workspaceId,
  counts,
  awaitingAmount,
  freezeRequests,
}: {
  workspaceId: string
  counts: DecisionCounts
  // «на сумму …» for club admins; null for everyone else.
  awaitingAmount: string | null
  freezeRequests: PendingFreezeRequest[]
}) {
  const [freezeOpen, setFreezeOpen] = useState(false)
  const rows = openDecisions(counts)
  if (rows.length === 0) return null
  const base = `/workspace/${workspaceId}`

  const meta: Record<Exclude<DecisionKey, "freeze">, { label: string; hint?: string; href: string }> = {
    call: { label: "Кому позвонить", hint: "ученики, которые могут уйти", href: `${base}/retention` },
    renew: { label: "Продлить", hint: "абонемент заканчивается или закончился", href: `${base}/retention?tab=renew` },
    awaiting: {
      label: "Ожидают оплаты",
      hint: awaitingAmount ? `на сумму ${awaitingAmount}` : "абонемент выдан, но не оплачен",
      href: `${base}/retention?tab=renew`,
    },
    join: { label: "Заявки на вступление", hint: "ждут одобрения", href: `${base}/users` },
    video: { label: "Видео в обработке или с ошибкой", href: `${base}/content` },
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Нужно решение</h2>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map(({ key, count }) => {
          if (key !== "freeze") {
            const m = meta[key]
            return (
              <li key={key}>
                <Link href={m.href} className={ROW}>
                  <RowBody label={m.label} hint={m.hint} count={count} trailing={chevron} />
                </Link>
              </li>
            )
          }
          const label = "Заявки на заморозку"
          const only = freezeRequests.length === 1 ? freezeRequests[0] : null
          if (only) {
            return (
              <li key={key}>
                <Link href={`${base}/users/${only.userId}`} className={ROW}>
                  <RowBody label={label} hint={`${only.memberName} · ${freezeLine(only)}`} count={count} trailing={chevron} />
                </Link>
              </li>
            )
          }
          return (
            <li key={key}>
              <button type="button" aria-expanded={freezeOpen} onClick={() => setFreezeOpen((o) => !o)} className={ROW}>
                <RowBody
                  label={label}
                  hint="решаются в карточке ученика"
                  count={count}
                  trailing={
                    <ChevronDown
                      aria-hidden
                      className={`size-4 shrink-0 text-muted-foreground transition-transform ${freezeOpen ? "rotate-180" : ""}`}
                    />
                  }
                />
              </button>
              {freezeOpen && (
                <ul className="border-t border-border bg-muted/30">
                  {freezeRequests.map((r) => (
                    <li key={r.id}>
                      <Link href={`${base}/users/${r.userId}`} className={`${ROW} pl-6`}>
                        <span className="min-w-0 flex-1 truncate">
                          {r.memberName}
                          <span className="text-muted-foreground"> · {freezeLine(r)}</span>
                        </span>
                        {chevron}
                      </Link>
                    </li>
                  ))}
                  {count > freezeRequests.length && (
                    <li className="px-3 py-2.5 pl-6 text-sm text-muted-foreground">
                      И ещё {count - freezeRequests.length} — в карточках учеников
                    </li>
                  )}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
