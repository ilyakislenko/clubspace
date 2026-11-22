"use client"

import { useEffect, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@clubspace/ui-kit/ui"

import { signOut } from "../../../../shared/api/client"
import { fetchMe } from "../../../../shared/api/me"
import {
  confirmPlatformMfaEnrollment,
  fetchPlatformMfa,
  startPlatformMfaEnrollment,
  type PlatformMfaEnrollment,
  type PlatformMfaStatus,
} from "../../../../shared/api/platform"
import { errorMessage } from "../../../../shared/lib/error-message"
import { inputCls } from "../../../../shared/lib/input-class"

// The platform admin's authenticator app (TOTP). Reachable without the
// console's powers: a super admin signed in by e-mail code alone sets the app
// up here, then signs in again with both codes.
export default function PlatformSecurityPage() {
  const router = useRouter()
  // null while loading; false for an account that is not a platform admin.
  const [status, setStatus] = useState<PlatformMfaStatus | false | null>(null)
  const [enrollment, setEnrollment] = useState<PlatformMfaEnrollment | null>(null)
  const [code, setCode] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchMe()
      .then(async (me) => {
        const mfa = me.isSuperAdmin ? await fetchPlatformMfa() : false
        if (alive) setStatus(mfa)
      })
      .catch((e) => {
        if (!alive) return
        setStatus(false)
        setError(errorMessage(e, "Не удалось загрузить настройки защиты."))
      })
    return () => {
      alive = false
    }
  }, [])

  const handleStart = async () => {
    setBusy(true)
    setError(null)
    try {
      setEnrollment(await startPlatformMfaEnrollment())
      setCode("")
    } catch (e) {
      setError(errorMessage(e, "Не удалось получить ключ для приложения."))
    } finally {
      setBusy(false)
    }
  }

  const handleConfirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await confirmPlatformMfaEnrollment(code.trim())
      setConfirmed(true)
      setEnrollment(null)
    } catch (e) {
      setError(errorMessage(e, "Не удалось подтвердить код."))
    } finally {
      setBusy(false)
    }
  }

  // The new session must be signed in with the authenticator code.
  const handleSignInAgain = async () => {
    await signOut()
    router.replace("/sign-in")
  }

  if (status === null) {
    return <div className="p-6 text-sm text-muted-foreground">Загружаем…</div>
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Двухфакторная защита</h1>
        <p className="text-sm text-muted-foreground">
          Вход в консоль платформы — по коду из письма и коду из
          приложения-аутентификатора (Google Authenticator, Яндекс Ключ и т. п.).
        </p>
      </div>

      {status === false ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Раздел только для администраторов платформы.
        </div>
      ) : confirmed ? (
        <div className="space-y-3 rounded-md border border-emerald-600/30 bg-emerald-50 p-4 text-sm text-emerald-800">
          <p className="font-medium">Приложение подключено.</p>
          <p>
            Войдите снова: после кода из письма вход попросит код из приложения,
            и консоль платформы откроется.
          </p>
          <Button size="sm" onClick={handleSignInAgain}>
            Выйти и войти снова
          </Button>
        </div>
      ) : status.enrolled ? (
        <div className="space-y-3 rounded-md border bg-card p-4 text-sm">
          <p className="font-medium">Защита включена.</p>
          {status.accessGranted ? (
            <p className="text-muted-foreground">
              Если телефон с приложением потерян, сбросить защиту может только
              оператор сервера (deploy/README.md, «Двухфакторная защита
              администратора платформы»).
            </p>
          ) : (
            <>
              <p className="text-muted-foreground">
                Этот вход был без кода из приложения, поэтому консоль платформы
                закрыта. Войдите снова с кодом из приложения.
              </p>
              <Button size="sm" onClick={handleSignInAgain}>
                Выйти и войти снова
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4 rounded-md border bg-card p-4 text-sm">
          {!status.required && (
            <p className="text-muted-foreground">
              На этом сервере защита пока не обязательна, но без неё консоль
              платформы откроется любому, у кого есть доступ к вашей почте.
            </p>
          )}
          {enrollment ? (
            <>
              <p>
                1. Отсканируйте QR-код в приложении-аутентификаторе или введите
                ключ вручную.
              </p>
              <img
                src={enrollment.qrPngDataUrl}
                alt="QR-код для приложения-аутентификатора"
                className="h-48 w-48 rounded-md border bg-white"
              />
              <p className="break-all font-mono text-xs">{enrollment.secret}</p>
              <form className="space-y-2" onSubmit={handleConfirm}>
                <label htmlFor="mfa-code" className="block">
                  2. Введите код, который показывает приложение
                </label>
                <div className="flex gap-2">
                  <input
                    id="mfa-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className={`${inputCls} w-32 text-center font-mono tracking-widest`}
                    required
                  />
                  <Button type="submit" disabled={busy || code.trim().length !== 6}>
                    Подтвердить
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <Button onClick={handleStart} disabled={busy}>
              Подключить приложение
            </Button>
          )}
        </div>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <Button variant="ghost" size="sm" onClick={() => router.push("/platform")}>
        К консоли платформы
      </Button>
    </div>
  )
}
