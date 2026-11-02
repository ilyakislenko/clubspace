"use client"

import { Button } from "@clubspace/ui-kit/ui"
import { platformBrand as brand } from "@clubspace/ui-kit/brand"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState, type FormEvent } from "react"

import {
  createSelfServeWorkspace,
  getSelfServeConfig,
  type SelfServeConfig,
} from "../../../shared/api/billing"
import {
  getAccessToken,
  getAuthApi,
  storeAuthTokens,
} from "../../../shared/api/client"
import { errorMessage, retryAfterSeconds } from "../../../shared/lib/error-message"
import { inputClsFull } from "../../../shared/lib/input-class"
import { pluralRu } from "../../../shared/lib/plural-ru"
import {
  WORKSPACE_TYPE_OPTIONS,
  type WorkspaceTypeValue,
} from "../../../shared/lib/workspace-type"
import { setActiveWorkspaceId } from "../../../shared/workspace/storage"
import { ConsentGate } from "../../../features/consent/ConsentGate"
import { isConflictError } from "../../../features/billing/billing-view"
import { LegalDocsPhrase } from "../../../features/billing/LegalDocLink"
import { TimezoneSelect } from "../../../features/settings/TimezoneSelect"
import { browserTimezone } from "../../../shared/lib/timezones"

const RESEND_COOLDOWN_SECONDS = 60

type Step = "email" | "code" | "club"

// «Создать клуб»: e-mail → code → the club wizard. A signed-in visitor skips
// straight to the wizard. The club starts on a trial; the server enforces the
// flag, the rate limit and one trial per account.
export default function SignUp() {
  const router = useRouter()
  const [config, setConfig] = useState<SelfServeConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [resendIn, setResendIn] = useState(0)
  // The server refused a code inside its resend cooldown: the notice counts
  // down with the button instead of freezing on the first number.
  const [cooldownRefused, setCooldownRefused] = useState(false)
  const [name, setName] = useState("")
  const [type, setType] = useState<WorkspaceTypeValue>("GRAPPLING")
  const [timezone, setTimezone] = useState("Europe/Moscow")
  const [city, setCity] = useState("")
  // The offer and the DPA — the editions the config named are the ones sent.
  const [acceptedLegal, setAcceptedLegal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadConfig = () =>
    getSelfServeConfig()
      .then(setConfig)
      .catch((e) =>
        setConfigError(errorMessage(e, "Не удалось загрузить страницу. Обновите её.")),
      )

  useEffect(() => {
    void loadConfig()
    if (getAccessToken()) setStep("club")
    // The club most likely sits where its creator does.
    setTimezone(browserTimezone())
  }, [])

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendIn])

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setError(null)
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      setError(errorMessage(e, fallback))
    } finally {
      setBusy(false)
    }
  }

  const sendCode = (event?: FormEvent) => {
    event?.preventDefault()
    if (resendIn > 0) return
    setCooldownRefused(false)
    void run(async () => {
      try {
        await getAuthApi().sendAuthCode({ email, language: "RU" })
      } catch (e) {
        const wait = retryAfterSeconds(e)
        if (!wait) throw e
        setResendIn(wait)
        setCooldownRefused(true)
        return
      }
      setStep("code")
      setResendIn(RESEND_COOLDOWN_SECONDS)
    }, "Не удалось отправить код. Проверьте email и попробуйте ещё раз.")
  }

  const verifyCode = (event: FormEvent) => {
    event.preventDefault()
    void run(async () => {
      storeAuthTokens(await getAuthApi().signIn({ email, code }))
      setStep("club")
    }, "Не удалось войти. Попробуйте ещё раз.")
  }

  const createClub = (event: FormEvent) => {
    event.preventDefault()
    if (!config || !acceptedLegal) return
    setError(null)
    setBusy(true)
    void (async () => {
      try {
        const created = await createSelfServeWorkspace({
          name: name.trim(),
          type,
          timezone,
          ...(city.trim() ? { city: city.trim() } : {}),
          offerVersion: config.offerVersion,
          dpaVersion: config.dpaVersion,
        })
        setActiveWorkspaceId(created.workspaceId)
        router.replace(`/workspace/${created.workspaceId}`)
      } catch (e) {
        setError(errorMessage(e, "Не удалось создать клуб. Попробуйте ещё раз."))
        // The editions changed meanwhile: show the new ones and ask again.
        if (isConflictError(e)) {
          setAcceptedLegal(false)
          await loadConfig()
        }
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span aria-hidden className="text-3xl">{brand.emoji}</span>
          <h1 className="text-2xl font-bold">Создать клуб в {brand.name}</h1>
          {config?.enabled && (
            <p className="text-balance text-sm text-muted-foreground">
              {config.trialDays}{" "}
              {pluralRu(config.trialDays, "день", "дня", "дней")} бесплатно — все
              модули включены, без карты и бумажного договора.
            </p>
          )}
        </div>

        {configError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {configError}
          </p>
        ) : !config ? (
          <p className="text-center text-sm text-muted-foreground">Загрузка…</p>
        ) : !config.enabled ? (
          <div className="space-y-3 rounded-lg border bg-card p-4 text-sm">
            <p>
              Самостоятельная регистрация клубов сейчас закрыта. Напишите нам — мы
              подключим ваш клуб вручную.
            </p>
            <Link href="/sign-in" className="font-medium underline underline-offset-4">
              Уже есть клуб? Войти
            </Link>
          </div>
        ) : step === "email" ? (
          <form className="grid gap-4" onSubmit={sendCode}>
            <label className="grid gap-2 text-sm font-medium">
              Ваш email
              <input
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                className={inputClsFull}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  // The cooldown belongs to the address it was asked for.
                  setResendIn(0)
                  setCooldownRefused(false)
                }}
                required
              />
            </label>
            <Button type="submit" disabled={busy || resendIn > 0}>
              {resendIn > 0 ? `Получить код через ${resendIn} с` : "Получить код"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Уже есть клуб?{" "}
              <Link href="/sign-in" className="underline underline-offset-4">
                Войти
              </Link>
            </p>
          </form>
        ) : step === "code" ? (
          <form className="grid gap-4" onSubmit={verifyCode}>
            <p className="text-sm text-muted-foreground">
              Код отправлен на <span className="font-medium text-foreground">{email}</span>
            </p>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 text-center font-mono text-2xl tracking-widest"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <Button type="submit" disabled={busy}>
              Продолжить
            </Button>
            <button
              type="button"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline disabled:opacity-60"
              onClick={() => sendCode()}
              disabled={busy || resendIn > 0}
            >
              {resendIn > 0 ? `Отправить ещё раз через ${resendIn} с` : "Отправить код ещё раз"}
            </button>
          </form>
        ) : (
          // The API refuses a new account until it has accepted the
          // personal-data consent; the gate asks for it before the wizard.
          <ConsentGate>
          <form className="grid gap-4 rounded-lg border bg-card p-4" onSubmit={createClub}>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Название клуба</span>
              <input
                className={inputClsFull}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Студия на Садовой"
                minLength={2}
                maxLength={255}
                required
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Чем занимаетесь</span>
              <select
                className={inputClsFull}
                value={type}
                onChange={(e) => setType(e.target.value as WorkspaceTypeValue)}
              >
                {WORKSPACE_TYPE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Город</span>
              <input
                className={inputClsFull}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Москва"
                maxLength={120}
              />
            </label>
            <div className="grid gap-1 text-sm">
              <label htmlFor="signup-timezone" className="text-xs text-muted-foreground">
                Часовой пояс — по нему считается расписание
              </label>
              <TimezoneSelect
                id="signup-timezone"
                value={timezone}
                onChange={setTimezone}
              />
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0"
                checked={acceptedLegal}
                onChange={(e) => setAcceptedLegal(e.target.checked)}
                required
              />
              <span>
                Я принимаю{" "}
                <LegalDocsPhrase
                  offerVersion={config.offerVersion}
                  dpaVersion={config.dpaVersion}
                />
              </span>
            </label>
            <Button type="submit" disabled={busy || !acceptedLegal}>
              {busy ? "Создаём…" : "Создать клуб"}
            </Button>
          </form>
          </ConsentGate>
        )}

        {cooldownRefused && resendIn > 0 ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Новый код можно запросить через {resendIn} с
          </p>
        ) : (
          error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )
        )}
      </div>
    </div>
  )
}
