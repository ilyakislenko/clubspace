"use client"

import { Copy, MoreHorizontal } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@clubspace/ui-kit/ui"

import {
  eraseLead,
  getLead,
  linkLeadMember,
  setLeadStatus,
  updateLead,
  type Lead,
  type SetLeadStatusInput,
} from "../../shared/api/leads"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { formatPhone } from "../../shared/lib/phone"
import { confirmLeave, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { useWorkspaceRealtime } from "../../shared/realtime/useWorkspaceRealtime"
import { confirmDialog } from "../../shared/ui/confirm-dialog"
import { isStaleUpdate, StaleUpdateNotice } from "../../shared/ui/stale-update-notice"
import { MemberSearchPicker } from "../groups/MemberSearchPicker"
import { AddDependentForm } from "../invite/AddDependentForm"
import { InviteMemberForm } from "../invite/InviteMemberForm"
import { formatSentAt } from "../requests/request-view"
import { LeadBookForm } from "./LeadBookForm"
import { LeadDetailsForm } from "./LeadDetailsForm"
import { LeadLostForm } from "./LeadLostForm"
import {
  ACTION_LABEL,
  ageWords,
  agoLabel,
  childLine,
  consentLine,
  ERASED_NAME,
  isConflict,
  leadActions,
  SOURCE_LABEL,
  splitName,
  timeline,
  type LeadAction,
} from "./lead-view"

type Mode = "facts" | "book" | "lost" | "edit" | "add" | "link"

const NOTE = FORM_LIMITS.leadNote.staffNote

/**
 * The side panel of one trial request (`?lead=`): the person's facts, the
 * staff note and one filled next step per state; each form («Записать на
 * пробное», «Отказ…», «Изменить данные», «Добавить в клуб», «Связать с
 * учеником») swaps the body, never a panel on a panel. A 409 (someone moved
 * the lead first) reloads it and shows the server's words.
 */
export function LeadSheet({
  workspaceId,
  leadId,
  onClose,
  onChanged,
}: {
  workspaceId: string
  leadId: string | null
  onClose: () => void
  // A write here: the list reloads.
  onChanged: () => void
}) {
  const [lead, setLead] = useState<Lead | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>("facts")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The server's words after a conflict, or what just happened.
  const [notice, setNotice] = useState<string | null>(null)
  // «Ученик добавлен, но заявку не удалось связать»: offers the manual link.
  const [linkFailed, setLinkFailed] = useState(false)
  const [note, setNote] = useState("")
  const [noteStale, setNoteStale] = useState<unknown>(null)
  const [formDirty, setFormDirty] = useState(false)
  // The version the note was opened with (sent as `expectedUpdatedAt`).
  const noteVersion = useRef<string | undefined>(undefined)
  const noteBase = useRef("")

  const noteDirty = lead !== null && note.trim() !== noteBase.current.trim()
  useDirtyGuard(noteDirty || formDirty)

  // A fresh copy of the lead; the note follows it unless it is being edited.
  const apply = useCallback((next: Lead, force = false) => {
    setLead(next)
    setNote((current) => {
      if (!force && current.trim() !== noteBase.current.trim()) return current
      noteBase.current = next.staffNote ?? ""
      noteVersion.current = next.updatedAt
      return next.staffNote ?? ""
    })
  }, [])

  const reload = useCallback(async () => {
    if (!leadId) return
    try {
      apply(await getLead({ workspaceId, leadId }))
      setLoadError(null)
    } catch (e) {
      setLoadError(errorMessage(e, "Не удалось открыть заявку"))
    }
  }, [workspaceId, leadId, apply])

  useEffect(() => {
    setLead(null)
    setLoadError(null)
    setMode("facts")
    setError(null)
    setNotice(null)
    setLinkFailed(false)
    setNoteStale(null)
    setFormDirty(false)
    setNote("")
    noteBase.current = ""
    if (!leadId) return
    let alive = true
    getLead({ workspaceId, leadId })
      .then((next) => alive && apply(next, true))
      .catch((e) => alive && setLoadError(errorMessage(e, "Не удалось открыть заявку")))
    return () => {
      alive = false
    }
  }, [workspaceId, leadId, apply])

  useWorkspaceRealtime(workspaceId, ["leads"], () => void reload())

  const requestClose = async () => {
    if (await confirmLeave()) onClose()
  }

  const backToFacts = () => {
    setMode("facts")
    setFormDirty(false)
    setError(null)
  }

  const done = (next: Lead, message: string | null = null) => {
    apply(next)
    setMode("facts")
    setFormDirty(false)
    setError(null)
    setNotice(message)
    onChanged()
  }

  const failed = async (e: unknown, fallback: string) => {
    if (isConflict(e)) {
      setNotice(errorMessage(e, "Заявку уже изменили — данные обновлены"))
      setMode("facts")
      setFormDirty(false)
      await reload()
      onChanged()
    } else {
      setError(errorMessage(e, fallback))
    }
  }

  const move = async (data: Omit<SetLeadStatusInput, "from">) => {
    if (!lead) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      done(await setLeadStatus({ workspaceId, leadId: lead.id, data: { from: lead.status, ...data } }))
    } catch (e) {
      await failed(e, "Не удалось изменить статус")
    } finally {
      setBusy(false)
    }
  }

  const link = async (userId: string, added: boolean) => {
    if (!lead) return
    setBusy(true)
    setError(null)
    try {
      done(
        await linkLeadMember({ workspaceId, leadId: lead.id, userId }),
        added ? "Ученик добавлен, заявка связана с ним" : "Заявка связана с учеником",
      )
      setLinkFailed(false)
    } catch (e) {
      if (added) {
        // The member exists now; only the link is missing.
        setMode("facts")
        setFormDirty(false)
        setLinkFailed(true)
        setError(`Ученик добавлен, но заявку не удалось связать: ${errorMessage(e, "ошибка сервера")}`)
        onChanged()
      } else {
        await failed(e, "Не удалось связать заявку")
      }
    } finally {
      setBusy(false)
    }
  }

  const saveNote = async () => {
    if (!lead) return
    setBusy(true)
    setError(null)
    setNoteStale(null)
    try {
      const next = await updateLead({
        workspaceId,
        leadId: lead.id,
        data: { staffNote: note.trim() || null, expectedUpdatedAt: noteVersion.current },
      })
      apply(next, true)
      onChanged()
    } catch (e) {
      if (isStaleUpdate(e)) setNoteStale(e)
      else setError(errorMessage(e, "Не удалось сохранить заметку"))
    } finally {
      setBusy(false)
    }
  }

  const erase = async () => {
    if (!lead) return
    const ok = await confirmDialog({
      title: "Удалить данные заявки?",
      description: "Имя, телефон и комментарии сотрутся навсегда. В отчёте заявка останется без имени.",
      destructive: true,
    })
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      done(await eraseLead({ workspaceId, leadId: lead.id }), "Данные заявки удалены")
    } catch (e) {
      await failed(e, "Не удалось удалить данные")
    } finally {
      setBusy(false)
    }
  }

  const act = (action: LeadAction) => {
    setError(null)
    setNotice(null)
    switch (action) {
      case "contacted":
        return void move({ to: "CONTACTED" })
      case "came":
        return void move({ to: "CAME" })
      case "reopen":
        return void move({ to: "CONTACTED" })
      case "book":
      case "rebook":
        return setMode("book")
      case "addToClub":
        return setMode("add")
      case "link":
        return setMode("link")
      case "openMember":
        return
    }
  }

  const now = new Date()
  const erased = lead?.anonymizedAt != null
  const title = lead ? (lead.name ?? ERASED_NAME) : "Заявка на пробное"
  const child = lead ? childLine(lead) : null

  return (
    <Sheet open={leadId !== null} onOpenChange={(open) => !open && void requestClose()}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="pr-6">{title}</SheetTitle>
          <SheetDescription className={child ? "" : "sr-only"}>{child ?? "Заявка на пробное"}</SheetDescription>
        </SheetHeader>

        {loadError && !lead ? (
          <div className="space-y-3">
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {loadError}
            </p>
            <Button type="button" variant="outline" onClick={onClose}>
              Закрыть
            </Button>
          </div>
        ) : !lead ? (
          <div className="h-32 animate-pulse rounded-lg bg-muted" />
        ) : mode === "book" ? (
          <LeadBookForm
            workspaceId={workspaceId}
            lead={lead}
            busy={busy}
            error={error}
            onDirty={setFormDirty}
            onCancel={backToFacts}
            onSubmit={(data) => void move({ to: "TRIAL_BOOKED", ...data })}
          />
        ) : mode === "lost" ? (
          <LeadLostForm
            busy={busy}
            error={error}
            onDirty={setFormDirty}
            onCancel={backToFacts}
            onSubmit={(data) => void move({ to: "LOST", ...data })}
          />
        ) : mode === "edit" ? (
          <LeadDetailsForm
            workspaceId={workspaceId}
            lead={lead}
            onDirty={setFormDirty}
            onCancel={backToFacts}
            onSaved={(next) => done(next)}
            onConflict={(e) => void failed(e, "Не удалось сохранить")}
          />
        ) : mode === "add" ? (
          <div className="space-y-3">
            {lead.forChild ? (
              <AddDependentForm
                workspaceId={workspaceId}
                prefill={{
                  ...splitName(lead.childName ?? ""),
                  guardianEmail: lead.email ?? "",
                  groupId: lead.trialGroupId,
                  ageHint: lead.childAge !== null ? `по заявке: ${ageWords(lead.childAge)}` : undefined,
                }}
                onAdded={(result) => void link(result.dependentId, true)}
                onCancel={backToFacts}
              />
            ) : (
              <>
                <InviteMemberForm
                  workspaceId={workspaceId}
                  canInviteStaff={false}
                  prefill={{ ...splitName(lead.name ?? ""), email: lead.email ?? "", groupId: lead.trialGroupId }}
                  onInvited={(result) => {
                    // An existing account joins only after accepting in the
                    // app: there is no member to link yet.
                    if (result.outcome === "invited") {
                      setMode("facts")
                      setNotice(
                        "Приглашение отправлено. Когда человек примет его в приложении, свяжите заявку: «Связать с учеником».",
                      )
                    } else void link(result.userId, true)
                  }}
                />
                <Button type="button" variant="ghost" onClick={backToFacts}>
                  Отмена
                </Button>
              </>
            )}
          </div>
        ) : mode === "link" ? (
          <div className="space-y-3">
            <Label>Ученик клуба</Label>
            <MemberSearchPicker
              workspaceId={workspaceId}
              excludeIds={new Set()}
              accept={(m) => m.roleName === "user" && !m.isOwner}
              onPick={(m) => void link(m.userId, false)}
              disabled={busy}
              autoFocus
              placeholder="Имя, e-mail или телефон ученика"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="button" variant="ghost" onClick={backToFacts} disabled={busy}>
              Отмена
            </Button>
          </div>
        ) : (
          <LeadFacts
            workspaceId={workspaceId}
            lead={lead}
            now={now}
            erased={erased}
            busy={busy}
            error={error}
            notice={notice}
            linkFailed={linkFailed}
            note={note}
            noteDirty={noteDirty}
            noteStale={noteStale}
            onNote={setNote}
            onSaveNote={() => void saveNote()}
            onReloadNote={async () => {
              setNoteStale(null)
              if (!leadId) return
              apply(await getLead({ workspaceId, leadId }), true)
            }}
            onAction={act}
            onLost={() => setMode("lost")}
            onEdit={() => setMode("edit")}
            onErase={() => void erase()}
            onLinkManually={() => setMode("link")}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function LeadFacts({
  workspaceId,
  lead,
  now,
  erased,
  busy,
  error,
  notice,
  linkFailed,
  note,
  noteDirty,
  noteStale,
  onNote,
  onSaveNote,
  onReloadNote,
  onAction,
  onLost,
  onEdit,
  onErase,
  onLinkManually,
}: {
  workspaceId: string
  lead: Lead
  now: Date
  erased: boolean
  busy: boolean
  error: string | null
  notice: string | null
  linkFailed: boolean
  note: string
  noteDirty: boolean
  noteStale: unknown
  onNote: (value: string) => void
  onSaveNote: () => void
  onReloadNote: () => Promise<void>
  onAction: (action: LeadAction) => void
  onLost: () => void
  onEdit: () => void
  onErase: () => void
  onLinkManually: () => void
}) {
  const [copied, setCopied] = useState(false)
  const { primary, secondary } = leadActions(lead)
  const linkedNotBought = lead.convertedUserId !== null && lead.displayStatus !== "BOUGHT"
  const canMarkLost = !erased && lead.status !== "LOST" && lead.convertedUserId === null

  const copyPhone = async () => {
    if (!lead.phone) return
    try {
      await navigator.clipboard.writeText(lead.phone)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // No clipboard permission: the number is on screen anyway.
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-5">
      {notice && <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">{notice}</p>}

      {erased ? (
        <p className="text-sm text-muted-foreground">Имя, телефон и комментарии удалены.</p>
      ) : (
        <dl className="space-y-2 text-sm">
          {lead.phone && (
            <div className="flex items-center gap-2">
              <dt className="sr-only">Телефон</dt>
              <dd className="flex items-center gap-1">
                <a href={`tel:${lead.phone}`} className="font-medium text-primary underline-offset-4 hover:underline">
                  {formatPhone(lead.phone)}
                </a>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label="Скопировать телефон"
                  onClick={() => void copyPhone()}
                >
                  <Copy />
                </Button>
                {copied && <span className="text-xs text-muted-foreground">Скопировано</span>}
              </dd>
            </div>
          )}
          {lead.email && (
            <div>
              <dt className="sr-only">E-mail</dt>
              <dd>{lead.email}</dd>
            </div>
          )}
          {lead.directionName && (
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Направление</dt>
              <dd>{lead.directionName}</dd>
            </div>
          )}
          {lead.comment && (
            <div>
              <dt className="text-muted-foreground">Комментарий</dt>
              <dd className="whitespace-pre-line">{lead.comment}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="space-y-0.5 text-xs text-muted-foreground">
        <p>
          {SOURCE_LABEL[lead.source]} · получена {agoLabel(lead.createdAt, now)}
        </p>
        {lead.resubmittedAt && <p>Повторная заявка {formatSentAt(lead.resubmittedAt, now)}</p>}
        {!erased && <p>{consentLine(lead, now)}</p>}
      </div>

      <ol className="space-y-1 border-l border-border pl-3 text-sm">
        {timeline(lead, now).map((step) => (
          <li key={`${step.label}-${step.at}`} className="flex justify-between gap-3">
            <span>{step.label}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{step.at}</span>
          </li>
        ))}
      </ol>

      {!erased && (
        <div className="space-y-2">
          <Label htmlFor="lead-note">Заметка</Label>
          <Textarea
            id="lead-note"
            rows={3}
            value={note}
            maxLength={NOTE.max}
            placeholder="Видно только сотрудникам"
            disabled={busy}
            onChange={(e) => onNote(e.target.value)}
          />
          {noteStale !== null && <StaleUpdateNotice error={noteStale} onReload={onReloadNote} />}
          {noteDirty && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onSaveNote}>
              Сохранить заметку
            </Button>
          )}
        </div>
      )}

      {error && (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <p>{error}</p>
          {linkFailed && (
            <Button type="button" size="sm" variant="outline" onClick={onLinkManually}>
              Связать вручную
            </Button>
          )}
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-4">
        {primary === "openMember" && lead.convertedUserId ? (
          <Button asChild>
            <Link href={`/workspace/${workspaceId}/users/${lead.convertedUserId}`}>{ACTION_LABEL.openMember}</Link>
          </Button>
        ) : primary ? (
          <Button type="button" disabled={busy} onClick={() => onAction(primary)}>
            {ACTION_LABEL[primary]}
          </Button>
        ) : null}
        {secondary && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => onAction(secondary)}>
            {ACTION_LABEL[secondary]}
          </Button>
        )}
        {linkedNotBought && <span className="text-xs text-muted-foreground">В клубе, абонемент ещё не куплен</span>}
        {!erased && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" size="icon" variant="ghost" className="ml-auto" aria-label="Ещё действия с заявкой" disabled={busy}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canMarkLost && <DropdownMenuItem onSelect={onLost}>Отказ…</DropdownMenuItem>}
              <DropdownMenuItem onSelect={onEdit}>Изменить данные</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onErase}>
                Удалить данные
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
