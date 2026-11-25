import { vocabularyForWorkspaceType } from "@clubspace/ui-kit/brand"

import { buildTrialPosterHtml, trialHeading } from "./trial-poster"

describe("trial poster", () => {
  it("names the trial class in the club's words", () => {
    expect(trialHeading(vocabularyForWorkspaceType("GRAPPLING").session)).toBe("Пробная тренировка")
    expect(trialHeading(vocabularyForWorkspaceType("YOGA").session)).toMatch(/^Пробн/)
  })

  it("shows the heading, the club, the QR and the link, escaped", () => {
    const html = buildTrialPosterHtml({
      workspaceName: '<b>"Ритм"</b>',
      heading: "Пробная тренировка",
      url: "https://app.club.test/c/ritm/trial?src=qr",
      qrPngDataUrl: "data:image/png;base64,QR",
    })
    expect(html).toContain("<h1>Пробная тренировка</h1>")
    expect(html).toContain("Наведите камеру — оставьте заявку")
    expect(html).toContain("&lt;b&gt;&quot;Ритм&quot;&lt;/b&gt;")
    expect(html).toContain('src="data:image/png;base64,QR"')
    expect(html).toContain("или откройте https://app.club.test/c/ritm/trial?src=qr")
  })
})
