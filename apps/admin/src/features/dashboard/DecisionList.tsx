"use client"

import { ChevronRight } from "lucide-react"
import Link from "next/link"

import type { LeadCounts } from "../../shared/api/leads"
import type { RequestCounts } from "../../shared/api/requests"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { todayHint } from "../leads/lead-view"
import { requestsBreakdown, requestsHref } from "../requests/request-view"
import { openDecisions, type DecisionCounts, type DecisionKey } from "./decisions"

const ROW = "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/60"

/**
 * «Нужно решение»: what is waiting for staff right now, one row per kind and
 * only while there is something (decisions.ts). A row opens the list where it
 * is decided; «Заявки» opens «Ученики → Заявки» with the per-kind breakdown
 * from the same read as the tab badge, «Заявки на пробное» opens «Пробные».
 */
export function DecisionList({
  workspaceId,
  counts,
  awaitingAmount,
  requestCounts,
  leadCounts,
}: {
  workspaceId: string
  counts: DecisionCounts
  // «на сумму …» for club admins; null for everyone else.
  awaitingAmount: string | null
  // The «Заявки» breakdown; null while it loads or failed (the row is absent).
  requestCounts: RequestCounts | null
  // The «Заявки на пробное» breakdown (sport leads); null otherwise.
  leadCounts: LeadCounts | null
}) {
  const vocabulary = useVocabulary()
  const rows = openDecisions(counts)
  if (rows.length === 0) return null
  const base = `/workspace/${workspaceId}`

  const meta: Record<DecisionKey, { label: string; hint?: string; href: string }> = {
    call: { label: "Кому позвонить", hint: "ученики, которые могут уйти", href: `${base}/retention` },
    renew: { label: "Продлить", hint: "абонемент заканчивается или закончился", href: `${base}/retention?tab=renew` },
    awaiting: {
      label: "Ожидают оплаты",
      hint: awaitingAmount ? `на сумму ${awaitingAmount}` : "абонемент выдан, но не оплачен",
      href: `${base}/retention?tab=renew`,
    },
    requests: {
      label: "Заявки",
      hint: requestCounts ? requestsBreakdown(requestCounts, vocabulary) : undefined,
      href: requestCounts ? requestsHref(workspaceId, requestCounts) : `${base}/users/requests`,
    },
    leads: {
      label: "Заявки на пробное",
      hint: leadCounts ? todayHint(leadCounts) : undefined,
      href: `${base}/users/trials`,
    },
    video: { label: "Видео в обработке или с ошибкой", href: `${base}/content` },
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">Нужно решение</h2>
      <ul className="divide-y divide-border rounded-lg border border-border bg-card">
        {rows.map(({ key, count }) => {
          const m = meta[key]
          return (
            <li key={key}>
              <Link href={m.href} className={ROW}>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{m.label}</span>
                  {m.hint && <span className="block truncate text-xs text-muted-foreground">{m.hint}</span>}
                </span>
                <span className="shrink-0 text-base font-semibold tabular-nums">{count}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
