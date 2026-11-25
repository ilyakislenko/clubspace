import { buildCheckInCardHtml } from "./check-in-card-print"

const base = {
  name: "Аня Смирнова",
  qrPngDataUrl: "data:image/png;base64,QR",
  hint: "Покажите эту карту тренеру у входа",
}

describe("buildCheckInCardHtml", () => {
  it("shows the QR, the name and the hint on one card", () => {
    const html = buildCheckInCardHtml(base)
    expect(html).toContain('src="data:image/png;base64,QR"')
    expect(html).toContain('<p class="name">Аня Смирнова</p>')
    expect(html).toContain("Покажите эту карту тренеру у входа")
    expect(html).toContain("<title>Аня Смирнова — карта для входа</title>")
    expect(html).toContain("@page { size: A4 portrait")
  })

  it("escapes the name", () => {
    const html = buildCheckInCardHtml({ ...base, name: '<img src=x onerror="1">' })
    expect(html).not.toContain("<img src=x")
    expect(html).toContain("&lt;img src=x onerror=&quot;1&quot;&gt;")
  })
})
