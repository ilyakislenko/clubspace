"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import { listOrganizationClubs, type OrgClub, type OrgClubsList } from "../../../../shared/api/organizations"
import { errorMessage } from "../../../../shared/lib/error-message"
import { useOrg } from "../../../../features/org/org-context"
import { InviteClubSheet } from "../../../../features/org/InviteClubSheet"
import { OrgClubSheet } from "../../../../features/org/OrgClubSheet"
import {
  CLUB_STATUS_LABEL,
  formatCount,
  formatMoney,
  formatRate,
  moneyCoverage,
} from "../../../../features/org/org-view"

// «Клубы», the console's landing: the member clubs with the glossary numbers
// (the same functions as the clubs' own screens), money only where a club
// opened it, pending invitations as muted rows.
export default function OrgClubsPage() {
  const { org, isAdmin } = useOrg()
  const [list, setList] = useState<OrgClubsList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [open, setOpen] = useState<OrgClub | null>(null)

  const load = useCallback(async () => {
    try {
      setList(await listOrganizationClubs({ organizationId: org.id }))
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить клубы"))
    }
  }, [org.id])

  useEffect(() => {
    void load()
    // The console has no realtime room: a club's decision shows on return.
    const onFocus = () => void load()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [load])

  const rows = (list?.data ?? []).filter((c) => c.status === "ACTIVE" || c.status === "INVITED")
  const active = rows.filter((c) => c.status === "ACTIVE")
  const totals = list?.totals
  const showMrr = active.some((c) => c.metrics?.mrr)
  const showRevenue = active.some((c) => c.metrics?.revenue30d)

  const head = [
    "Клуб",
    "Город",
    "Ученики",
    "Активные ученики",
    "Были за 30 дней",
    "Новые за 30 дней",
    "Удержание новичков (3 мес.)",
    ...(showMrr ? ["Регулярный доход в месяц"] : []),
    ...(showRevenue ? ["Выручка за 30 дней"] : []),
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">Клубы</h1>
        {isAdmin && (
          <Button type="button" onClick={() => setInviteOpen(true)}>
            Пригласить клуб
          </Button>
        )}
      </div>

      {notice && (
        <p className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p>
      )}
      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {list === null ? (
        !error && <div className="h-40 animate-pulse rounded-xl border border-border bg-muted" />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          В федерации пока нет клубов.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                {head.map((h, i) => (
                  <th key={h} scope="col" className={`px-3 py-2 font-medium ${i >= 2 ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((c) => {
                const m = c.metrics
                const invited = c.status === "INVITED"
                return (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    className="cursor-pointer hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                    onClick={() => setOpen(c)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        setOpen(c)
                      }
                    }}
                  >
                    <td className="px-3 py-2.5">
                      <span className={invited ? "text-muted-foreground" : "font-medium"}>{c.club.name}</span>
                      {invited && (
                        <span className="ml-2 text-xs text-muted-foreground">{CLUB_STATUS_LABEL.INVITED}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{c.club.city ?? ""}</td>
                    {m ? (
                      <>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(m.students)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(m.activeStudents)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(m.attended30d)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(m.new30d)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatRate(m.newcomerRetention3m.rate)}</td>
                        {showMrr && <MoneyCell value={m.mrr} />}
                        {showRevenue && <MoneyCell value={m.revenue30d} />}
                      </>
                    ) : (
                      <td colSpan={head.length - 2} />
                    )}
                  </tr>
                )
              })}
            </tbody>
            {totals && active.length > 1 && (
              <tfoot className="border-t border-border bg-muted/20 font-medium">
                <tr>
                  <td className="px-3 py-2.5" colSpan={2}>
                    Всего
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(totals.students)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(totals.activeStudents)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(totals.attended30d)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatCount(totals.new30d)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatRate(totals.newcomerRetention3m.rate)}</td>
                  {showMrr && <MoneyTotalCell value={totals.mrr} activeClubs={totals.activeClubs} />}
                  {showRevenue && <MoneyTotalCell value={totals.revenue30d} activeClubs={totals.activeClubs} />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {isAdmin && (
        <InviteClubSheet
          organizationId={org.id}
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          onInvited={(name) => {
            setNotice(`Приглашение отправлено клубу ${name}. Клуб появится в списке, когда владелец его примет.`)
            void load()
          }}
        />
      )}
      <OrgClubSheet
        organizationId={org.id}
        club={open}
        isAdmin={isAdmin}
        onClose={() => setOpen(null)}
        onChanged={() => void load()}
      />
    </div>
  )
}

function MoneyCell({ value }: { value: { amount: number; currency: string | null } | null }) {
  return (
    <td className={`px-3 py-2.5 text-right tabular-nums ${value ? "" : "text-muted-foreground"}`}>
      {formatMoney(value)}
    </td>
  )
}

function MoneyTotalCell({
  value,
  activeClubs,
}: {
  value: { amount: number; currency: string | null; clubs: number } | null
  activeClubs: number
}) {
  return (
    <td className="px-3 py-2.5 text-right tabular-nums">
      {value ? (
        <>
          {formatMoney(value)}
          <span className="block text-xs font-normal text-muted-foreground">
            {moneyCoverage(value.clubs, activeClubs)}
          </span>
        </>
      ) : null}
    </td>
  )
}
