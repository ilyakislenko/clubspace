"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { platformBrand as brand } from "@clubspace/ui-kit/brand"
import { Button } from "@clubspace/ui-kit/ui"

import { environment } from "../../environments/environment"
import { onConsentRequired, signOut } from "../../shared/api/client"
import {
  acceptMyConsent,
  getMyConsent,
  type MyConsent,
} from "../../shared/api/consent"
import { isConsentConflictError } from "../../shared/lib/consent-required"
import { errorMessage } from "../../shared/lib/error-message"
import { clearActiveWorkspaceId } from "../../shared/workspace/storage"

type GateState =
  | { status: "checking" }
  | { status: "failed"; error: string }
  | { status: "required"; consent: MyConsent }
  | { status: "accepted" }

// Blocks the whole dashboard — club panel and platform console alike — until
// the account has accepted the current edition of the personal-data consent.
// Children mount only after that, so no club data is requested before it; the
// API would refuse it anyway (403 CONSENT_REQUIRED). A 403 CONSENT_REQUIRED
// later in the session (the edition was bumped) brings the gate back.
export function ConsentGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>({ status: "checking" })
  const [notice, setNotice] = useState<string | null>(null)
  // Several screens can hit CONSENT_REQUIRED at once; ask the server once.
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setState((s) => (s.status === "required" ? s : { status: "checking" }))
    try {
      const consent = await getMyConsent()
      setState(
        consent.required
          ? { status: "required", consent }
          : { status: "accepted" },
      )
    } catch (e) {
      setState({
        status: "failed",
        error: errorMessage(e, "Не удалось проверить согласие на обработку данных."),
      })
    } finally {
      inFlight.current = false
    }
  }, [])

  useEffect(() => {
    void load()
    return onConsentRequired(() => void load())
  }, [load])

  const accept = async (version: string) => {
    setNotice(null)
    try {
      await acceptMyConsent({ version })
      setState({ status: "accepted" })
    } catch (e) {
      if (isConsentConflictError(e)) {
        // The edition changed while the user was reading: show the new one.
        setNotice("Текст согласия обновился — ознакомьтесь с новой редакцией.")
        await load()
        return
      }
      setNotice(errorMessage(e, "Не удалось сохранить согласие. Попробуйте ещё раз."))
    }
  }

  if (state.status === "accepted") return <>{children}</>

  if (state.status === "checking") {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        Проверяем сессию…
      </div>
    )
  }

  if (state.status === "failed") {
    return (
      <GateFrame>
        <p className="text-sm text-destructive">{state.error}</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void load()}>Повторить</Button>
          <SignOutButton />
        </div>
      </GateFrame>
    )
  }

  return (
    <ConsentScreen
      key={state.consent.currentVersion}
      consent={state.consent}
      notice={notice}
      onAccept={accept}
    />
  )
}

function GateFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-xl space-y-5 rounded-lg border bg-card p-6 shadow-sm">
        {children}
      </div>
    </div>
  )
}

function SignOutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <Button
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        clearActiveWorkspaceId()
        await signOut()
        router.replace("/sign-in")
      }}
    >
      Выйти
    </Button>
  )
}

function ConsentScreen({
  consent,
  notice,
  onAccept,
}: {
  consent: MyConsent
  notice: string | null
  onAccept: (version: string) => Promise<void>
}) {
  const [agreed, setAgreed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const appUrl = environment.publicAppUrl

  const submit = async () => {
    setSubmitting(true)
    try {
      await onAccept(consent.currentVersion)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <GateFrame>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">
          Согласие на обработку персональных данных
        </h1>
        <p className="text-sm text-muted-foreground">
          {consent.acceptedVersion
            ? `Текст согласия обновился (редакция ${consent.currentVersion}). Чтобы продолжить работу в ${brand.name}, примите новую редакцию.`
            : `Чтобы продолжить работу в ${brand.name}, нужно ваше согласие на обработку персональных данных (152-ФЗ).`}
        </p>
      </div>

      <div className="space-y-2 text-sm">
        <p>
          <span className="font-medium">Что обрабатываем:</span> имя, email,
          телефон (если указан), членство и роли в клубах, посещения,
          абонементы и оплаты, аттестации, журнал действий.
        </p>
        <p>
          <span className="font-medium">Зачем:</span> чтобы вы могли входить в
          аккаунт и работать с клубом, а клуб — вести учёт участников,
          посещений и оплат.
        </p>
        {appUrl ? (
          <a
            href={`${appUrl}/legal/consent`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block font-medium text-primary underline-offset-4 hover:underline"
          >
            Полный текст согласия
          </a>
        ) : (
          <p className="text-muted-foreground">
            Полный текст согласия опубликован на сайте приложения в разделе
            /legal/consent (публичный адрес приложения не настроен).
          </p>
        )}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
        />
        <span>
          Я даю согласие на обработку моих персональных данных на условиях,
          изложенных в тексте согласия
        </span>
      </label>

      {notice && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {notice}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button disabled={!agreed || submitting} onClick={() => void submit()}>
          Принять
        </Button>
        <SignOutButton />
      </div>

      <p className="text-xs text-muted-foreground">
        Без согласия пользоваться сервисом нельзя. Отказаться от согласия или
        отозвать его можно только вместе с удалением аккаунта: в приложении
        клуба — Настройки → Удалить аккаунт
        {appUrl ? (
          <>
            {" "}
            (
            <a
              href={`${appUrl}/legal/delete-account`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              как удалить аккаунт
            </a>
            )
          </>
        ) : null}
        .
      </p>
    </GateFrame>
  )
}
