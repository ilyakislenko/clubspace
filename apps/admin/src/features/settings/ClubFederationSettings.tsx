"use client"

import { MoreHorizontal } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@clubspace/ui-kit/ui"

import {
  acceptOrganizationInvite,
  declineOrganizationInvite,
  leaveOrganization,
  listClubOrganizations,
  updateOrganizationSharing,
  type ClubOrganizationLink,
  type OrganizationSharing,
} from "../../shared/api/organizations"
import { errorMessage } from "../../shared/lib/error-message"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { SettingsSectionHeader } from "./SettingsNav"
import { SettingRow, SettingSwitch } from "./SettingSwitch"

type SharingKey = keyof OrganizationSharing

// What the club decides (design §1 table), in reading order; money last and
// off by default.
export const SHARING_ROWS: readonly { key: SharingKey; title: string; description: string }[] = [
  {
    key: "shareRegistry",
    title: "Реестр поясов",
    description: "Имя, пояс и дата присвоения учеников, которые сами согласились (за ребёнка — родитель).",
  },
  {
    key: "allowMemberAnnouncements",
    title: "Объявления федерации в ленте учеников",
    description: "Без этого объявления получают только владелец и команда клуба.",
  },
  {
    key: "allowMemberEvents",
    title: "События федерации в приложении",
    description: "Ученики видят турниры и семинары федерации и записываются на них.",
  },
  {
    key: "shareMrr",
    title: "Регулярный доход в месяц",
    description: "Федерация увидит сумму.",
  },
  {
    key: "shareRevenue30d",
    title: "Выручка за 30 дней",
    description: "Федерация увидит сумму.",
  },
]

// Always visible to the federation while the club is a member.
const ALWAYS_SHARED =
  "Название, город, логотип и контакты клуба; сколько всего учеников и активных, сколько приходили и сколько новых за 30 дней, удержание новичков за 3 месяца."

const LEAVE_TEXT =
  "Федерация перестанет видеть цифры клуба, реестр и записи ваших учеников на её события."

// «Настройки → Федерация» (club admins): invitations to accept or decline,
// and for each federation the club is in, what it shares and «Выйти».
export function ClubFederationSettings({ workspaceId }: { workspaceId: string }) {
  const [links, setLinks] = useState<ClubOrganizationLink[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLinks(await listClubOrganizations({ workspaceId }))
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить федерации"))
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load])

  useWorkspaceRealtime(workspaceId, ["organizations"], () => void load())

  const run = async (linkId: string, action: () => Promise<unknown>, failText: string) => {
    setBusyId(linkId)
    try {
      await action()
      await load()
    } catch (e) {
      setError(errorMessage(e, failText))
    } finally {
      setBusyId(null)
    }
  }

  const leave = async (link: ClubOrganizationLink) => {
    const ok = await confirmDialog({
      title: `Выйти из федерации «${link.organization.name}»?`,
      description: LEAVE_TEXT,
      confirmLabel: "Выйти",
      destructive: true,
    })
    if (ok) await run(link.id, () => leaveOrganization({ workspaceId, linkId: link.id }), "Не удалось выйти из федерации")
  }

  const decline = async (link: ClubOrganizationLink) => {
    const ok = await confirmDialog({
      title: `Отклонить приглашение федерации «${link.organization.name}»?`,
      description: "Федерация сможет пригласить клуб снова.",
      confirmLabel: "Отклонить",
    })
    if (ok)
      await run(
        link.id,
        () => declineOrganizationInvite({ workspaceId, linkId: link.id }),
        "Не удалось отклонить приглашение",
      )
  }

  const visible = (links ?? []).filter((l) => l.status === "INVITED" || l.status === "ACTIVE")
  const past = (links ?? []).filter((l) => l.status === "DECLINED" || l.status === "LEFT")

  return (
    <>
      <SettingsSectionHeader
        title="Федерация"
        description="Федерация видит только то, что вы разрешите. Ученики, деньги и настройки остаются у клуба."
      />

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {links === null ? (
        !error && <div className="h-32 animate-pulse rounded-xl border border-border bg-muted" />
      ) : (
        <>
          {visible.map((link) =>
            link.status === "INVITED" ? (
              <InvitationCard
                key={link.id}
                link={link}
                canAccept={link.canAccept}
                busy={busyId === link.id}
                onAccept={(sharing) =>
                  run(
                    link.id,
                    () => acceptOrganizationInvite({ workspaceId, linkId: link.id, sharing }),
                    "Не удалось принять приглашение",
                  )
                }
                onDecline={() => void decline(link)}
              />
            ) : (
              <MembershipCard
                key={link.id}
                link={link}
                busy={busyId === link.id}
                onToggle={(key, value) =>
                  run(
                    link.id,
                    () => updateOrganizationSharing({ workspaceId, linkId: link.id, data: { [key]: value } }),
                    "Не удалось сохранить настройку",
                  )
                }
                onLeave={() => void leave(link)}
              />
            ),
          )}
          {visible.length === 0 && (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Клуб не состоит в федерациях.
            </p>
          )}
          {past.length > 0 && (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {past.map((link) => (
                <li key={link.id}>
                  {link.status === "DECLINED"
                    ? `Приглашение федерации «${link.organization.name}» отклонено`
                    : `Клуб вышел из федерации «${link.organization.name}»`}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  )
}

function InvitationCard({
  link,
  canAccept,
  busy,
  onAccept,
  onDecline,
}: {
  link: ClubOrganizationLink
  canAccept: boolean
  busy: boolean
  onAccept: (sharing: OrganizationSharing) => void
  onDecline: () => void
}) {
  // The owner may change the defaults before accepting.
  const [sharing, setSharing] = useState<OrganizationSharing>(link.sharing)
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="font-medium">Федерация «{link.organization.name}» приглашает клуб</h3>
        <p className="mt-1 text-sm text-muted-foreground">Федерация всегда видит: {ALWAYS_SHARED}</p>
      </div>
      <ul className="divide-y divide-border">
        {SHARING_ROWS.map((row) => (
          <SettingRow key={row.key} title={row.title} description={row.description}>
            <SettingSwitch
              checked={sharing[row.key]}
              disabled={!canAccept || busy}
              label={row.title}
              onChange={(next) => setSharing((s) => ({ ...s, [row.key]: next }))}
            />
          </SettingRow>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!canAccept && (
          <p className="mr-auto text-sm text-muted-foreground">Принять может только владелец клуба</p>
        )}
        <Button type="button" variant="outline" disabled={busy} onClick={onDecline}>
          Отклонить
        </Button>
        {canAccept && (
          <Button type="button" disabled={busy} onClick={() => onAccept(sharing)}>
            Принять
          </Button>
        )}
      </div>
    </section>
  )
}

function MembershipCard({
  link,
  busy,
  onToggle,
  onLeave,
}: {
  link: ClubOrganizationLink
  busy: boolean
  onToggle: (key: SharingKey, value: boolean) => void
  onLeave: () => void
}) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">Федерация «{link.organization.name}»</h3>
          <p className="mt-1 text-sm text-muted-foreground">Федерация всегда видит: {ALWAYS_SHARED}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="sm" variant="ghost" aria-label={`Действия: ${link.organization.name}`}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-destructive" onSelect={onLeave}>
              Выйти из федерации
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ul className="divide-y divide-border">
        {SHARING_ROWS.map((row) => (
          <SettingRow key={row.key} title={row.title} description={row.description}>
            <SettingSwitch
              checked={link.sharing[row.key]}
              disabled={busy}
              label={row.title}
              onChange={(next) => onToggle(row.key, next)}
            />
          </SettingRow>
        ))}
      </ul>
    </section>
  )
}
