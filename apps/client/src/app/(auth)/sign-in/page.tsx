"use client"

import { Button } from "@clubspace/ui-kit/ui"
import { getInstanceBrand } from "@clubspace/ui-kit/brand"
import { useRouter } from "next/navigation"
import { useState, type FormEvent } from "react"

import { getAuthApi, storeAuthTokens } from "../../../shared/api/client"
import { errorCode, errorMessage } from "../../../shared/lib/error-message"

export default function SignInPage() {
  const [step, setStep] = useState<"email" | "code">("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  // The account has an authenticator app (platform admins): the server asked
  // for its code after accepting the e-mailed one; both go in again.
  const [needsTotp, setNeedsTotp] = useState(false)
  const [totp, setTotp] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleSendCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsLoading(true)
    try {
      await getAuthApi().sendAuthCode({ email, language: "RU" })
      setStep("code")
    } catch {
      setError("Не удалось отправить код. Проверьте почту и попробуйте ещё раз.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleVerifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsLoading(true)
    try {
      const response = await getAuthApi().signIn({
        email,
        code,
        ...(needsTotp ? { totp } : {}),
      })
      storeAuthTokens(response)
      router.replace("/courses")
    } catch (err) {
      if (errorCode(err) === "TFA_CODE_REQUIRED") {
        setNeedsTotp(true)
        return
      }
      // The server tells a wrong e-mailed code from a wrong authenticator code.
      setError(errorMessage(err, "Неверный код. Проверьте письмо или запросите новый."))
    } finally {
      setIsLoading(false)
    }
  }

  const handleResendCode = async () => {
    setError(null)
    setIsLoading(true)
    try {
      await getAuthApi().sendAuthCode({ email, language: "RU" })
    } catch {
      setError("Не удалось отправить код повторно.")
    } finally {
      setIsLoading(false)
    }
  }

  const brand = getInstanceBrand()

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col items-center gap-2 text-center">
            <span aria-hidden className="text-4xl">
              {brand.emoji}
            </span>
            <h1 className="text-2xl font-bold">{brand.name}</h1>
            <p className="text-balance text-sm text-muted-foreground">
              {step === "email"
                ? "Введите email чтобы войти"
                : needsTotp
                  ? "Введите код из письма и код из приложения-аутентификатора"
                  : "Мы отправили код подтверждения на почту"}
            </p>
          </div>

          {step === "email" ? (
            <form className="grid gap-6" onSubmit={handleSendCode}>
              <div className="grid gap-2">
                <label htmlFor="email" className="text-sm font-medium">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Отправляем..." : "Получить код"}
              </Button>
            </form>
          ) : (
            <div className="grid gap-6">
              <div className="flex items-center justify-between rounded-lg border bg-card p-4">
                <div className="space-y-0.5">
                  <p className="text-xs text-muted-foreground">Отправлено на</p>
                  <p className="text-sm font-medium">{email}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setStep("email")
                    setNeedsTotp(false)
                    setTotp("")
                  }}
                  disabled={isLoading}
                >
                  Изменить
                </Button>
              </div>

              <form className="grid gap-6" onSubmit={handleVerifyCode}>
                <div className="grid gap-2">
                  <label htmlFor="code" className="text-sm font-medium">
                    Код подтверждения
                  </label>
                  <input
                    id="code"
                    type="text"
                    placeholder="000000"
                    maxLength={6}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 text-center text-2xl font-mono tracking-widest shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    required
                  />
                </div>
                {needsTotp ? (
                  <div className="grid gap-2">
                    <label htmlFor="totp" className="text-sm font-medium">
                      Код из приложения-аутентификатора
                    </label>
                    <input
                      id="totp"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      maxLength={6}
                      value={totp}
                      onChange={(event) => setTotp(event.target.value)}
                      className="flex h-12 w-full rounded-md border border-input bg-transparent px-3 text-center text-2xl font-mono tracking-widest shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      autoFocus
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Google Authenticator, Яндекс Ключ или другое приложение,
                      которое вы подключили к аккаунту.
                    </p>
                  </div>
                ) : null}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Проверяем..." : "Войти"}
                </Button>
              </form>

              <div className="text-center text-sm">
                <button
                  type="button"
                  className="text-muted-foreground underline-offset-4 hover:underline"
                  onClick={handleResendCode}
                  disabled={isLoading}
                >
                  Не пришёл код? Отправить ещё раз
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
