import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"
import { cachedRead } from "./read-cache"

// «Ученики → Пробные» (docs/design/2026-11-26-leads.md §3.3): trial requests
// worked by sport leads. Every write publishes the `leads` realtime signal.

export type LeadsPage = ApiTypes.ListLeadsOutputOutput
export type Lead = ApiTypes.LeadOutputOutput
export type LeadCounts = LeadsPage["counts"]
export type LeadView = NonNullable<ApiTypes.ListLeadsData["query"]>["view"] & string
export type LeadSource = Lead["source"]
export type LeadStatus = Lead["status"]
export type LeadLostReason = NonNullable<Lead["lostReason"]>
export type CreateLeadInput = ApiTypes.CreateLeadInput
export type UpdateLeadInput = ApiTypes.UpdateLeadInput
export type SetLeadStatusInput = ApiTypes.SetLeadStatusInput
export type LeadConversionReport = ApiTypes.LeadConversionReportOutputOutput
export type TrialLink = ApiTypes.TrialLinkOutputOutput

const base = (workspaceId: string) => `/workspaces/${workspaceId}/leads`

export const listLeads = async (p: {
  workspaceId: string
  view?: LeadView
  source?: LeadSource
  q?: string
  curPage?: number
  perPage?: number
}): Promise<LeadsPage> =>
  getApiClient().request<LeadsPage>({
    method: "get",
    url: base(p.workspaceId),
    params: { view: p.view, source: p.source, q: p.q || undefined, curPage: p.curPage, perPage: p.perPage },
  })

// The counts behind the tab badge and the «Сегодня» row: one page of one row,
// shared in flight by the components asking at once (never kept: the
// `leads` signal reloads it).
export const getLeadCounts = (p: { workspaceId: string }): Promise<LeadCounts> =>
  cachedRead(`leads:${p.workspaceId}`, async () => (await listLeads({ ...p, perPage: 1 })).counts)

export const getLead = async (p: { workspaceId: string; leadId: string }): Promise<Lead> =>
  getApiClient().request<Lead>({ method: "get", url: `${base(p.workspaceId)}/${p.leadId}` })

export const createLead = async (p: { workspaceId: string; data: CreateLeadInput }): Promise<Lead> =>
  getApiClient().request<Lead, CreateLeadInput>({ method: "post", url: base(p.workspaceId), data: p.data })

export const updateLead = async (p: {
  workspaceId: string
  leadId: string
  data: UpdateLeadInput
}): Promise<Lead> =>
  getApiClient().request<Lead, UpdateLeadInput>({
    method: "patch",
    url: `${base(p.workspaceId)}/${p.leadId}`,
    data: p.data,
  })

export const setLeadStatus = async (p: {
  workspaceId: string
  leadId: string
  data: SetLeadStatusInput
}): Promise<Lead> =>
  getApiClient().request<Lead, SetLeadStatusInput>({
    method: "post",
    url: `${base(p.workspaceId)}/${p.leadId}/status`,
    data: p.data,
  })

export const linkLeadMember = async (p: {
  workspaceId: string
  leadId: string
  userId: string
}): Promise<Lead> =>
  getApiClient().request<Lead, ApiTypes.LinkLeadMemberInput>({
    method: "post",
    url: `${base(p.workspaceId)}/${p.leadId}/link`,
    data: { userId: p.userId },
  })

export const eraseLead = async (p: { workspaceId: string; leadId: string }): Promise<Lead> =>
  getApiClient().request<Lead>({ method: "post", url: `${base(p.workspaceId)}/${p.leadId}/erase` })

export const getLeadConversionReport = async (p: {
  workspaceId: string
  from: string
  to: string
}): Promise<LeadConversionReport> =>
  getApiClient().request<LeadConversionReport>({
    method: "get",
    url: `${base(p.workspaceId)}/report`,
    params: { from: p.from, to: p.to },
  })

export const getTrialLink = async (p: { workspaceId: string }): Promise<TrialLink> =>
  getApiClient().request<TrialLink>({ method: "get", url: `${base(p.workspaceId)}/trial-link` })
