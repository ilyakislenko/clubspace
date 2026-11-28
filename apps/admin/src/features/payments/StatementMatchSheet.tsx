"use client"

import { useRef, useState, type ReactNode } from "react"

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@clubspace/ui-kit/ui"

import {
  confirmBankStatement,
  previewBankStatement,
  type BankStatementColumnPick,
  type BankStatementConfirmResult,
  type BankStatementPreview,
  type BankStatementTransaction,
} from "../../shared/api/bank-statements"
import { errorMessage } from "../../shared/lib/error-message"
import { inputCls } from "../../shared/lib/input-class"
import { confirmLeave, useDirtyGuard } from "../../shared/lib/use-dirty-guard"
import {
  amountWarning,
  candidateLabel,
  chosenMatches,
  confirmLabel,
  doublePicked,
  flagLines,
  initialPicks,
  pickedCandidate,
  previewSummary,
  reasonsLine,
  resultSummary,
  transferAmount,
  transferWhen,
  type StatementPicks,
} from "./statement-view"

const NONE = ""
const ACCEPT =
  ".txt,.csv,.xlsx,text/plain,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

type Stage = "upload" | "columns" | "review" | "done"

type Props = {
  workspaceId: string
  open: boolean
  onClose: () => void
  // Something was marked paid: the journal reloads.
  onConfirmed: () => void
}

/**
 * «Сверить выписку»: a bank statement (1C .txt, CSV or Excel) → incoming
 * transfers matched to unpaid abonements → «Отметить оплату» marks the chosen
 * ones paid by transfer on the transfer's date. Confident matches come
 * chosen; the rest wait for a pick. The file stays in this request only.
 */
export function StatementMatchSheet({ workspaceId, open, onClose, onConfirmed }: Props) {
  const [stage, setStage] = useState<Stage>("upload")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<BankStatementPreview | null>(null)
  const [columns, setColumns] = useState<Partial<BankStatementColumnPick>>({})
  const [picks, setPicks] = useState<StatementPicks>({})
  const [result, setResult] = useState<BankStatementConfirmResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sending = useRef(false)

  const chosen = preview ? chosenMatches(preview, picks) : []
  useDirtyGuard(stage === "review" && chosen.length > 0)

  const reset = () => {
    setStage("upload")
    setFile(null)
    setPreview(null)
    setColumns({})
    setPicks({})
    setResult(null)
    setError(null)
  }

  const close = async () => {
    if (!(await confirmLeave())) return
    reset()
    onClose()
  }

  const read = async (f: File, pick: BankStatementColumnPick | null) => {
    setBusy(true)
    setError(null)
    try {
      const res = await previewBankStatement({ workspaceId, file: f, fileName: f.name, columns: pick })
      setFile(f)
      setPreview(res)
      if (res.columns) {
        setColumns({
          date: res.columns.date ?? undefined,
          amount: res.columns.amount ?? undefined,
          payer: res.columns.payer ?? undefined,
          purpose: res.columns.purpose,
        })
      }
      if (res.columns && !res.columns.complete) {
        setStage("columns")
      } else {
        setPicks(initialPicks(res))
        setStage("review")
      }
    } catch (e) {
      setError(errorMessage(e, "Не удалось прочитать выписку"))
    } finally {
      setBusy(false)
    }
  }

  const readWithColumns = () => {
    const { date, amount, payer, purpose } = columns
    if (!file || date === undefined || amount === undefined || payer === undefined) return
    void read(file, { date, amount, payer, purpose: purpose ?? null })
  }

  const confirm = async () => {
    if (!preview || sending.current || chosen.length === 0) return
    sending.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await confirmBankStatement({ workspaceId, matches: chosen })
      setResult(res)
      setStage("done")
      if (res.confirmed > 0) onConfirmed()
    } catch (e) {
      setError(errorMessage(e, "Не удалось отметить оплату"))
    } finally {
      sending.current = false
      setBusy(false)
    }
  }

  const twice = doublePicked(picks)

  return (
    <Sheet open={open} onOpenChange={(o) => !o && void close()}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Сверить выписку</SheetTitle>
          <SheetDescription>
            Поступления из банковской выписки сопоставляются с неоплаченными абонементами. Файл
            не сохраняется.
          </SheetDescription>
        </SheetHeader>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {stage === "upload" && (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card p-8 text-sm text-muted-foreground hover:border-primary">
            <span className="font-medium text-foreground">
              {busy ? "Читаем выписку…" : "Выберите файл выписки"}
            </span>
            <span>Выгрузка для 1С (.txt), CSV или Excel из интернет-банка</span>
            <input
              type="file"
              accept={ACCEPT}
              aria-label="Файл выписки"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void read(f, null)
                e.target.value = ""
              }}
            />
          </label>
        )}

        {stage === "columns" && preview?.columns && (
          <ColumnPicker
            columns={preview.columns}
            value={columns}
            onChange={setColumns}
            busy={busy}
            onSubmit={readWithColumns}
          />
        )}

        {stage === "review" && preview && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm">{previewSummary(preview)}</p>
              <div className="flex gap-1">
                {preview.columns && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setStage("columns")}>
                    Изменить колонки
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm" onClick={reset}>
                  Другой файл
                </Button>
              </div>
            </div>
            {!preview.directionKnown && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                В файле не видно, где поступления, а где списания, — ничего не выбрано заранее, проверьте каждую строку.
              </p>
            )}
            <Section title="Совпадают" rows={preview.transactions.filter((t) => t.status === "MATCHED")}>
              {(t) => <PickRow key={t.fingerprint} t={t} picks={picks} twice={twice} onPick={setPicks} />}
            </Section>
            <Section title="Нужно выбрать" rows={preview.transactions.filter((t) => t.status === "AMBIGUOUS")}>
              {(t) => <PickRow key={t.fingerprint} t={t} picks={picks} twice={twice} onPick={setPicks} />}
            </Section>
            <Section title="Без пары" rows={preview.transactions.filter((t) => t.status === "UNMATCHED")}>
              {(t) => (
                <TransferLine key={t.fingerprint} t={t}>
                  <span className="text-muted-foreground">Нет неоплаченного абонемента с такой суммой или именем</span>
                </TransferLine>
              )}
            </Section>
            <Section title="Уже сверены" rows={preview.transactions.filter((t) => t.status === "ALREADY_MATCHED")}>
              {(t) => (
                <TransferLine key={t.fingerprint} t={t}>
                  <span className="text-muted-foreground">
                    {t.matchedTo ? `${t.matchedTo.memberName} · ${t.matchedTo.planName}` : "Сверен раньше"}
                  </span>
                </TransferLine>
              )}
            </Section>
            <div className="sticky bottom-0 -mx-6 mt-auto border-t border-border bg-background px-6 py-3">
              <Button
                type="button"
                disabled={busy || chosen.length === 0 || twice.size > 0}
                onClick={() => void confirm()}
              >
                {busy ? "Отмечаем…" : confirmLabel(chosen.length)}
              </Button>
            </div>
          </>
        )}

        {stage === "done" && result && preview && (
          <div className="space-y-3">
            <p className="text-sm font-medium">{resultSummary(result.confirmed)}</p>
            {result.results
              .filter((r) => r.status !== "CONFIRMED")
              .map((r) => {
                const t = preview.transactions.find((x) => x.fingerprint === r.fingerprint)
                return (
                  <p key={r.fingerprint} className="text-sm text-muted-foreground">
                    {t ? `${transferWhen(t)} · ${transferAmount(t)} — ` : ""}
                    {r.status === "ALREADY_MATCHED" ? "уже был сверен раньше" : r.message}
                  </p>
                )
              })}
            <Button type="button" onClick={() => void close()}>
              Готово
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Section({
  title,
  rows,
  children,
}: {
  title: string
  rows: BankStatementTransaction[]
  children: (t: BankStatementTransaction) => ReactNode
}) {
  if (rows.length === 0) return null
  return (
    <section className="space-y-2" aria-label={title}>
      <h3 className="text-sm font-medium text-muted-foreground">
        {title} · {rows.length}
      </h3>
      <ul className="divide-y divide-border rounded-lg border border-border">{rows.map(children)}</ul>
    </section>
  )
}

// One transfer: when, how much, from whom — and on the right what it pays.
function TransferLine({ t, children }: { t: BankStatementTransaction; children: ReactNode }) {
  const from = [t.payer, t.purpose].filter(Boolean).join(" — ")
  return (
    <li className="flex flex-col gap-2 px-3 py-2 text-sm sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 sm:w-1/2">
        <p>
          <span className="font-medium tabular-nums">{transferAmount(t)}</span>
          <span className="text-muted-foreground"> · {transferWhen(t)}</span>
        </p>
        <p className="truncate text-muted-foreground" title={from}>
          {from || "Плательщик не указан"}
        </p>
      </div>
      <div className="min-w-0 sm:w-1/2">{children}</div>
    </li>
  )
}

function PickRow({
  t,
  picks,
  twice,
  onPick,
}: {
  t: BankStatementTransaction
  picks: StatementPicks
  twice: Set<string>
  onPick: (update: (prev: StatementPicks) => StatementPicks) => void
}) {
  const picked = pickedCandidate(t, picks)
  const warnings = [
    picked && twice.has(picked.subscriptionId) ? "Этот абонемент выбран и для другого перевода" : null,
    amountWarning(t, picked),
    ...flagLines(t),
  ].filter((w): w is string => w !== null)
  return (
    <TransferLine t={t}>
      <select
        aria-label={`Абонемент для перевода ${transferAmount(t)} ${transferWhen(t)}`}
        className={`${inputCls} w-full`}
        value={picks[t.fingerprint] ?? NONE}
        onChange={(e) => {
          const id = e.target.value || null
          onPick((prev) => ({ ...prev, [t.fingerprint]: id }))
        }}
      >
        <option value={NONE}>Не отмечать</option>
        {t.candidates.map((c) => (
          <option key={c.subscriptionId} value={c.subscriptionId}>
            {candidateLabel(c)}
          </option>
        ))}
      </select>
      {picked && <p className="mt-1 text-xs text-muted-foreground">{reasonsLine(picked)}</p>}
      {warnings.map((w) => (
        <p key={w} className="mt-1 text-xs text-amber-700 dark:text-amber-400">
          {w}
        </p>
      ))}
    </TransferLine>
  )
}

const COLUMN_FIELDS = [
  { key: "date", label: "Дата", required: true },
  { key: "amount", label: "Сумма поступления", required: true },
  { key: "payer", label: "Плательщик", required: true },
  { key: "purpose", label: "Назначение платежа", required: false },
] as const

// The admin names the columns a bank's export calls something we don't know.
function ColumnPicker({
  columns,
  value,
  onChange,
  busy,
  onSubmit,
}: {
  columns: NonNullable<BankStatementPreview["columns"]>
  value: Partial<BankStatementColumnPick>
  onChange: (next: Partial<BankStatementColumnPick>) => void
  busy: boolean
  onSubmit: () => void
}) {
  const ready = value.date !== undefined && value.amount !== undefined && value.payer !== undefined
  return (
    <div className="space-y-4">
      <p className="text-sm">Укажите, в каких колонках дата, сумма и плательщик.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {COLUMN_FIELDS.map((f) => {
          const current = value[f.key]
          return (
            <label key={f.key} className="space-y-1 text-sm">
              <span className="text-xs text-muted-foreground">{f.label}</span>
              <select
                className={`${inputCls} w-full`}
                value={current === undefined || current === null ? NONE : String(current)}
                onChange={(e) => {
                  const v = e.target.value === NONE ? undefined : Number(e.target.value)
                  onChange({ ...value, [f.key]: f.required ? v : (v ?? null) })
                }}
              >
                <option value={NONE}>{f.required ? "Выберите колонку" : "Нет"}</option>
                {columns.headers.map((h, i) => (
                  <option key={i} value={String(i)}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          )
        })}
      </div>
      {columns.sample.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr>
                {columns.headers.map((h, i) => (
                  <th key={i} className="px-2 py-1 text-left font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {columns.sample.map((row, r) => (
                <tr key={r} className="border-t border-border">
                  {row.map((cell, i) => (
                    <td key={i} className="max-w-48 truncate px-2 py-1">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Button type="button" disabled={!ready || busy} onClick={onSubmit}>
        {busy ? "Читаем выписку…" : "Продолжить"}
      </Button>
    </div>
  )
}
