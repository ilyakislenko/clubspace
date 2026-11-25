import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// «Отчёты → Выплаты» (club admins): what each coach earned in a club-local
// month, the coach rates, bonuses and deductions, and closing a month (the
// snapshot that later edits no longer move).
export type PayrollMonth = ApiTypes.PayrollMonthOutputOutput
export type PayrollLine = PayrollMonth["lines"][number]
export type PayrollAdjustment = PayrollLine["adjustments"][number]
export type PayrollRate = NonNullable<PayrollLine["rate"]>
export type PayrollClasses = ApiTypes.PayrollClassesOutputOutput
export type PayrollClass = PayrollClasses["items"][number]
export type CoachRates = ApiTypes.CoachRatesOutputOutput
export type CoachRateHistory = CoachRates["coaches"][number]
export type CoachRate = ApiTypes.CoachRateOutputOutput
export type CoachRateInput = ApiTypes.SetCoachRateInput
export type PayrollAdjustmentInput = ApiTypes.AddPayrollAdjustmentInput

const base = (workspaceId: string) => `/workspaces/${workspaceId}/payroll`

// `month` = YYYY-MM. A closed month answers its snapshot plus the drift.
export const getPayrollMonth = async (params: {
  workspaceId: string
  month: string
}): Promise<PayrollMonth> =>
  await getApiClient().request<PayrollMonth>({
    method: "get",
    url: base(params.workspaceId),
    params: { month: params.month },
  })

// One coach's classes of the month: counted, paid or not, substitutions and
// the ones cancelled after the roster was opened.
export const listPayrollClasses = async (params: {
  workspaceId: string
  coachId: string
  month: string
}): Promise<PayrollClasses> =>
  await getApiClient().request<PayrollClasses>({
    method: "get",
    url: `${base(params.workspaceId)}/coaches/${params.coachId}/classes`,
    params: { month: params.month },
  })

// Every staff member's rate history, newest first.
export const listCoachRates = async (params: {
  workspaceId: string
}): Promise<CoachRates> =>
  await getApiClient().request<CoachRates>({
    method: "get",
    url: `${base(params.workspaceId)}/rates`,
  })

export const setCoachRate = async (params: {
  workspaceId: string
  coachId: string
  data: CoachRateInput
}): Promise<CoachRate> =>
  await getApiClient().request<CoachRate, CoachRateInput>({
    method: "put",
    url: `${base(params.workspaceId)}/rates/${params.coachId}`,
    data: params.data,
  })

export const addPayrollAdjustment = async (params: {
  workspaceId: string
  data: PayrollAdjustmentInput
}): Promise<PayrollAdjustment> =>
  await getApiClient().request<PayrollAdjustment, PayrollAdjustmentInput>({
    method: "post",
    url: `${base(params.workspaceId)}/adjustments`,
    data: params.data,
  })

export const deletePayrollAdjustment = async (params: {
  workspaceId: string
  adjustmentId: string
}): Promise<void> => {
  await getApiClient().request<undefined, undefined>({
    method: "delete",
    url: `${base(params.workspaceId)}/adjustments/${params.adjustmentId}`,
  })
}

// `expectedTotal` / `expectedLines` = the total and per-coach sums on screen:
// any difference from the live ones answers 409.
export const closePayrollMonth = async (params: {
  workspaceId: string
  month: string
} & ApiTypes.ClosePayrollMonthInput): Promise<PayrollMonth> => {
  const { workspaceId, month, ...data } = params
  return await getApiClient().request<PayrollMonth, ApiTypes.ClosePayrollMonthInput>({
    method: "post",
    url: `${base(workspaceId)}/${month}/close`,
    data,
  })
}

export const reopenPayrollMonth = async (params: {
  workspaceId: string
  month: string
  reason: string
}): Promise<PayrollMonth> =>
  await getApiClient().request<PayrollMonth, ApiTypes.ReopenPayrollMonthInput>({
    method: "post",
    url: `${base(params.workspaceId)}/${params.month}/reopen`,
    data: { reason: params.reason },
  })
