"use client"

import { useState } from "react"

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
  Textarea,
} from "@clubspace/ui-kit/ui"

import {
  createAnnouncement,
  updateAnnouncement,
  type Announcement,
} from "../../shared/api/announcements"
import type { Direction } from "../../shared/api/directions"
import type { GroupSummary } from "../../shared/api/groups"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import {
  confirmLeave,
  sameData,
  useDirtyGuard,
} from "../../shared/lib/use-dirty-guard"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { isStaleUpdate, StaleUpdateNotice } from "../../shared/ui/stale-update-notice"
import type { DirectionScope } from "../../shared/workspace/use-direction-scope"
import { AnnouncementTargetPicker } from "./AnnouncementTargetPicker"
import {
  editTargetPayload,
  initialTarget,
  isEditTargetComplete,
  isTargetComplete,
  publishPushText,
  targetOf,
  targetPayload,
  type AnnouncementTarget,
} from "./announcement-target"

type FormProps = {
  workspaceId: string
  directions: Direction[]
  groups: GroupSummary[]
  scope: DirectionScope
  onCancel: () => void
  onSaved: () => void
}

type Props = Omit<FormProps, "onCancel" | "onSaved"> & {
  open: boolean
  onOpenChange: (open: boolean) => void
  // null = a new announcement.
  announcement: Announcement | null
  onSaved: () => void
}

// The announcement editor in a side panel: a new announcement (draft, publish
// now or later) or the text and audience of an existing one. Closing it with
// unsaved changes asks first.
export function AnnouncementFormSheet({
  open,
  onOpenChange,
  announcement,
  onSaved,
  ...form
}: Props) {
  const requestClose = async () => {
    if (await confirmLeave()) onOpenChange(false)
  }
  const saved = () => {
    onSaved()
    onOpenChange(false)
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : void requestClose())}
    >
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {announcement ? "Редактировать объявление" : "Новое объявление"}
          </SheetTitle>
          <SheetDescription>
            Опубликованные объявления видят участники в приложении; черновики —
            только персонал.
          </SheetDescription>
        </SheetHeader>
        {/* The content mounts with the open panel, so each opening starts
            from the edited announcement (or blank) and the unsaved-changes
            guard leaves with it. */}
        {announcement ? (
          <EditForm
            key={announcement.id}
            announcement={announcement}
            onCancel={() => void requestClose()}
            onSaved={saved}
            // There is no single-announcement read: «Обновить» after a 409
            // closes the panel and reloads the list (the draft is dropped
            // on purpose; the notice says so).
            onReload={saved}
            {...form}
          />
        ) : (
          <CreateForm
            onCancel={() => void requestClose()}
            onSaved={saved}
            {...form}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function CreateForm({
  workspaceId,
  directions,
  groups,
  scope,
  onCancel,
  onSaved,
}: FormProps) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [pinned, setPinned] = useState(false)
  const [scheduleAt, setScheduleAt] = useState("")
  const [target, setTarget] = useState<AnnouncementTarget>(() =>
    initialTarget(scope.defaultDirectionId),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The target alone does not count: its default arrives with the
  // membership, possibly after the panel opened.
  useDirtyGuard(
    !sameData(
      { title, body, pinned, scheduleAt },
      { title: "", body: "", pinned: false, scheduleAt: "" },
    ),
  )

  const complete = title.trim() !== "" && body.trim() !== "" && isTargetComplete(target)

  const submit = async (opts: { publish?: boolean; publishAt?: string }) => {
    if (!complete) return
    setBusy(true)
    setError(null)
    try {
      await createAnnouncement({
        workspaceId,
        data: {
          title: title.trim(),
          body: body.trim(),
          pinned,
          // Every new post goes to its whole audience: a nudge to the
          // students due for renewal is «Ученики → Сообщения → Продлить».
          ...targetPayload(target),
          ...(opts.publish ? { publish: true } : {}),
          ...(opts.publishAt ? { publishAt: opts.publishAt } : {}),
        },
      })
      onSaved()
    } catch (e) {
      setError(errorMessage(e, "Не удалось сохранить объявление"))
    } finally {
      setBusy(false)
    }
  }

  // Publishing now sends a push, so it asks first; a scheduled one is
  // published by the server later.
  const publish = async () => {
    if (scheduleAt) {
      await submit({ publishAt: new Date(scheduleAt).toISOString() })
      return
    }
    const ok = await confirmDialog({
      title: `Опубликовать «${title.trim()}»?`,
      description: publishPushText("ALL", {
        directionName:
          target.kind === "direction"
            ? (directions.find((d) => d.id === target.directionId)?.name ?? null)
            : null,
        groups:
          target.kind === "groups"
            ? groups
                .filter((g) => target.groupIds.includes(g.id))
                .map((g) => ({
                  id: g.id,
                  name: g.name,
                  gymName: g.gym?.name ?? null,
                  directionId: g.direction?.id ?? null,
                }))
            : [],
      }),
      confirmLabel: "Опубликовать",
    })
    if (ok) await submit({ publish: true })
  }

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto">
        <div className="space-y-2">
          <Label htmlFor="announcement-title">Заголовок</Label>
          <Input
            id="announcement-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={FORM_LIMITS.announcement.title.max}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="announcement-body">Текст объявления</Label>
          <Textarea
            id="announcement-body"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={FORM_LIMITS.announcement.body.max}
          />
        </div>
        <AnnouncementTargetPicker
          id="announcement-target"
          value={target}
          onChange={setTarget}
          directions={directions}
          groups={groups}
          scope={scope}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={pinned}
            onChange={(e) => setPinned(e.target.checked)}
          />
          Закрепить наверху ленты
        </label>
        <div className="space-y-2">
          <Label htmlFor="announcement-schedule">
            Опубликовать позже (необязательно)
          </Label>
          <Input
            id="announcement-schedule"
            type="datetime-local"
            value={scheduleAt}
            onChange={(e) => setScheduleAt(e.target.value)}
          />
        </div>
        {error && <FormError text={error} />}
      </div>
      <SheetFooter>
        <div className="flex w-full items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || !complete}
            onClick={() => void submit({})}
          >
            В черновик
          </Button>
          <Button
            type="button"
            disabled={busy || !complete}
            onClick={() => void publish()}
          >
            {scheduleAt ? "Запланировать" : "Опубликовать"}
          </Button>
        </div>
      </SheetFooter>
    </>
  )
}

// Group order does not matter when comparing targets.
const comparable = (t: AnnouncementTarget) => ({
  ...t,
  groupIds: [...t.groupIds].sort(),
})

function EditForm({
  workspaceId,
  directions,
  groups,
  scope,
  announcement: a,
  onCancel,
  onSaved,
  onReload,
}: FormProps & { announcement: Announcement; onReload: () => void }) {
  const [title, setTitle] = useState(a.title)
  const [body, setBody] = useState(a.body)
  const [target, setTarget] = useState<AnnouncementTarget>(() => targetOf(a))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState<unknown>(null)

  useDirtyGuard(
    !sameData(
      { title, body, target: comparable(target) },
      { title: a.title, body: a.body, target: comparable(targetOf(a)) },
    ),
  )

  const save = async () => {
    if (!title.trim() || !body.trim()) return
    setBusy(true)
    setError(null)
    setStale(null)
    try {
      await updateAnnouncement({
        workspaceId,
        announcementId: a.id,
        data: {
          title: title.trim(),
          body: body.trim(),
          ...editTargetPayload(target, a),
          // The version the panel opened with: someone else's save since
          // then answers 409 instead of being overwritten.
          expectedUpdatedAt: a.updatedAt,
        },
      })
      onSaved()
    } catch (e) {
      if (isStaleUpdate(e)) setStale(e)
      else setError(errorMessage(e, "Не удалось сохранить объявление"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto">
        <div className="space-y-2">
          <Label htmlFor="announcement-edit-title">Заголовок</Label>
          <Input
            id="announcement-edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={FORM_LIMITS.announcement.title.max}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="announcement-edit-body">Текст объявления</Label>
          <Textarea
            id="announcement-edit-body"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={FORM_LIMITS.announcement.body.max}
          />
        </div>
        <AnnouncementTargetPicker
          id={`announcement-target-${a.id}`}
          value={target}
          onChange={setTarget}
          directions={directions}
          groups={groups}
          groupsRemoved={a.groupsRemoved}
          scope={scope}
        />
        {a.publishedAt && new Date(a.publishedAt) <= new Date() && (
          <p className="text-xs text-muted-foreground">
            Объявление уже опубликовано: изменения увидят все, но уведомление
            повторно не придёт.
          </p>
        )}
        {error && <FormError text={error} />}
        {stale !== null && <StaleUpdateNotice error={stale} onReload={onReload} />}
      </div>
      <SheetFooter>
        <div className="flex w-full items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
          <Button
            type="button"
            disabled={
              busy ||
              !title.trim() ||
              !body.trim() ||
              !isEditTargetComplete(target, a)
            }
            onClick={() => void save()}
          >
            {busy ? "Сохраняем…" : "Сохранить"}
          </Button>
        </div>
      </SheetFooter>
    </>
  )
}

function FormError({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {text}
    </p>
  )
}
