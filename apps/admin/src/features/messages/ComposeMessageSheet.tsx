"use client"

import { useEffect, useMemo, useRef, useState } from "react"

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
import { cn } from "@clubspace/ui-kit/util"

import { listGroups, type GroupSummary } from "../../shared/api/groups"
import { fetchMe } from "../../shared/api/me"
import {
  previewClubMessage,
  sendClubMessage,
  type ClubMessage,
  type ClubMessagePreview,
  type ClubMessagePreviewInput,
} from "../../shared/api/messages"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { groupOptionLabel } from "../../shared/lib/group-label"
import { inputCls } from "../../shared/lib/input-class"
import { isDirectionManager, isSportLead } from "../../shared/lib/permissions"
import { useMyMembership } from "../../shared/lib/use-my-membership"
import { useVocabulary } from "../../shared/lib/vocabulary"
import { confirmLeave, sameData, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { toggleId } from "../directions/direction-scope"
import { DirectionSelect } from "../directions/DirectionSelect"
import { useDirections } from "../directions/use-directions"
import {
  clubWallClock,
  clubWallClockToIso,
  emailAllowanceText,
  isQuietHour,
  previewSentence,
  segmentLabel,
  segmentsFor,
  studentsCount,
  toStudents,
  type Segment,
} from "./message-view"

const L = FORM_LIMITS.clubMessage
// How long the form waits after the last change before asking for a preview.
const PREVIEW_DELAY_MS = 400

// Where the panel was opened from: the audience is fixed until «Изменить».
export type ComposePrefill = {
  segment: Segment
  // MEMBERS: the student(s) written to (one = a direct message).
  memberIds?: string[]
  // The read-only «Кому» line: «Иван Петров», «Пора продлить».
  label: string
  // From «Кому позвонить»: writing counts as «Связались».
  logContact?: boolean
}

type Props = {
  workspaceId: string
  open: boolean
  // null = «Написать» from the messages list: the role's segments to pick.
  prefill: ComposePrefill | null
  onClose: () => void
  onSent: (message: ClubMessage) => void
}

/**
 * «Новое сообщение» in a side panel: who (a segment the role may use, or the
 * student it was opened for), title, text, the flags the role may set, and a
 * live preview of who gets it now. More than one recipient asks first with
 * the count; the server's refusals (limits, scope) show inline.
 */
export function ComposeMessageSheet({ open, onClose, prefill, ...rest }: Props) {
  // The audience it opened with, kept while the panel slides out (callers
  // clear their prefill on close).
  const opened = useRef(prefill)
  if (open) opened.current = prefill
  const shown = opened.current
  const requestClose = async () => {
    if (await confirmLeave()) onClose()
  }
  const direct = shown?.segment === "MEMBERS" && shown.memberIds?.length === 1
  return (
    <Sheet open={open} onOpenChange={(next) => !next && void requestClose()}>
      <SheetContent className="flex w-full flex-col gap-6 sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{direct ? "Личное сообщение" : "Новое сообщение"}</SheetTitle>
          <SheetDescription className="sr-only">
            Кому, заголовок и текст сообщения ученикам
          </SheetDescription>
        </SheetHeader>
        {/* Mounted with the open panel: each opening starts blank and the
            unsaved-changes guard leaves with it. */}
        <ComposeForm
          {...rest}
          prefill={shown}
          onClose={onClose}
          onCancel={() => void requestClose()}
        />
      </SheetContent>
    </Sheet>
  )
}

function ComposeForm({
  workspaceId,
  prefill,
  onClose,
  onCancel,
  onSent,
}: Omit<Props, "open"> & { onCancel: () => void }) {
  const vocabulary = useVocabulary()
  const membership = useMyMembership(workspaceId)
  const viewer = {
    isSportLead: isSportLead(membership),
    isDirectionManager: isDirectionManager(membership),
  }
  const managed = membership?.managedDirectionIds ?? []
  const { directions } = useDirections(workspaceId)
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [meId, setMeId] = useState<string | null>(null)

  const [fixed, setFixed] = useState(prefill !== null)
  const [segment, setSegment] = useState<Segment>(prefill?.segment ?? "ALL")
  const [directionId, setDirectionId] = useState<string | null>(null)
  const [groupIds, setGroupIds] = useState<string[]>([])
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [isService, setIsService] = useState(false)
  const [urgent, setUrgent] = useState(false)
  const [withEmail, setWithEmail] = useState(false)
  const [later, setLater] = useState(false)
  const [laterAt, setLaterAt] = useState("")

  // The last preview answer with the audience it was asked for (`audienceKey`),
  // and the last failure likewise.
  const [answer, setAnswer] = useState<{ key: string; preview: ClubMessagePreview } | null>(null)
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null)
  // The club's zone, from any answer: «Отправить позже» converts with it.
  const [timezone, setTimezone] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previewSeq = useRef(0)

  useEffect(() => {
    listGroups({ workspaceId })
      .then((res) => setGroups(res.data))
      .catch(() => setGroups([]))
    void fetchMe()
      .then((me) => setMeId(me.id))
      .catch(() => undefined)
  }, [workspaceId])

  // A coach or direction manager writes only to own groups (server rule:
  // `ownGroupsWhere`), whatever the club lets them see.
  const offeredGroups = viewer.isSportLead
    ? groups
    : groups.filter(
        (g) =>
          g.coaches.some((c) => c.userId === meId) ||
          (g.direction !== null && managed.includes(g.direction.id)),
      )
  const allowedDirectionIds = viewer.isSportLead
    ? directions.filter((d) => d.isActive).map((d) => d.id)
    : managed
  const segments = segmentsFor(viewer, {
    groups: offeredGroups.length > 0,
    directions: allowedDirectionIds.length > 0,
  })

  const pickSegment = (next: Segment) => {
    setSegment(next)
    if (next === "DIRECTION" && !directionId) setDirectionId(allowedDirectionIds[0] ?? null)
  }

  // The members of a prefilled audience; dropped once it is changed.
  const memberIds = fixed && prefill?.segment === "MEMBERS" ? (prefill.memberIds ?? []) : []
  const isDirect = segment === "MEMBERS" && memberIds.length === 1
  const tz = timezone

  // What the preview and the send share; null while the audience is incomplete.
  const audience = useMemo((): ClubMessagePreviewInput | null => {
    if (segment === "GROUPS" && groupIds.length === 0) return null
    if (segment === "DIRECTION" && !directionId) return null
    if (segment === "MEMBERS" && memberIds.length === 0) return null
    const sendAt = later && laterAt && tz ? clubWallClockToIso(laterAt, tz) : undefined
    return {
      segment,
      ...(segment === "DIRECTION" && directionId ? { directionId } : {}),
      ...(segment === "GROUPS" ? { groupIds } : {}),
      ...(segment === "MEMBERS" ? { memberIds } : {}),
      isService: viewer.isSportLead && isService,
      urgent,
      withEmail,
      ...(sendAt ? { sendAt } : {}),
    }
    // `memberIds` follows `fixed` and the prefill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, directionId, groupIds, fixed, later, laterAt, tz, viewer.isSportLead, isService, urgent, withEmail])

  const audienceKey = JSON.stringify(audience)
  useEffect(() => {
    if (!audience) return
    const seq = ++previewSeq.current
    const key = audienceKey
    const handle = setTimeout(() => {
      previewClubMessage({ workspaceId, data: audience })
        .then((p) => {
          if (seq !== previewSeq.current) return
          setAnswer({ key, preview: p })
          setTimezone(p.timezone)
          setFailure(null)
        })
        .catch((e) => {
          if (seq !== previewSeq.current) return
          setFailure({ key, message: errorMessage(e, "Не удалось посчитать получателей") })
        })
    }, PREVIEW_DELAY_MS)
    return () => clearTimeout(handle)
    // The key stands for `audience`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, audienceKey])

  // The preview of the audience on screen; null while it is being recounted
  // (a count, a confirm or a limit of the previous audience must never
  // stand for this one) or when its preview failed.
  const previewError = failure?.key === audienceKey ? failure.message : null
  const preview = !previewError && answer?.key === audienceKey ? answer.preview : null
  // The last answer, whatever it was for: what the club allows doesn't change
  // with the audience.
  const known = answer?.preview ?? null

  // The e-mail switch was turned off since: nothing to send by e-mail.
  useEffect(() => {
    if (known && !known.emailEnabled && withEmail) setWithEmail(false)
  }, [known, withEmail])

  useDirtyGuard(
    !sameData(
      { title, body, isService, urgent, withEmail, later, groupIds, fixed },
      {
        title: "",
        body: "",
        isService: false,
        urgent: false,
        withEmail: false,
        later: false,
        groupIds: [],
        fixed: prefill !== null,
      },
    ),
  )

  // The limits are the server's (domains/messages/limits.ts) and count the
  // day the message goes out; the preview says how many are left, a send past
  // them is refused anyway. Every gate below reads only the preview of the
  // audience on screen.
  const scheduled = (later && laterAt !== "") || (preview?.deferredByQuietHours ?? false)
  const limits = preview?.limits
  const spent = (what: string, next: string) =>
    scheduled
      ? `${what} на этот день закончились — выберите другой день`
      : `${what} на сегодня закончились — ${next} завтра`
  const limitText = !limits
    ? null
    : isDirect
      ? limits.directLeft === 0
        ? spent("Личные сообщения", "следующее")
        : null
      : limits.clubLeft === 0
        ? spent("Рассылки клуба", "следующая")
        : limits.senderLeft === 0
          ? spent("Ваши рассылки", "следующая")
          : null
  // Display only (the last answer, so the checkbox doesn't flicker on a recount).
  const urgentSpent = known?.limits.urgentLeft === 0 && !urgent
  const recipients = audience && preview ? preview.recipients : 0
  const complete =
    title.trim() !== "" &&
    body.trim() !== "" &&
    audience !== null &&
    recipients > 0 &&
    !limitText &&
    (!later || laterAt !== "")

  const send = async () => {
    if (!audience || !complete || !preview) return
    if (recipients > 1) {
      const night = urgent && tz !== null && isQuietHour(new Date(), tz)
      const ok = await confirmDialog({
        title: `${scheduled ? "Запланировать" : "Отправить"} ${toStudents(recipients)}?`,
        description: [
          previewSentence(preview, { scheduled: later, now: new Date() }),
          night ? "Сейчас ночь у учеников." : null,
        ]
          .filter(Boolean)
          .join(" "),
        confirmLabel: scheduled ? "Запланировать" : "Отправить",
      })
      if (!ok) return
    }
    setSending(true)
    setError(null)
    try {
      const message = await sendClubMessage({
        workspaceId,
        data: {
          ...audience,
          title: title.trim(),
          body: body.trim(),
          ...(isDirect && prefill?.logContact ? { logContact: true } : {}),
        },
      })
      onSent(message)
      onClose()
    } catch (e) {
      setError(errorMessage(e, "Не удалось отправить сообщение"))
    } finally {
      setSending(false)
    }
  }

  const allowance = preview && withEmail ? emailAllowanceText(preview) : null

  return (
    <>
      <div className="flex-1 space-y-4 overflow-y-auto text-sm">
        <div className="space-y-2">
          <Label htmlFor="message-segment">Кому</Label>
          {fixed && prefill ? (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">
                {prefill.segment === "MEMBERS" && memberIds.length === 1
                  ? prefill.label
                  : preview
                    ? `${prefill.label} · ${studentsCount(preview.recipients)}`
                    : prefill.label}
              </span>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => {
                  setFixed(false)
                  if (prefill.segment === "MEMBERS") pickSegment("ALL")
                }}
              >
                Изменить
              </Button>
            </div>
          ) : (
            <select
              id="message-segment"
              className={`${inputCls} w-full`}
              value={segment}
              onChange={(e) => pickSegment(e.target.value as Segment)}
            >
              {segments.map((s) => (
                <option key={s} value={s}>
                  {segmentLabel(s, viewer)}
                </option>
              ))}
            </select>
          )}
          {!fixed && segment === "DIRECTION" && (
            <DirectionSelect
              id="message-direction"
              label=""
              directions={directions}
              value={directionId}
              onChange={setDirectionId}
              allowedIds={allowedDirectionIds}
            />
          )}
          {!fixed && segment === "GROUPS" && (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Группы">
              {offeredGroups.map((g) => {
                const active = groupIds.includes(g.id)
                return (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={active}
                    disabled={!active && groupIds.length >= L.groupIds.max}
                    onClick={() => setGroupIds(toggleId(groupIds, g.id))}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-muted/30 text-muted-foreground hover:bg-muted/50",
                    )}
                  >
                    {groupOptionLabel(g)}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="message-title">Заголовок</Label>
          <Input
            id="message-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={L.title.max}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <Label htmlFor="message-body">Текст</Label>
            <span className="text-xs tabular-nums text-muted-foreground">
              {body.length} / {L.body.max}
            </span>
          </div>
          <Textarea
            id="message-body"
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={L.body.max}
          />
          <p className="text-xs text-muted-foreground">
            Пишите о {vocabulary.session.prepPl} клуба. Реклама сторонних товаров запрещена.
          </p>
        </div>

        <div className="space-y-2">
          {viewer.isSportLead && !isDirect && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={isService}
                onChange={(e) => setIsService(e.target.checked)}
              />
              <span>Служебное — дойдёт и тем, кто отключил сообщения клуба</span>
            </label>
          )}
          <label className={cn("flex items-start gap-2", urgentSpent && "text-muted-foreground")}>
            <input
              type="checkbox"
              className="mt-0.5"
              checked={urgent}
              disabled={urgentSpent || later}
              onChange={(e) => setUrgent(e.target.checked)}
            />
            <span>
              Срочно — отправить сейчас, даже ночью
              {urgentSpent && " (на сегодня срочные закончились)"}
            </span>
          </label>
          {known?.emailEnabled && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={withEmail}
                onChange={(e) => setWithEmail(e.target.checked)}
              />
              <span>Также отправить на e-mail</span>
            </label>
          )}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={later}
              disabled={urgent}
              onChange={(e) => {
                setLater(e.target.checked)
                if (!e.target.checked) setLaterAt("")
              }}
            />
            <span>Отправить позже</span>
          </label>
          {later && tz && (
            <div className="space-y-1 pl-6">
              <input
                type="datetime-local"
                aria-label="Когда отправить"
                className={inputCls}
                value={laterAt}
                min={clubWallClock(new Date(), tz)}
                onChange={(e) => setLaterAt(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">По времени клуба</p>
            </div>
          )}
        </div>

        {audience && (
          <div aria-live="polite" className="space-y-1 text-muted-foreground">
            {previewError ? (
              <p className="text-destructive">{previewError}</p>
            ) : preview ? (
              <>
                <p>{previewSentence(preview, { scheduled: later, now: new Date() })}</p>
                {allowance && <p>{allowance}</p>}
              </>
            ) : (
              <p>Считаем получателей…</p>
            )}
          </div>
        )}
        {limitText && <FormError text={limitText} />}
        {error && <FormError text={error} />}
      </div>
      <SheetFooter>
        <div className="flex w-full items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={sending}>
            Отмена
          </Button>
          <Button type="button" disabled={sending || !complete} onClick={() => void send()}>
            {sending ? "Отправляем…" : scheduled ? "Запланировать" : "Отправить"}
          </Button>
        </div>
      </SheetFooter>
    </>
  )
}

function FormError({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive">
      {text}
    </p>
  )
}
