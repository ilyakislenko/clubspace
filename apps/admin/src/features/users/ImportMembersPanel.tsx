"use client"

import { useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  importMembers,
  type ImportMemberRow,
  type ImportMembersResult,
} from "../../shared/api/members"
import { errorMessage } from "../../shared/lib/error-message"

// One member per line: email,firstname,lastname (name columns optional).
// Cells may be separated by comma, semicolon (Russian Excel) or tab (pasted).
// A leading "email"/"e-mail" header line is ignored.
export const parseCsv = (text: string): ImportMemberRow[] => {
  const rows: ImportMemberRow[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const cells = line.split(/[,;\t]/).map((c) => c.trim())
    const email = cells[0]
    if (!email) continue
    if (rows.length === 0 && /^e-?mail$/i.test(email)) continue // header
    rows.push({
      email,
      firstname: cells[1] || null,
      lastname: cells[2] || null,
    })
  }
  return rows
}

export function ImportMembersPanel({
  workspaceId,
  onImported,
}: {
  workspaceId: string
  onImported: () => void
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportMembersResult | null>(null)

  const rows = parseCsv(text)

  const run = async () => {
    if (rows.length === 0) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await importMembers({ workspaceId, members: rows })
      setResult(res)
      if (res.added > 0) onImported()
    } catch (err) {
      setError(errorMessage(err, "Не удалось импортировать участников"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setOpen((o) => !o)}
      >
        Импорт (CSV)
      </Button>

      {open && (
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">
            По строке на участника: <code>email,имя,фамилия</code>. Разделитель
            — запятая, точка с запятой или табуляция. Имя и фамилия
            необязательны. Уже состоящие в клубе — пропускаются.
          </p>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={"ivan@mail.ru,Иван,Петров\nmaria@mail.ru,Мария"}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary"
          />

          {error && <p className="text-sm text-destructive">{error}</p>}

          {result && (
            <div className="rounded-md border border-border bg-background p-3 text-sm">
              <p>
                Добавлено: <b>{result.added}</b> · пропущено:{" "}
                {result.skipped}
                {result.invalid.length > 0
                  ? ` · ошибок: ${result.invalid.length}`
                  : ""}
              </p>
              {result.invalid.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {result.invalid.slice(0, 10).map((r, i) => (
                    <li key={i}>
                      {r.email} — {r.reason}
                    </li>
                  ))}
                  {result.invalid.length > 10 && (
                    <li>…и ещё {result.invalid.length - 10}</li>
                  )}
                </ul>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {rows.length > 0 ? `Строк к импорту: ${rows.length}` : ""}
            </span>
            <Button
              type="button"
              size="sm"
              disabled={busy || rows.length === 0}
              onClick={() => void run()}
            >
              {busy ? "Импорт…" : "Импортировать"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
