"use client"

import { Button } from "@clubspace/ui-kit/ui"
import { getInstanceBrand } from "@clubspace/ui-kit/brand"
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
import { errorMessage } from "../../../shared/lib/error-message"
import { inputClsFull } from "../../../shared/lib/input-class"
import { setActiveWorkspaceId } from "../../../shared/workspace/storage"

// Mirrors the server's WorkspaceType enum — the platform is multi-discipline.
const WORKSPACE_TYPES = [
  { value: "GRAPPLING", label: "Единоборства / грэпплинг" },
  { value: "FITNESS", label: "Фитнес" },
  { value: "YOGA", label: "Йога" },
  { value: "CUSTOM", label: "Другое" },
] as const

const TIMEZONES = [
  { value: "Europe/Kaliningrad", label: "Калининград (UTC+2)" },
  { value: "Europe/Moscow", label: "Москва (UTC+3)" },
  { value: "Europe/Samara", label: "Самара (UTC+4)" },
  { value: "Asia/Yekaterinburg", label: "Екатеринбург (UTC+5)" },
  { value: "Asia/Omsk", label: "Омск (UTC+6)" },
  { value: "Asia/Novosibirsk", label: "Новосибирск (UTC+7)" },
  { value: "Asia/Krasnoyarsk", label: "Красноярск (UTC+7)" },
  { value: "Asia/Irkutsk", label: "Иркутск (UTC+8)" },
  { value: "Asia/Yakutsk", label: "Якутск (UTC+9)" },
  { value: "Asia/Vladivostok", label: "Владивосток (UTC+10)" },
  { value: "Asia/Magadan", label: "Магадан (UTC+11)" },
  { value: "Asia/Kamchatka", label: "Камчатка (UTC+12)" },
  { value: "Asia/Almaty", label: "Алматы (UTC+5)" },
  { value: "Asia/Tashkent", label: "Ташкент (UTC+5)" },
  { value: "Europe/Minsk", label: "Минск (UTC+3)" },
]

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
  const [name, setName] = useState("")
  const [type, setType] = useState<string>("GRAPPLING")
  const [timezone, setTimezone] = useState("Europe/Moscow")
  const [city, setCity] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getSelfServeConfig()
      .then(setConfig)
      .catch((e) =>
        setConfigError(errorMessage(e, "Не удалось загрузить страницу. Обновите её.")),
      )
    if (getAccessToken()) setStep("club")
    // Prefill the zone from the browser when it is one we offer.
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (TIMEZONES.some((t) => t.value === local)) setTimezone(local)
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
    if (resendIn > 0 && step === "code") return
    void run(async () => {
      await getAuthApi().sendAuthCode({ email, language: "RU" })
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
    void run(async () => {
      const created = await createSelfServeWorkspace({
        name: name.trim(),
        type: type as "GRAPPLING",
        timezone,
        ...(city.trim() ? { city: city.trim() } : {}),
      })
      setActiveWorkspaceId(created.workspaceId)
      router.replace(`/workspace/${created.workspaceId}`)
    }, "Не удалось создать клуб. Попробуйте ещё раз.")
  }

  const brand = getInstanceBrand()

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span aria-hidden className="text-3xl">{brand.emoji}</span>
          <h1 className="text-2xl font-bold">Создать клуб в {brand.name}</h1>
          {config?.enabled && (
            <p className="text-balance text-sm text-muted-foreground">
              {config.trialDays} дней тарифа «{config.trialPlanName}» бесплатно — без
              карты и договора.
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
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <Button type="submit" disabled={busy}>
              Получить код
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
          <form className="grid gap-4 rounded-lg border bg-card p-4" onSubmit={createClub}>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Название клуба</span>
              <input
                className={inputClsFull}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Академия БЖЖ на Садовой"
                minLength={2}
                maxLength={255}
                required
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Чем занимаетесь</span>
              <select className={inputClsFull} value={type} onChange={(e) => setType(e.target.value)}>
                {WORKSPACE_TYPES.map((t) => (
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
            <label className="grid gap-1 text-sm">
              <span className="text-xs text-muted-foreground">
                Часовой пояс — по нему считается расписание
              </span>
              <select
                className={inputClsFull}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              >
                {TIMEZONES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? "Создаём…" : "Создать клуб"}
            </Button>
          </form>
        )}

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
