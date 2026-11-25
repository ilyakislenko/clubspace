import type { CreateLeadInput, Lead, UpdateLeadInput } from "../../shared/api/leads"
import { FORM_LIMITS } from "../../shared/lib/contract-limits"

const L = FORM_LIMITS.lead

// The person's details as typed in «Добавить заявку» and «Изменить данные».
export type LeadDraft = {
  name: string
  phone: string
  email: string
  forChild: boolean
  childName: string
  childAge: string
  directionId: string | null
}

export const EMPTY_LEAD_DRAFT: LeadDraft = {
  name: "",
  phone: "",
  email: "",
  forChild: false,
  childName: "",
  childAge: "",
  directionId: null,
}

export const leadToDraft = (lead: Lead): LeadDraft => ({
  name: lead.name ?? "",
  phone: lead.phone ?? "",
  email: lead.email ?? "",
  forChild: lead.forChild,
  childName: lead.childName ?? "",
  childAge: lead.childAge !== null ? String(lead.childAge) : "",
  directionId: lead.directionId,
})

// First problem in Russian, or null. The phone's format is the server's
// `normalizePhone` (its 400 «Проверьте номер телефона» shows as is); the
// lengths and the age range come from the contract.
export const validateLeadDraft = (d: LeadDraft): string | null => {
  if (!d.name.trim()) return "Укажите имя"
  if (!d.phone.trim()) return "Укажите телефон"
  if (d.forChild) {
    if (!d.childName.trim()) return "Укажите имя ребёнка"
    const age = Number(d.childAge)
    if (!Number.isInteger(age) || age < L.childAge.min || age > L.childAge.max) {
      return `Возраст ребёнка — от ${L.childAge.min} до ${L.childAge.max} лет`
    }
  }
  return null
}

// A new request omits what is empty (the create body takes no nulls).
export const draftToCreateInput = (d: LeadDraft, comment: string): CreateLeadInput => ({
  name: d.name.trim(),
  phone: d.phone.trim(),
  forChild: d.forChild,
  ...(d.email.trim() ? { email: d.email.trim() } : {}),
  ...(d.forChild ? { childName: d.childName.trim(), childAge: Number(d.childAge) } : {}),
  ...(d.directionId ? { directionId: d.directionId } : {}),
  ...(comment.trim() ? { comment: comment.trim() } : {}),
  consentConfirmed: true,
})

// An edit sends every field; null clears an optional one.
export const draftToUpdateInput = (d: LeadDraft, expectedUpdatedAt: string): UpdateLeadInput => ({
  name: d.name.trim(),
  phone: d.phone.trim(),
  email: d.email.trim() || null,
  forChild: d.forChild,
  childName: d.forChild ? d.childName.trim() : null,
  childAge: d.forChild ? Number(d.childAge) : null,
  directionId: d.directionId,
  expectedUpdatedAt,
})
