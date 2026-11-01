"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@clubspace/ui-kit/ui"

import {
  checkPaymentConnection,
  disconnectPayments,
  getPaymentSettings,
  updatePaymentSettings,
  type PaymentConnectionCheck,
  type PaymentMode,
  type PaymentProvider,
  type PaymentSettings,
  type PaymentSettingsInput,
  type PaymentSubject,
} from "../../shared/api/payments"
import { writeToClipboard } from "../../shared/lib/clipboard"
import { errorMessage } from "../../shared/lib/error-message"
import { inputClsFull } from "../../shared/lib/input-class"
import {
  PAYMENT_MODE_LABEL,
  PAYMENT_SUBJECT_LABEL,
  PROVIDER_LABEL,
  VAT_OPTIONS,
  formatDateTime,
} from "./payment-labels"

const PROVIDERS: PaymentProvider[] = ["YOOKASSA", "STRIPE"]

const WEBHOOK_HELP: Record<
  PaymentProvider,
  { where: string; events: string[] }
> = {
  YOOKASSA: {
    where: "Личный кабинет → Интеграция → HTTP-уведомления",
    events: ["payment.succeeded", "payment.canceled"],
  },
  STRIPE: {
    where: "Developers → Webhooks",
    events: [
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
    ],
  },
}

export function PaymentSettingsCard({ workspaceId }: { workspaceId: string }) {
  const [settings, setSettings] = useState<PaymentSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [provider, setProvider] = useState<PaymentProvider>("YOOKASSA")
  const [shopId, setShopId] = useState("")
  const [secretKey, setSecretKey] = useState("")
  const [webhookSecret, setWebhookSecret] = useState("")
  const [receiptEnabled, setReceiptEnabled] = useState(false)
  const [vatCode, setVatCode] = useState(1)
  const [paymentSubject, setPaymentSubject] = useState<PaymentSubject>("service")
  const [paymentMode, setPaymentMode] =
    useState<PaymentMode>("full_prepayment")

  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<PaymentConnectionCheck | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [copied, setCopied] = useState(false)

  // Mirror the saved settings into the form. Secrets are write-only, so the
  // secret inputs always start empty («не менять»).
  const applySettings = useCallback((s: PaymentSettings) => {
    setSettings(s)
    // `provider` is null at runtime while disconnected (generator quirk).
    setProvider(s.connected ? s.provider : "YOOKASSA")
    setShopId(s.shopId ?? "")
    setSecretKey("")
    setWebhookSecret("")
    setReceiptEnabled(s.receiptEnabled)
    setVatCode(s.vatCode)
    setPaymentSubject(s.paymentSubject)
    setPaymentMode(s.paymentMode)
  }, [])

  useEffect(() => {
    let alive = true
    setLoading(true)
    getPaymentSettings({ workspaceId })
      .then((s) => {
        if (!alive) return
        applySettings(s)
        setError(null)
      })
      .catch((e) => {
        if (alive) setError(errorMessage(e, "Не удалось загрузить настройки оплаты"))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [workspaceId, applySettings])

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
        Загрузка…
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {error ?? "Не удалось загрузить настройки оплаты"}
      </div>
    )
  }

  const connected = settings.connected
  // Saved secrets can be kept only while the provider stays the same; the
  // server demands fresh keys on first connect and on a provider switch.
  const keepSecrets = connected && settings.provider === provider
  const isYookassa = provider === "YOOKASSA"
  const webhookUrl = isYookassa
    ? settings.webhookUrls.yookassa
    : settings.webhookUrls.stripe
  const help = WEBHOOK_HELP[provider]

  const canSave =
    !saving &&
    (!isYookassa || shopId.trim() !== "") &&
    (keepSecrets || secretKey.trim() !== "") &&
    (isYookassa || keepSecrets || webhookSecret.trim() !== "")

  const onSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    const data: PaymentSettingsInput = { provider }
    if (secretKey.trim()) data.secretKey = secretKey.trim()
    if (isYookassa) {
      data.shopId = shopId.trim()
      data.receiptEnabled = receiptEnabled
      data.vatCode = vatCode
      data.paymentSubject = paymentSubject
      data.paymentMode = paymentMode
    } else if (webhookSecret.trim()) {
      data.webhookSecret = webhookSecret.trim()
    }
    setSaving(true)
    setNotice(null)
    try {
      applySettings(await updatePaymentSettings({ workspaceId, data }))
      setCheck(null)
      setError(null)
      setNotice("Настройки сохранены. Проверьте подключение.")
    } catch (err) {
      setError(errorMessage(err, "Не удалось сохранить настройки оплаты"))
    } finally {
      setSaving(false)
    }
  }

  const onCheck = async () => {
    setChecking(true)
    setNotice(null)
    try {
      const result = await checkPaymentConnection({ workspaceId })
      setCheck(result)
      if (result.verifiedAt) {
        setSettings((s) => (s ? { ...s, verifiedAt: result.verifiedAt } : s))
      }
      setError(null)
    } catch (err) {
      setCheck(null)
      setError(errorMessage(err, "Не удалось проверить подключение"))
    } finally {
      setChecking(false)
    }
  }

  const onDisconnect = async () => {
    if (
      !window.confirm(
        "Отключить онлайн-оплату? Участники не смогут покупать абонементы в приложении, сохранённые ключи будут удалены.",
      )
    )
      return
    setDisconnecting(true)
    setNotice(null)
    try {
      applySettings(await disconnectPayments({ workspaceId }))
      setCheck(null)
      setError(null)
      setNotice("Онлайн-оплата отключена")
    } catch (err) {
      setError(errorMessage(err, "Не удалось отключить онлайн-оплату"))
    } finally {
      setDisconnecting(false)
    }
  }

  const onCopy = async () => {
    if (await writeToClipboard(webhookUrl)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } else {
      setError("Не удалось скопировать — выделите адрес и скопируйте вручную")
    }
  }

  const secretPlaceholder = keepSecrets ? "Не менять" : ""

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">Платёжная система</div>
        {connected ? (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
            {PROVIDER_LABEL[settings.provider]} подключена
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-700 ring-1 ring-inset ring-zinc-600/20">
            Не подключена
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Деньги поступают напрямую на счёт клуба в выбранной платёжной системе —
        ClubSpace их не получает и не хранит.
      </p>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-md border border-emerald-600/30 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </div>
      )}

      <form onSubmit={onSave} className="space-y-4">
        <div className="flex gap-2">
          {PROVIDERS.map((p) => (
            <Button
              key={p}
              type="button"
              variant={provider === p ? "default" : "outline"}
              onClick={() => {
                setProvider(p)
                setSecretKey("")
                setWebhookSecret("")
                setCheck(null)
              }}
            >
              {PROVIDER_LABEL[p]}
            </Button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {isYookassa && (
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">
                Идентификатор магазина (shopId)
              </span>
              <input
                className={inputClsFull}
                inputMode="numeric"
                placeholder="123456"
                value={shopId}
                onChange={(e) => setShopId(e.target.value)}
              />
            </label>
          )}
          <label className="space-y-1">
            <span className="text-xs text-muted-foreground">
              Секретный ключ
            </span>
            <input
              className={inputClsFull}
              type="password"
              autoComplete="new-password"
              placeholder={
                secretPlaceholder || (isYookassa ? "live_… или test_…" : "sk_live_… или sk_test_…")
              }
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
            />
            {keepSecrets && settings.secretKeyMasked && (
              <span className="block text-xs text-muted-foreground">
                Сохранён ключ {settings.secretKeyMasked}. Оставьте поле пустым,
                чтобы не менять его.
              </span>
            )}
          </label>
          {!isYookassa && (
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">
                Секрет подписи вебхука (Signing secret)
              </span>
              <input
                className={inputClsFull}
                type="password"
                autoComplete="new-password"
                placeholder={secretPlaceholder || "whsec_…"}
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
              />
              {keepSecrets && settings.webhookSecretSet && (
                <span className="block text-xs text-muted-foreground">
                  Секрет сохранён. Оставьте поле пустым, чтобы не менять его.
                </span>
              )}
            </label>
          )}
        </div>

        {isYookassa && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={receiptEnabled}
                onChange={(e) => setReceiptEnabled(e.target.checked)}
              />
              Передавать данные для чека (54-ФЗ)
            </label>
            <p className="text-xs text-muted-foreground">
              Включите, если в ЮKassa подключена онлайн-касса или «Чеки от
              ЮKassa». Email участника уйдёт в чек.
            </p>
            {receiptEnabled && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Ставка НДС
                  </span>
                  <Select
                    value={String(vatCode)}
                    onValueChange={(v) => setVatCode(Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Ставка НДС" />
                    </SelectTrigger>
                    <SelectContent>
                      {VAT_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={String(o.value)}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Предмет расчёта
                  </span>
                  <Select
                    value={paymentSubject}
                    onValueChange={(v) => setPaymentSubject(v as PaymentSubject)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Предмет расчёта" />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.keys(PAYMENT_SUBJECT_LABEL) as PaymentSubject[]
                      ).map((k) => (
                        <SelectItem key={k} value={k}>
                          {PAYMENT_SUBJECT_LABEL[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Способ расчёта
                  </span>
                  <Select
                    value={paymentMode}
                    onValueChange={(v) => setPaymentMode(v as PaymentMode)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Способ расчёта" />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PAYMENT_MODE_LABEL) as PaymentMode[]).map(
                        (k) => (
                          <SelectItem key={k} value={k}>
                            {PAYMENT_MODE_LABEL[k]}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!canSave}>
            {saving ? "Сохранение…" : connected ? "Сохранить" : "Подключить"}
          </Button>
          {connected && (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={checking || !keepSecrets}
                onClick={() => void onCheck()}
              >
                {checking ? "Проверяем…" : "Проверить подключение"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={disconnecting}
                onClick={() => void onDisconnect()}
              >
                {disconnecting ? "Отключение…" : "Отключить"}
              </Button>
            </>
          )}
        </div>
      </form>

      {check && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            check.ok
              ? "border-emerald-600/30 bg-emerald-50 text-emerald-700"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          {check.message}
        </div>
      )}
      {connected && (
        <p className="text-xs text-muted-foreground">
          {settings.verifiedAt
            ? `Последняя успешная проверка: ${formatDateTime(settings.verifiedAt)}`
            : "Подключение ещё не проверялось"}
        </p>
      )}

      <div className="space-y-2 rounded-lg border border-border p-4">
        <div className="text-sm font-medium">
          Адрес для уведомлений {PROVIDER_LABEL[provider]}
        </div>
        <div className="flex gap-2">
          <input
            className={`${inputClsFull} font-mono text-xs`}
            readOnly
            value={webhookUrl}
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button type="button" variant="outline" onClick={() => void onCopy()}>
            {copied ? "Скопировано" : "Копировать"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Откройте «{help.where}», добавьте этот адрес и включите события:{" "}
          {help.events.map((ev, i) => (
            <span key={ev}>
              {i > 0 && ", "}
              <code className="rounded bg-muted px-1">{ev}</code>
            </span>
          ))}
          . Без уведомлений оплаченные абонементы не будут оформляться
          автоматически.
        </p>
      </div>

      <div className="text-sm">
        Тарифов в онлайн-продаже:{" "}
        <span className="font-medium tabular-nums">
          {settings.onlinePlanCount}
        </span>
        {settings.onlinePlanCount === 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            Участники пока ничего не смогут купить. Отметьте «Можно купить
            онлайн» у нужных тарифов на странице{" "}
            <Link
              href={`/workspace/${workspaceId}/subscriptions`}
              className="underline underline-offset-2"
            >
              «Тарифы и абонементы»
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  )
}
