"use client"

import type { PlatformWorkspaceBillingCard } from "../../shared/api/platform"
import {
  BANNER_TONE_CLASS,
  formatEdition,
  LEGAL_SOURCE_LABEL,
  legalEditionsLabel,
  legalStatusBanner,
} from "../billing/billing-view"
import { LegalDocLink } from "../billing/LegalDocLink"
import { fmtAuditWhen } from "./PlatformAuditFeed"

const USER_AGENT_SHOWN = 60

// The console card's «Оферта и поручение»: where the club stands with the
// current editions and every acceptance recorded for it (newest first) — the
// evidence: who, when, how, from where.
export function PlatformLegalAcceptances({ card }: { card: PlatformWorkspaceBillingCard }) {
  const { legal } = card
  const status = legalStatusBanner(legal)

  return (
    <section className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground">Оферта и поручение</div>
      <div className="space-y-2 rounded-md border bg-card p-3 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <LegalDocLink doc="offer" version={legal.offerVersion}>
              Оферта
            </LegalDocLink>{" "}
            — ред. {formatEdition(legal.offerVersion)}
          </span>
          <span>
            <LegalDocLink doc="dpa" version={legal.dpaVersion}>
              Поручение
            </LegalDocLink>{" "}
            — ред. {formatEdition(legal.dpaVersion)}
          </span>
        </div>
        <p className={`rounded-md border px-2 py-1 text-xs ${BANNER_TONE_CLASS[status.tone]}`}>
          {status.text}
        </p>

        {legal.acceptances.length === 0 ? (
          <p className="text-xs text-muted-foreground">Принятий пока нет.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">Когда</th>
                  <th className="py-1 pr-3 font-medium">Как</th>
                  <th className="py-1 pr-3 font-medium">Редакции</th>
                  <th className="py-1 pr-3 font-medium">Кто</th>
                  <th className="py-1 pr-3 font-medium">IP</th>
                  <th className="py-1 pr-3 font-medium">Браузер</th>
                  <th className="py-1 font-medium">Основание</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {legal.acceptances.map((a) => (
                  <tr key={a.id} className="align-top">
                    <td className="whitespace-nowrap py-1 pr-3">{fmtAuditWhen(a.acceptedAt)}</td>
                    <td className="py-1 pr-3">{LEGAL_SOURCE_LABEL[a.source]}</td>
                    <td className="py-1 pr-3">{legalEditionsLabel(a)}</td>
                    <td className="py-1 pr-3">
                      {a.userName && <div>{a.userName}</div>}
                      <div className="text-muted-foreground">{a.userEmail ?? a.userId}</div>
                    </td>
                    <td className="py-1 pr-3 font-mono">{a.ip ?? "—"}</td>
                    <td className="py-1 pr-3" title={a.userAgent ?? undefined}>
                      {a.userAgent
                        ? a.userAgent.length > USER_AGENT_SHOWN
                          ? `${a.userAgent.slice(0, USER_AGENT_SHOWN)}…`
                          : a.userAgent
                        : "—"}
                    </td>
                    <td className="py-1 font-mono">
                      {a.recordedById && <div>оформил {a.recordedById}</div>}
                      {a.paymentId && <div>платёж {a.paymentId}</div>}
                      {!a.recordedById && !a.paymentId && "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}
