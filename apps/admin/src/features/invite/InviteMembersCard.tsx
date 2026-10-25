"use client"

import { useEffect, useRef, useState } from "react"

import { Button } from "@clubspace/ui-kit/ui"

import {
  getWorkspaceInvite,
  rotateWorkspaceJoinCode,
  type WorkspaceInvite,
} from "../../shared/api/invites"
import { updateWorkspaceSettings } from "../../shared/api/workspaces"
import { errorMessage } from "../../shared/lib/error-message"
import { openInvitePoster } from "./invite-poster"

type CopyKey = "code" | "link"

// navigator.clipboard is missing on plain-http origins and in some webviews;
// fall back to a hidden textarea and execCommand.
const writeToClipboard = async (value: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  const area = document.createElement("textarea")
  area.value = value
  area.setAttribute("readonly", "")
  area.style.position = "fixed"
  area.style.opacity = "0"
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    document.body.removeChild(area)
  }
}

export function InviteMembersCard({
  workspaceId,
  canAdmin,
}: {
  workspaceId: string
  canAdmin: boolean
}) {
  const [invite, setInvite] = useState<WorkspaceInvite | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<CopyKey | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    getWorkspaceInvite({ workspaceId })
      .then((data) => {
        if (!cancelled) setInvite(data)
      })
      .catch((err) => {
        if (!cancelled)
          setError(errorMessage(err, "Не удалось загрузить приглашение."))
      })
    return () => {
      cancelled = true
      if (copiedTimer.current) clearTimeout(copiedTimer.current)
    }
  }, [workspaceId])

  const copy = async (key: CopyKey, value: string) => {
    if (!(await writeToClipboard(value))) {
      setError("Не удалось скопировать — выделите вручную")
      return
    }
    setCopied(key)
    if (copiedTimer.current) clearTimeout(copiedTimer.current)
    copiedTimer.current = setTimeout(() => setCopied(null), 2000)
  }

  const handleRotate = async () => {
    if (
      !window.confirm(
        "Старый код, ссылка и QR-код перестанут работать — напечатанные плакаты придётся заменить. Сменить код?",
      )
    )
      return
    setBusy(true)
    setError(null)
    try {
      setInvite(await rotateWorkspaceJoinCode({ workspaceId }))
    } catch (err) {
      setError(errorMessage(err, "Не удалось сменить код."))
    } finally {
      setBusy(false)
    }
  }

  const handleToggleAutoApprove = async () => {
    if (!invite) return
    setBusy(true)
    setError(null)
    try {
      const next = !invite.joinAutoApprove
      await updateWorkspaceSettings({ workspaceId, joinAutoApprove: next })
      setInvite({ ...invite, joinAutoApprove: next })
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить настройку."))
    } finally {
      setBusy(false)
    }
  }

  const handlePrint = () => {
    if (!invite?.joinUrl || !invite.qrPngDataUrl) return
    const opened = openInvitePoster({
      workspaceName: invite.workspaceName,
      joinCodeDisplay: invite.joinCodeDisplay,
      joinUrl: invite.joinUrl,
      qrPngDataUrl: invite.qrPngDataUrl,
      appLinks: invite.appLinks,
    })
    if (!opened) setError("Браузер заблокировал окно — разрешите всплывающие окна.")
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Пригласить учеников</h2>
        <p className="text-sm text-muted-foreground">
          Ученики ставят приложение ClubSpace, входят по e-mail и вводят код
          клуба — или наводят камеру на QR-код.
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {invite && (
        <div className="grid gap-4 sm:grid-cols-[1fr,auto]">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="select-all font-mono text-3xl font-semibold tracking-widest">
                {invite.joinCodeDisplay}
              </span>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void copy("code", invite.joinCodeDisplay)}
              >
                Скопировать код
              </Button>
              {copied === "code" && (
                <span className="text-xs text-muted-foreground">Скопировано</span>
              )}
            </div>

            {invite.joinUrl ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="min-w-0 select-all truncate text-sm">
                  {invite.joinUrl}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => void copy("link", invite.joinUrl ?? "")}
                >
                  Скопировать ссылку
                </Button>
                {copied === "link" && (
                  <span className="text-xs text-muted-foreground">
                    Скопировано
                  </span>
                )}
              </div>
            ) : (
              invite.publicUrlNotice && (
                <p className="text-xs text-amber-700">{invite.publicUrlNotice}</p>
              )
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={handlePrint}
                disabled={!invite.qrPngDataUrl}
              >
                Распечатать плакат
              </Button>
              {canAdmin && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleRotate()}
                  disabled={busy}
                >
                  Сменить код
                </Button>
              )}
            </div>

            {canAdmin && (
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={invite.joinAutoApprove}
                  aria-label="Принимать без подтверждения"
                  disabled={busy}
                  onClick={() => void handleToggleAutoApprove()}
                  className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${
                    invite.joinAutoApprove ? "bg-primary" : "bg-input"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`inline-block size-5 rounded-full bg-background shadow transition-transform ${
                      invite.joinAutoApprove
                        ? "translate-x-5"
                        : "translate-x-0.5"
                    }`}
                  />
                </button>
                <div>
                  <p className="text-sm font-medium">
                    Принимать без подтверждения
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Ученики с кодом сразу попадают в клуб. Выключено — каждую
                    заявку подтверждает администратор.
                  </p>
                </div>
              </div>
            )}
          </div>

          {invite.qrPngDataUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={invite.qrPngDataUrl}
              alt="QR-код для вступления в клуб"
              className="h-40 w-40"
            />
          )}
        </div>
      )}
    </div>
  )
}
