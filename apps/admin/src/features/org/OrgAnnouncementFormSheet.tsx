"use client"

import { useState } from "react"

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@clubspace/ui-kit/ui"

import {
  createOrgAnnouncement,
  updateOrgAnnouncement,
  type OrgAnnouncement,
} from "../../shared/api/organizations"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { confirmLeave, sameData, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { isStaleUpdate, StaleUpdateNotice } from "../../shared/ui/stale-update-notice"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { ORG_AUDIENCES, audienceLabel, type OrgAudience } from "./org-view"

const L = FORM_LIMITS.orgAnnouncement

// What publishing sends, for the confirmation (the club's own staff words
// vary; «владельцы и команды клубов» fits every discipline).
export const orgPublishText = (audience: OrgAudience): string =>
  audience === "STAFF"
    ? "Владельцы и команды клубов федерации получат уведомление. Ночью по времени клуба — утром, в 9:00."
    : "Владельцы и команды клубов федерации получат уведомление; ученики увидят объявление в ленте клуба, если клуб это разрешил."

type Props = {
  organizationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  // null = a new announcement.
  announcement: OrgAnnouncement | null
  onSaved: () => void
}

// The federation announcement editor in a side panel: a new one (draft,
// publish now or later), or the text and audience of an existing one.
export function OrgAnnouncementFormSheet({ open, onOpenChange, announcement, onSaved, organizationId }: Props) {
  const requestClose = async () => {
    if (await confirmLeave()) onOpenChange(false)
  }
  const saved = () => {
    onSaved()
    onOpenChange(false)
  }
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{announcement ? "Редактировать объявление" : "Новое объявление"}</SheetTitle>
          <SheetDescription>Черновики видит только команда федерации.</SheetDescription>
        </SheetHeader>
        <AnnouncementForm
          key={announcement?.id ?? "new"}
          organizationId={organizationId}
          announcement={announcement}
          onCancel={() => void requestClose()}
          onSaved={saved}
        />
      </SheetContent>
    </Sheet>
  )
}

function AnnouncementForm({
  organizationId,
  announcement: a,
  onCancel,
  onSaved,
}: {
  organizationId: string
  announcement: OrgAnnouncement | null
  onCancel: () => void
  onSaved: () => void
}) {
  const vocabulary = useVocabulary()
  const initial = {
    title: a?.title ?? "",
    body: a?.body ?? "",
    audience: (a?.audience ?? "STAFF") as OrgAudience,
    scheduleAt: "",
  }
  const [title, setTitle] = useState(initial.title)
  const [body, setBody] = useState(initial.body)
  const [audience, setAudience] = useState<OrgAudience>(initial.audience)
  const [scheduleAt, setScheduleAt] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState<unknown>(null)

  useDirtyGuard(!sameData({ title, body, audience, scheduleAt }, initial))
  const complete = title.trim() !== "" && body.trim() !== ""
  const live = a?.publishedAt != null && new Date(a.publishedAt) <= new Date()

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    setStale(null)
    try {
      await action()
      onSaved()
    } catch (e) {
      if (isStaleUpdate(e)) setStale(e)
      else setError(errorMessage(e, "Не удалось сохранить объявление"))
    } finally {
      setBusy(false)
    }
  }

  const create = (opts: { publish?: boolean; publishAt?: string }) =>
    run(() =>
      createOrgAnnouncement({
        organizationId,
        data: { title: title.trim(), body: body.trim(), audience, ...opts },
      }),
    )

  const publish = async () => {
    if (scheduleAt) {
      await create({ publishAt: new Date(scheduleAt).toISOString() })
      return
    }
    const ok = await confirmDialog({
      title: `Опубликовать «${title.trim()}»?`,
      description: orgPublishText(audience),
      confirmLabel: "Опубликовать",
    })
    if (ok) await create({ publish: true })
  }

  const save = () =>
    a &&
    run(() =>
      updateOrgAnnouncement({
        organizationId,
        announcementId: a.id,
        data: {
          title: title.trim(),
          body: body.trim(),
          audience,
          // The version the panel opened with: a save in between answers 409.
          expectedUpdatedAt: a.updatedAt,
        },
      }),
    )

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto">
        <div className="space-y-2">
          <Label htmlFor="org-announcement-title">Заголовок</Label>
          <Input
            id="org-announcement-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={L.title.max}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="org-announcement-body">Текст объявления</Label>
          <Textarea
            id="org-announcement-body"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={L.body.max}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="org-announcement-audience">Кому</Label>
          <Select value={audience} onValueChange={(v) => setAudience(v as OrgAudience)}>
            <SelectTrigger id="org-announcement-audience">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ORG_AUDIENCES.map((value) => (
                <SelectItem key={value} value={value}>
                  {audienceLabel(value, vocabulary)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {!a && (
          <div className="space-y-2">
            <Label htmlFor="org-announcement-schedule">Опубликовать позже (необязательно)</Label>
            <Input
              id="org-announcement-schedule"
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
            />
          </div>
        )}
        {live && (
          <p className="text-xs text-muted-foreground">
            Объявление уже опубликовано: изменения увидят все, но уведомление повторно не придёт.
          </p>
        )}
        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {stale !== null && <StaleUpdateNotice error={stale} onReload={onSaved} />}
      </div>
      <SheetFooter>
        <div className="flex w-full items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
          {a ? (
            <Button type="button" disabled={busy || !complete} onClick={() => void save()}>
              {busy ? "Сохраняем…" : "Сохранить"}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={busy || !complete} onClick={() => void create({})}>
                В черновик
              </Button>
              <Button type="button" disabled={busy || !complete} onClick={() => void publish()}>
                {scheduleAt ? "Запланировать" : "Опубликовать"}
              </Button>
            </>
          )}
        </div>
      </SheetFooter>
    </>
  )
}
