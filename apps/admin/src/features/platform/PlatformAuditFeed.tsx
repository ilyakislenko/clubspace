"use client"

import { useCallback, useEffect, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  fetchPlatformAudit,
  type PlatformAuditEvent,
} from "../../shared/api/platform"
import { errorMessage } from "../../shared/lib/error-message"

const PER_PAGE = 20

const ACTION_LABEL: Record<string, string> = {
  "workspace.create": "Клуб создан",
  "workspace.update": "Клуб изменён",
  "workspace.transferOwner": "Клуб передан",
  "workspace.billingUpdate": "Тариф клуба изменён",
  "workspace.billingExpire": "Оплата клуба просрочена",
  "auth.storeReviewSignIn": "Вход аккаунта для проверки магазина приложений",
  "member.grantStoreReviewAccess":
    "Аккаунт проверки магазина добавлен в демо-клуб",
}

const fmtWhen = (iso: string): string =>
  new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })

// Renders the bits of metadata worth reading at a glance. The raw object is
// deliberately not dumped: it carries ids that mean nothing to a human.
const describe = (e: PlatformAuditEvent): string | null => {
  const m = (e.metadata ?? {}) as Record<string, unknown>
  if (e.action === "workspace.create") {
    const owner = typeof m.ownerEmail === "string" ? m.ownerEmail : null
    if (!owner) return null
    return m.ownerCreated === true
      ? `владельцу ${owner} (аккаунт создан)`
      : `владельцу ${owner}`
  }
  if (e.action === "workspace.transferOwner") {
    const to = typeof m.toOwnerEmail === "string" ? m.toOwnerEmail : null
    return to ? `новый владелец ${to}` : null
  }
  if (e.action === "workspace.update") {
    const parts = Object.entries(m).map(([k, v]) => {
      if (k === "isActive") return v === false ? "отключён" : "снова активен"
      if (k === "name") return `название → «${String(v)}»`
      if (k === "type") return `тип → ${String(v)}`
      if (k === "timezone") return `часовой пояс → ${String(v)}`
      return `${k} → ${String(v)}`
    })
    return parts.length ? parts.join(", ") : null
  }
  // Expire: { from: "TRIAL", to: "PAST_DUE" }. Console update: { kind,
  // from: { status, plan }, to: { status, plan } }.
  if (e.action === "workspace.billingExpire") {
    return `${String(m.from)} → ${String(m.to)}`
  }
  if (e.action === "workspace.billingUpdate") {
    const side = (v: unknown) => {
      if (typeof v !== "object" || v === null) return "?"
      const s = v as { status?: unknown; plan?: unknown }
      return `${String(s.plan)} · ${String(s.status)}`
    }
    return `${String(m.kind)}: ${side(m.from)} → ${side(m.to)}`
  }
  return null
}

// Who did what to which club, from the console. Self-contained so the platform
// page needn't thread its state.
export function PlatformAuditFeed() {
  const [events, setEvents] = useState<PlatformAuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [curPage, setCurPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const page = await fetchPlatformAudit({ curPage, perPage: PER_PAGE })
      setEvents(page.data)
      setTotal(page.total)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось загрузить журнал."))
    } finally {
      setLoading(false)
    }
  }, [curPage])

  useEffect(() => {
    void load()
  }, [load])

  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE))

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Журнал платформы</h2>
        <p className="text-sm text-muted-foreground">
          Что делали в этой консоли: создание клубов, передача владельцам,
          изменения. Действия внутри клуба — в журнале самого клуба.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && events.length === 0 ? (
        <div className="text-sm text-muted-foreground">Загрузка…</div>
      ) : events.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Пока пусто — здесь появятся действия из этой консоли.
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-md border">
          {events.map((e) => {
            const detail = describe(e)
            return (
              <li key={e.id} className="flex flex-wrap gap-x-2 px-3 py-2 text-sm">
                <span className="font-medium">
                  {ACTION_LABEL[e.action] ?? e.action}
                </span>
                <span className="text-muted-foreground">
                  {e.workspaceName ?? "— клуб удалён —"}
                </span>
                {detail && (
                  <span className="text-muted-foreground">· {detail}</span>
                )}
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {e.actorLabel ?? "—"} · {fmtWhen(e.createdAt)}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={curPage <= 1}
            onClick={() => setCurPage((p) => Math.max(1, p - 1))}
          >
            Назад
          </Button>
          <span className="text-xs text-muted-foreground">
            {curPage} / {pageCount}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={curPage >= pageCount}
            onClick={() => setCurPage((p) => Math.min(pageCount, p + 1))}
          >
            Вперёд
          </Button>
        </div>
      )}
    </section>
  )
}
