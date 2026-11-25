"use client"

import { useEffect, useState, type FormEvent } from "react"

import {
  Button,
  Label,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Textarea,
} from "@clubspace/ui-kit/ui"

import { createLead, type Lead } from "../../shared/api/leads"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { confirmLeave, sameData, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import { LeadFields } from "./LeadDetailsForm"
import { draftToCreateInput, EMPTY_LEAD_DRAFT, validateLeadDraft, type LeadDraft } from "./lead-form"
import { duplicateLeadId } from "./lead-view"

const L = FORM_LIMITS.lead

/**
 * «Добавить заявку»: a person who called or walked in. The staff member ticks
 * that the person agreed to the club keeping the contacts (verbal consent,
 * recorded with their name). A phone already on an open request answers 409
 * with that request, which «Открыть» shows instead.
 */
export function LeadCreateSheet({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
  onOpenLead,
}: {
  workspaceId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (lead: Lead) => void
  onOpenLead: (leadId: string) => void
}) {
  const [draft, setDraft] = useState<LeadDraft>(EMPTY_LEAD_DRAFT)
  const [comment, setComment] = useState("")
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicateId, setDuplicateId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setDraft(EMPTY_LEAD_DRAFT)
    setComment("")
    setConsent(false)
    setError(null)
    setDuplicateId(null)
  }, [open])

  const dirty = open && (!sameData(draft, EMPTY_LEAD_DRAFT) || comment.trim() !== "" || consent)
  useDirtyGuard(dirty)

  const close = async () => {
    if (await confirmLeave()) onOpenChange(false)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const problem = validateLeadDraft(draft)
    if (problem) {
      setError(problem)
      return
    }
    if (!consent) {
      setError("Отметьте, что человек согласился")
      return
    }
    setBusy(true)
    setError(null)
    setDuplicateId(null)
    try {
      const lead = await createLead({ workspaceId, data: draftToCreateInput(draft, comment) })
      // Saved: nothing left to guard before the panel closes.
      setDraft(EMPTY_LEAD_DRAFT)
      setComment("")
      setConsent(false)
      onCreated(lead)
    } catch (e) {
      const existing = duplicateLeadId(e)
      setDuplicateId(existing)
      setError(existing ? "Заявка с этим телефоном уже есть" : errorMessage(e, "Не удалось добавить заявку"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? onOpenChange(true) : void close())}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Новая заявка на пробное</SheetTitle>
          <SheetDescription className="sr-only">Человек позвонил или пришёл в клуб</SheetDescription>
        </SheetHeader>
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <LeadFields
            workspaceId={workspaceId}
            draft={draft}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            disabled={busy}
          />
          <div className="space-y-1.5">
            <Label htmlFor="lead-comment">Комментарий</Label>
            <Textarea
              id="lead-comment"
              rows={3}
              value={comment}
              maxLength={L.comment.max}
              placeholder="Что человек рассказал о себе"
              disabled={busy}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            />
            Человек согласился, чтобы клуб хранил его контакты для записи на пробное
          </label>
          {error && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-destructive">
              <span>{error}</span>
              {duplicateId && (
                <Button type="button" size="sm" variant="outline" onClick={() => onOpenLead(duplicateId)}>
                  Открыть
                </Button>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !consent}>
              {busy ? "Добавляем…" : "Добавить заявку"}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void close()}>
              Отмена
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
