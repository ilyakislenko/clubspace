"use client"

import { ChevronRight } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  Input,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import {
  createPlatformOrganization,
  fetchPlatformOrganizations,
  type PlatformOrganization,
} from "../../shared/api/platform"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { inputClsFull } from "../../shared/lib/input-class"
import { pluralRu } from "../../shared/lib/plural-ru"
import { browserTimezone } from "../../shared/lib/timezones"
import { confirmLeave, sameData, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { WORKSPACE_TYPE_OPTIONS, type WorkspaceTypeValue } from "../../shared/lib/workspace-type"
import { clubsCount } from "../org/org-view"
import { TimezoneSelect } from "../settings/TimezoneSelect"

const L = FORM_LIMITS.platformOrganization

const isNotFound = (error: unknown): boolean =>
  (error as { response?: { status?: number } } | null)?.response?.status === 404

// «Федерации» of the platform console: every federation and «Создать
// федерацию» (a platform action in the MVP; its first admin then invites
// the clubs). Hidden while the feature is off on the server.
export function PlatformOrganizations({ onNotice }: { onNotice: (text: string) => void }) {
  const router = useRouter()
  const [orgs, setOrgs] = useState<PlatformOrganization[] | null>(null)
  const [off, setOff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      setOrgs(await fetchPlatformOrganizations())
      setError(null)
    } catch (e) {
      if (isNotFound(e)) setOff(true)
      else setError(errorMessage(e, "Не удалось загрузить федерации."))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (off) return null

  const requestClose = async () => {
    if (await confirmLeave()) setFormOpen(false)
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 className="text-lg font-semibold">Федерации</h2>
        <Button variant="outline" onClick={() => setFormOpen(true)}>
          Создать федерацию
        </Button>
      </div>
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {orgs === null ? (
        !error && <div className="h-16 animate-pulse rounded-md border bg-muted" />
      ) : orgs.length === 0 ? (
        <p className="text-sm text-muted-foreground">Федераций пока нет.</p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-md border">
          {orgs.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left text-sm hover:bg-muted/50"
                onClick={() => router.push(`/org/${o.id}`)}
              >
                <span className="min-w-0">
                  <span className="block font-medium">{o.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[
                      o.city,
                      clubsCount(o.activeClubs),
                      o.invitedClubs > 0 ? `приглашено ${o.invitedClubs}` : null,
                      `${o.members} ${pluralRu(o.members, "человек", "человека", "человек")} в команде`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={formOpen} onOpenChange={(next) => (next ? setFormOpen(true) : void requestClose())}>
        <SheetContent className="flex w-full flex-col gap-6 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Новая федерация</SheetTitle>
            <SheetDescription>
              Первый администратор федерации приглашает клубы по их кодам; клуб вступает, только если владелец
              согласится.
            </SheetDescription>
          </SheetHeader>
          {formOpen && (
            <CreateForm
              onCancel={() => void requestClose()}
              onCreated={async (text) => {
                setFormOpen(false)
                onNotice(text)
                await load()
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </section>
  )
}

function CreateForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (notice: string) => Promise<void> }) {
  const [initial] = useState(() => ({
    name: "",
    key: "",
    type: "CUSTOM" as WorkspaceTypeValue,
    city: "",
    timezone: browserTimezone(),
    adminEmail: "",
  }))
  const [f, setF] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useDirtyGuard(!sameData(f, initial))
  const edit = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }))

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await createPlatformOrganization({
        name: f.name.trim(),
        key: f.key.trim() || undefined,
        type: f.type,
        city: f.city.trim() || undefined,
        timezone: f.timezone,
        adminEmail: f.adminEmail.trim(),
      })
      await onCreated(
        `Федерация «${r.organization.name}» создана. ${
          r.adminCreated ? "Аккаунт администратора создан" : "Администратор назначен"
        }${r.adminNotified ? ", письмо отправлено" : ""}.`,
      )
    } catch (e) {
      setError(errorMessage(e, "Не удалось создать федерацию."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto">
        <div className="space-y-2">
          <Label htmlFor="platform-org-name">Название</Label>
          <Input
            id="platform-org-name"
            value={f.name}
            maxLength={L.name.max}
            onChange={(e) => edit({ name: e.target.value })}
            placeholder="Федерация БЖЖ области"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="platform-org-admin">Почта администратора федерации</Label>
          <Input
            id="platform-org-admin"
            type="email"
            value={f.adminEmail}
            onChange={(e) => edit({ adminEmail: e.target.value })}
            placeholder="president@federation.ru"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="platform-org-type">Вид спорта</Label>
            <select
              id="platform-org-type"
              className={inputClsFull}
              value={f.type}
              onChange={(e) => edit({ type: e.target.value as WorkspaceTypeValue })}
            >
              {WORKSPACE_TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-org-city">Город</Label>
            <Input
              id="platform-org-city"
              value={f.city}
              maxLength={L.city.max}
              onChange={(e) => edit({ city: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="platform-org-timezone">Часовой пояс</Label>
          <TimezoneSelect id="platform-org-timezone" value={f.timezone} onChange={(timezone) => edit({ timezone })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="platform-org-key">Ключ (необязательно — иначе построим из названия)</Label>
          <Input
            id="platform-org-key"
            value={f.key}
            maxLength={L.key.max}
            onChange={(e) => edit({ key: e.target.value })}
          />
        </div>
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <SheetFooter>
        <div className="flex w-full items-center justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            Отмена
          </Button>
          <Button type="button" disabled={busy || !f.name.trim() || !f.adminEmail.trim()} onClick={() => void submit()}>
            {busy ? "Создаём…" : "Создать федерацию"}
          </Button>
        </div>
      </SheetFooter>
    </>
  )
}
