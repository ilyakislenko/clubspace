import { buildInvitePosterHtml } from "./invite-poster"

const base = {
  workspaceName: "Томский клуб",
  joinCodeDisplay: "ABCD-2345",
  joinUrl: "https://app.club.test/join/ABCD2345",
  qrPngDataUrl: "data:image/png;base64,QR",
  appLinks: {
    web: "https://app.club.test",
    googlePlay: "https://play.google.com/x",
    ruStore: "https://rustore.ru/x",
  },
}

describe("buildInvitePosterHtml", () => {
  it("shows the club, the code, the link and the QR", () => {
    const html = buildInvitePosterHtml(base)
    expect(html).toContain("Присоединяйтесь к клубу")
    expect(html).toContain("Томский клуб")
    expect(html).toContain("Код клуба: ABCD-2345")
    expect(html).toContain("или откройте https://app.club.test/join/ABCD2345")
    expect(html).toContain('src="data:image/png;base64,QR"')
    expect(html).toContain("@page { size: A4 portrait")
  })

  it("escapes the club name and the other interpolated values", () => {
    const html = buildInvitePosterHtml({
      ...base,
      workspaceName: '<script>alert("x")</script>',
      joinUrl: "https://a.test/?a=1&b=<2>",
    })
    expect(html).not.toContain("<script>alert")
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;")
    expect(html).toContain("a=1&amp;b=&lt;2&gt;")
  })

  it("lists every configured store", () => {
    expect(buildInvitePosterHtml(base)).toContain(
      "Приложение ClubSpace — Google Play · RuStore · в браузере",
    )
  })

  it("omits RuStore when it is not configured", () => {
    const html = buildInvitePosterHtml({
      ...base,
      appLinks: { ...base.appLinks, ruStore: null },
    })
    expect(html).not.toContain("RuStore")
    expect(html).toContain("Google Play · в браузере")
  })
})
