"use client"

import { useRef, useState, type FormEvent } from "react"

import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"

import { updateLead, type Lead } from "../../shared/api/leads"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"
import { errorMessage } from "../../shared/lib/error-message"
import { sameData } from "../../shared/lib/use-dirty-guard"
import { isStaleUpdate, StaleUpdateNotice } from "../../shared/ui/stale-update-notice"
import { useDirections } from "../directions/use-directions"
import { draftToUpdateInput, leadToDraft, validateLeadDraft, type LeadDraft } from "./lead-form"
import { isConflict } from "./lead-view"

const L = FORM_LIMITS.lead
const NO_DIRECTION = "none"

// The person's fields, shared by «Добавить заявку» and «Изменить данные».
export function LeadFields({
  workspaceId,
  draft,
  onChange,
  disabled,
}: {
  workspaceId: string
  draft: LeadDraft
  onChange: (patch: Partial<LeadDraft>) => void
  disabled: boolean
}) {
  const { directions } = useDirections(workspaceId)
  const active = directions.filter((d) => d.isActive || d.id === draft.directionId)
  const selected = directions.find((d) => d.id === draft.directionId)

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="lead-name">Имя*</Label>
        <Input
          id="lead-name"
          value={draft.name}
          maxLength={L.name.max}
          disabled={disabled}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="lead-phone">Телефон*</Label>
          <Input
            id="lead-phone"
            type="tel"
            placeholder="+7"
            value={draft.phone}
            maxLength={L.phone.max}
            disabled={disabled}
            onChange={(e) => onChange({ phone: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lead-email">E-mail</Label>
          <Input
            id="lead-email"
            type="email"
            value={draft.email}
            maxLength={L.email.max}
            disabled={disabled}
            onChange={(e) => onChange({ email: e.target.value })}
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.forChild}
          disabled={disabled}
          onChange={(e) => onChange({ forChild: e.target.checked })}
        />
        Заявка для ребёнка
      </label>
      {draft.forChild && (
        <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
          <div className="space-y-1.5">
            <Label htmlFor="lead-child-name">Имя ребёнка*</Label>
            <Input
              id="lead-child-name"
              value={draft.childName}
              maxLength={L.childName.max}
              disabled={disabled}
              onChange={(e) => onChange({ childName: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-child-age">Возраст*</Label>
            <Input
              id="lead-child-age"
              inputMode="numeric"
              value={draft.childAge}
              disabled={disabled}
              onChange={(e) => onChange({ childAge: e.target.value.replace(/\D/g, "").slice(0, 2) })}
            />
          </div>
        </div>
      )}
      {active.length > 0 && (
        <div className="space-y-1.5">
          <Label>Направление</Label>
          <Select
            value={draft.directionId ?? NO_DIRECTION}
            onValueChange={(v) => onChange({ directionId: v === NO_DIRECTION ? null : v })}
          >
            <SelectTrigger disabled={disabled}>
              <SelectValue>{selected?.name ?? "Не выбрано"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_DIRECTION}>Не выбрано</SelectItem>
              {active.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}

// «Изменить данные»: the person's details, with the version the form opened
// with; a 409 keeps the draft and offers «Обновить».
export function LeadDetailsForm({
  workspaceId,
  lead,
  onDirty,
  onCancel,
  onSaved,
  onConflict,
}: {
  workspaceId: string
  lead: Lead
  onDirty: (dirty: boolean) => void
  onCancel: () => void
  onSaved: (lead: Lead) => void
  // Any other 409 (the data was erased meanwhile): the panel reloads.
  onConflict: (error: unknown) => void
}) {
  const opened = useRef({ draft: leadToDraft(lead), version: lead.updatedAt })
  const [draft, setDraft] = useState(opened.current.draft)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState<unknown>(null)

  const edit = (patch: Partial<LeadDraft>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    onDirty(!sameData(next, opened.current.draft))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const problem = validateLeadDraft(draft)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    setStale(null)
    try {
      const next = await updateLead({
        workspaceId,
        leadId: lead.id,
        data: draftToUpdateInput(draft, opened.current.version),
      })
      onDirty(false)
      onSaved(next)
    } catch (e) {
      if (isStaleUpdate(e)) setStale(e)
      else if (isConflict(e)) onConflict(e)
      else setError(errorMessage(e, "Не удалось сохранить"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="space-y-4" onSubmit={(e) => void submit(e)}>
      <LeadFields workspaceId={workspaceId} draft={draft} onChange={edit} disabled={busy} />
      {stale !== null && (
        <StaleUpdateNotice
          error={stale}
          onReload={() => {
            // The panel reloads the lead; this form starts again from it.
            onDirty(false)
            onCancel()
          }}
        />
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Сохраняем…" : "Сохранить"}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </form>
  )
}
