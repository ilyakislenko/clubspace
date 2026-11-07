import { faqItems } from "../src/features/landing/content"
import { metrikaSnippet, readMarketingConfig } from "../src/shared/lib/marketing"

describe("readMarketingConfig", () => {
  it("is all off when nothing is set", () => {
    expect(readMarketingConfig({})).toEqual({
      metrikaId: null,
      yandexVerification: null,
      googleVerification: null,
      telegramUrl: null,
      dataHostedInRu: false,
    })
  })

  it("accepts only a numeric Metrika id and an https Telegram link", () => {
    const cfg = readMarketingConfig({
      YANDEX_METRIKA_ID: '123"</script>',
      SUPPORT_TELEGRAM_URL: "javascript:alert(1)",
    })
    expect(cfg.metrikaId).toBeNull()
    expect(cfg.telegramUrl).toBeNull()
    expect(
      readMarketingConfig({
        YANDEX_METRIKA_ID: " 987654 ",
        SUPPORT_TELEGRAM_URL: "https://t.me/clubspace",
      }),
    ).toMatchObject({ metrikaId: "987654", telegramUrl: "https://t.me/clubspace" })
  })

  it("claims Russian hosting only for DATA_HOSTED_IN_RU=true", () => {
    expect(readMarketingConfig({ DATA_HOSTED_IN_RU: "1" }).dataHostedInRu).toBe(false)
    expect(readMarketingConfig({ DATA_HOSTED_IN_RU: "TRUE" }).dataHostedInRu).toBe(true)
  })
})

describe("metrikaSnippet", () => {
  it("initialises the counter with Webvisor off", () => {
    expect(metrikaSnippet("42")).toContain('ym(42,"init",{')
    expect(metrikaSnippet("42")).toContain("webvisor:false")
  })
})

describe("faqItems", () => {
  const claim = "размещаются на серверах в России"
  const text = (on: boolean) => faqItems(on).map((f) => f.a).join(" ")

  it("omits the hosting claim unless the instance is hosted in Russia", () => {
    expect(text(false)).not.toContain(claim)
    expect(text(true)).toContain(claim)
  })
})
