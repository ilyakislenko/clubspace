"use client"

import { MoreHorizontal } from "lucide-react"
import { useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import { removeClubFromOrganization, type OrgClub } from "../../shared/api/organizations"
import { errorMessage } from "../../shared/lib/error-message"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { formatCount, formatDate, formatMoney, formatRate } from "./org-view"

export const REMOVE_CLUB_TEXT =
  "Клуб перестанет видеть объявления и события федерации, а федерация — его цифры; реестр его учеников скроется. Клуб можно пригласить снова."

// What the club opened to the federation, in the club's own words.
const SHARING_LABELS: { key: keyof OrgClub["sharing"]; label: string }[] = [
  { key: "shareRegistry", label: "Реестр поясов" },
  { key: "allowMemberAnnouncements", label: "Объявления федерации в ленте учеников" },
  { key: "allowMemberEvents", label: "События федерации в приложении" },
  { key: "shareMrr", label: "Регулярный доход в месяц" },
  { key: "shareRevenue30d", label: "Выручка за 30 дней" },
]

// One member club (or pending invitation) in a side panel: contacts, its
// numbers, what it shares; the admin's «⋯» excludes it or revokes the invite.
export function OrgClubSheet({
  organizationId,
  club,
  isAdmin,
  onClose,
  onChanged,
}: {
  organizationId: string
  // null = closed.
  club: OrgClub | null
  isAdmin: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async (c: OrgClub) => {
    const invited = c.status === "INVITED"
    const ok = await confirmDialog({
      title: invited ? `Отозвать приглашение клуба ${c.club.name}?` : `Исключить ${c.club.name} из федерации?`,
      description: invited ? "Владелец клуба больше не увидит приглашение." : REMOVE_CLUB_TEXT,
      confirmLabel: invited ? "Отозвать" : "Исключить",
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      await removeClubFromOrganization({ organizationId, linkId: c.id })
      onChanged()
      onClose()
    } catch (e) {
      setError(errorMessage(e, "Не удалось изменить состав федерации"))
    } finally {
      setBusy(false)
    }
  }

  const m = club?.metrics ?? null
  const numbers: [string, string][] = m
    ? [
        ["Ученики", formatCount(m.students)],
        ["Активные ученики", formatCount(m.activeStudents)],
        ["Были за 30 дней", formatCount(m.attended30d)],
        ["Новые за 30 дней", formatCount(m.new30d)],
        ["Удержание новичков (3 мес.)", formatRate(m.newcomerRetention3m.rate)],
        ["Регулярный доход в месяц", formatMoney(m.mrr)],
        ["Выручка за 30 дней", formatMoney(m.revenue30d)],
      ]
    : []

  return (
    <Sheet open={club !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-md">
        {club && (
          <>
            <SheetHeader>
              <div className="flex items-start justify-between gap-3 pr-8">
                <div className="min-w-0">
                  <SheetTitle>{club.club.name}</SheetTitle>
                  <SheetDescription>
                    {club.status === "INVITED"
                      ? `Приглашён ${formatDate(club.invitedAt)}, ждём ответа владельца`
                      : (club.club.city ?? "Клуб федерации")}
                  </SheetDescription>
                </div>
                {isAdmin && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="sm" variant="ghost" disabled={busy} aria-label={`Действия: ${club.club.name}`}>
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="text-destructive" onSelect={() => void remove(club)}>
                        {club.status === "INVITED" ? "Отозвать приглашение" : "Исключить из федерации"}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </SheetHeader>
            <div className="flex-1 space-y-6 overflow-y-auto text-sm">
              {error && (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">{error}</p>
              )}
              {club.club.contacts.length > 0 && (
                <section className="space-y-1">
                  <h3 className="font-medium">Контакты</h3>
                  <ul className="space-y-1">
                    {club.club.contacts.map((c) => (
                      <li key={`${c.label}-${c.phone}`} className="flex justify-between gap-3">
                        <span className="text-muted-foreground">{c.label}</span>
                        <a href={`tel:${c.phone}`} className="tabular-nums hover:underline">
                          {c.phone}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {numbers.length > 0 && (
                <section className="space-y-1">
                  <h3 className="font-medium">Цифры</h3>
                  <dl className="divide-y divide-border rounded-lg border border-border">
                    {numbers.map(([label, value]) => (
                      <div key={label} className="flex justify-between gap-3 px-3 py-2">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="tabular-nums">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              {club.status === "ACTIVE" && (
                <section className="space-y-1">
                  <h3 className="font-medium">Клуб открыл федерации</h3>
                  <ul className="space-y-1">
                    {SHARING_LABELS.map(({ key, label }) => (
                      <li key={key} className="flex justify-between gap-3">
                        <span>{label}</span>
                        <span className="text-muted-foreground">{club.sharing[key] ? "да" : "нет"}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
