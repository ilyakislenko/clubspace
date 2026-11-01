"use client"

import { useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  type AiTokensList,
  type CreatedAiToken,
  createAiToken,
  listAiTokens,
  revokeAiToken,
} from "../../shared/api/ai-tokens"
import { writeToClipboard } from "../../shared/lib/clipboard"
import { errorMessage } from "../../shared/lib/error-message"
import { inputClsFull } from "../../shared/lib/input-class"
import {
  AI_DATA_MODE_LABEL,
  AI_TOKEN_STATE_LABEL,
  claudeCodeCommand,
  claudeDesktopConfig,
  cursorConfig,
  expiryLabel,
} from "./ai-assistant-config"

const fmt = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—"

type DataMode = "PSEUDONYMIZED" | "PERSONAL"

// «ИИ-ассистент»: tokens an AI client (Claude, ChatGPT, Cursor) uses to read the
// club over MCP. A token reads as its creator — admins the whole club, a
// руководитель направления their directions — and only the owner can let
// names and contacts through, after accepting the transfer warning.
export function AiAssistantCard({ workspaceId }: { workspaceId: string }) {
  const [state, setState] = useState<AiTokensList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState("Claude")
  const [dataMode, setDataMode] = useState<DataMode>("PSEUDONYMIZED")
  const [expiresInDays, setExpiresInDays] = useState<number | null>(90)
  const [accepted, setAccepted] = useState(false)
  const [created, setCreated] = useState<CreatedAiToken | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const refresh = async () => {
    try {
      setState(await listAiTokens({ workspaceId }))
    } catch (err) {
      setError(errorMessage(err, "Не удалось загрузить токены"))
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const copy = async (key: string, value: string) => {
    if (await writeToClipboard(value)) {
      setCopied(key)
      setTimeout(() => setCopied(null), 2000)
    }
  }

  const create = async () => {
    if (!state) return
    setBusy(true)
    setError(null)
    try {
      const res = await createAiToken({
        workspaceId,
        data: {
          name: name.trim(),
          dataMode,
          expiresInDays,
          scopes: ["read"],
          ...(dataMode === "PERSONAL"
            ? { personalDataWarningVersion: state.personalDataWarning.version }
            : {}),
        },
      })
      setCreated(res)
      setAccepted(false)
      setDataMode("PSEUDONYMIZED")
      await refresh()
    } catch (err) {
      setError(errorMessage(err, "Не удалось создать токен"))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (tokenId: string, tokenName: string) => {
    if (!window.confirm(`Отозвать токен «${tokenName}»? Ассистент сразу потеряет доступ.`)) return
    setBusy(true)
    setError(null)
    try {
      await revokeAiToken({ workspaceId, tokenId })
      await refresh()
    } catch (err) {
      setError(errorMessage(err, "Не удалось отозвать токен"))
    } finally {
      setBusy(false)
    }
  }

  const canCreate =
    !!state && name.trim().length > 0 && (dataMode === "PSEUDONYMIZED" || accepted) && !busy

  return (
    <section className="space-y-5 rounded-lg border border-border bg-card p-5">
      <div>
        <h2 className="text-lg font-semibold">ИИ-ассистент</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Подключите клуб к Claude, ChatGPT или Cursor и спрашивайте обычными
          словами: «кто может уйти в этом месяце», «выручка по направлениям»,
          «кого пора продлевать». Ассистент только читает данные — в пределах
          ваших прав. Каждый запрос попадает в «Историю изменений».
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {state && (
        <div className="space-y-1 text-sm">
          <div className="text-muted-foreground">Адрес MCP-сервера</div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1">{state.mcpUrl}</code>
            <Button type="button" size="sm" variant="outline" onClick={() => void copy("url", state.mcpUrl)}>
              {copied === "url" ? "Скопировано" : "Копировать"}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Не больше {state.rateLimitPerMinute} запросов в минуту на токен.
          </div>
        </div>
      )}

      {created && state && (
        <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-4 text-sm">
          <div className="font-medium">
            Токен «{created.token.name}» создан. Скопируйте его сейчас — позже его не показать.
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded bg-background px-2 py-1">{created.secret}</code>
            <Button type="button" size="sm" onClick={() => void copy("secret", created.secret)}>
              {copied === "secret" ? "Скопировано" : "Копировать"}
            </Button>
          </div>
          {[
            { key: "code", title: "Claude Code — команда в терминале", value: claudeCodeCommand(state.mcpUrl, created.secret) },
            {
              key: "desktop",
              title: "Claude Desktop — claude_desktop_config.json (нужен Node.js)",
              value: claudeDesktopConfig(state.mcpUrl, created.secret),
            },
            { key: "cursor", title: "Cursor — ~/.cursor/mcp.json", value: cursorConfig(state.mcpUrl, created.secret) },
          ].map((s) => (
            <div key={s.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{s.title}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => void copy(s.key, s.value)}>
                  {copied === s.key ? "Скопировано" : "Копировать"}
                </Button>
              </div>
              <pre className="overflow-x-auto rounded bg-background p-2 text-xs">{s.value}</pre>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            ChatGPT и другие клиенты — см. инструкцию в документации (docs/mcp.md).
          </p>
          <Button type="button" size="sm" variant="secondary" onClick={() => setCreated(null)}>
            Готово, я сохранил токен
          </Button>
        </div>
      )}

      {state && (
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Новый токен</h3>
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">Название (чтобы отличать токены)</span>
            <input className={inputClsFull} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="space-y-1 text-sm">
            <span className="text-muted-foreground">Данные участников</span>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                className="mt-1"
                checked={dataMode === "PSEUDONYMIZED"}
                onChange={() => setDataMode("PSEUDONYMIZED")}
              />
              <span>
                {AI_DATA_MODE_LABEL.PSEUDONYMIZED} — без имён, телефонов и e-mail; участники под псевдонимами.
                Рекомендуем.
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                className="mt-1"
                disabled={!state.canUsePersonalData}
                checked={dataMode === "PERSONAL"}
                onChange={() => setDataMode("PERSONAL")}
              />
              <span className={state.canUsePersonalData ? "" : "text-muted-foreground"}>
                {AI_DATA_MODE_LABEL.PERSONAL}
                {!state.canUsePersonalData && " — включает только владелец клуба"}
              </span>
            </label>
          </div>
          {dataMode === "PERSONAL" && (
            <div className="space-y-2 rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="font-medium">{state.personalDataWarning.title}</div>
              {state.personalDataWarning.text.split("\n\n").map((p) => (
                <p key={p}>{p}</p>
              ))}
              <label className="flex items-start gap-2 font-medium">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                <span>Понимаю и принимаю ответственность за передачу персональных данных</span>
              </label>
            </div>
          )}
          <label className="block space-y-1 text-sm">
            <span className="text-muted-foreground">Срок действия</span>
            <select
              className={inputClsFull}
              value={expiresInDays === null ? "" : String(expiresInDays)}
              onChange={(e) => setExpiresInDays(e.target.value === "" ? null : Number(e.target.value))}
            >
              {state.expiryDaysOptions.map((d) => (
                <option key={d} value={String(d)}>
                  {expiryLabel(d)}
                </option>
              ))}
              <option value="">{expiryLabel(null)}</option>
            </select>
          </label>
          <Button type="button" disabled={!canCreate} onClick={() => void create()}>
            Создать токен
          </Button>
        </div>
      )}

      {state && state.data.length > 0 && (
        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-semibold">Токены</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {state.data.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{t.name}</span>
                    <code className="text-xs text-muted-foreground">{t.tokenPrefix}…</code>
                    <span
                      className={
                        t.state === "active"
                          ? "rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700"
                          : "rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      }
                    >
                      {AI_TOKEN_STATE_LABEL[t.state]}
                    </span>
                    <span
                      className={
                        t.dataMode === "PERSONAL"
                          ? "rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-800"
                          : "rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      }
                    >
                      {AI_DATA_MODE_LABEL[t.dataMode]}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Создал {t.createdBy.name} · {fmt(t.createdAt)} · действует до{" "}
                    {t.expiresAt ? fmt(t.expiresAt) : "отзыва"} · последний запрос {fmt(t.lastUsedAt)}
                  </div>
                </div>
                {t.canRevoke && t.state === "active" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void revoke(t.id, t.name)}
                  >
                    Отозвать
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
