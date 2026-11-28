import type { ApiTypes } from "@clubspace/api-client"

import { getApiClient } from "./client"

// «Платежи → Сверить выписку»: a bank statement matched to unpaid abonements,
// then the chosen matches marked paid by transfer. Club admins only.
export type BankStatementPreview = ApiTypes.PreviewBankStatementOutputOutput
export type BankStatementTransaction = BankStatementPreview["transactions"][number]
export type BankStatementCandidate = BankStatementTransaction["candidates"][number]
export type BankStatementColumns = NonNullable<BankStatementPreview["columns"]>
export type BankStatementReason = BankStatementCandidate["reasons"][number]
export type BankStatementFlag = BankStatementTransaction["flags"][number]
export type BankStatementMatch = ApiTypes.ConfirmBankStatementInput["matches"][number]
export type BankStatementConfirmResult = ApiTypes.ConfirmBankStatementOutputOutput

// The columns picked when a CSV/Excel export wasn't recognised (0-based).
export type BankStatementColumnPick = {
  date: number
  amount: number
  payer: number
  purpose: number | null
}

const base = (workspaceId: string) => `/workspaces/${workspaceId}/bank-statements`

// The file goes up as multipart and is read in memory; the server keeps none
// of it. The picked columns ride along when the first try asked for them.
export const previewBankStatement = async (p: {
  workspaceId: string
  file: Blob
  fileName: string
  columns?: BankStatementColumnPick | null
}) => {
  const form = new FormData()
  form.append("file", p.file, p.fileName)
  if (p.columns) {
    form.append("dateColumn", String(p.columns.date))
    form.append("amountColumn", String(p.columns.amount))
    form.append("payerColumn", String(p.columns.payer))
    if (p.columns.purpose !== null) form.append("purposeColumn", String(p.columns.purpose))
  }
  return await getApiClient().request<BankStatementPreview, FormData>({
    method: "post",
    url: `${base(p.workspaceId)}/preview`,
    data: form,
  })
}

export const confirmBankStatement = async (p: { workspaceId: string; matches: BankStatementMatch[] }) =>
  await getApiClient().request<BankStatementConfirmResult, ApiTypes.ConfirmBankStatementInput>({
    method: "post",
    url: `${base(p.workspaceId)}/confirm`,
    data: { matches: p.matches },
  })
