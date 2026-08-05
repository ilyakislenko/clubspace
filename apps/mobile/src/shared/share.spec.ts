/* eslint-disable import/first -- jest.mock must be hoisted above the imports
   it stubs. */
// react-native-web's Share rejects when the browser has no navigator.share, and
// every call site swallowed that — so the button did nothing at all on desktop.
// These cover the fallback chain: a wrong branch here means a member on a
// locked-out screen presses their only button and gets silence.
const rnShare = jest.fn()
jest.mock("react-native", () => ({
  Share: {
    share: (...args: unknown[]) => rnShare(...args),
    dismissedAction: "dismissedAction",
  },
}))

let web = true
jest.mock("./platform", () => ({
  get isWeb() {
    return web
  },
}))

import { shareFeedback, shareText } from "./share"

type Nav = {
  share?: jest.Mock
  clipboard?: { writeText?: jest.Mock }
}

const nav = () => (globalThis as unknown as { navigator: Nav }).navigator

beforeEach(() => {
  web = true
  rnShare.mockReset()
  ;(globalThis as unknown as { navigator: Nav }).navigator = {
    share: jest.fn(async () => undefined),
    clipboard: { writeText: jest.fn(async () => undefined) },
  }
})

describe("on native", () => {
  it("uses the OS sheet", async () => {
    web = false
    rnShare.mockResolvedValue({ action: "sharedAction" })
    await expect(shareText({ message: "привет" })).resolves.toBe("shared")
    expect(rnShare).toHaveBeenCalledWith({ message: "привет" })
  })

  it("reports a dismissed sheet as dismissed, not shared", async () => {
    web = false
    rnShare.mockResolvedValue({ action: "dismissedAction" })
    await expect(shareText({ message: "привет" })).resolves.toBe("dismissed")
  })
})

describe("on web", () => {
  it("prefers the native share sheet when the browser has one", async () => {
    await expect(
      shareText({ title: "Видео", message: "текст" }),
    ).resolves.toBe("shared")
    expect(nav().share).toHaveBeenCalledWith({ title: "Видео", text: "текст" })
    expect(nav().clipboard?.writeText).not.toHaveBeenCalled()
  })

  it("copies to the clipboard when the browser has no share API", async () => {
    delete nav().share
    await expect(shareText({ message: "текст" })).resolves.toBe("copied")
    expect(nav().clipboard?.writeText).toHaveBeenCalledWith("текст")
  })

  it("copies when the share sheet fails for a real reason", async () => {
    nav().share = jest.fn(async () => {
      throw new Error("NotAllowedError")
    })
    await expect(shareText({ message: "текст" })).resolves.toBe("copied")
  })

  it("does NOT copy behind the user's back when they cancel the sheet", async () => {
    nav().share = jest.fn(async () => {
      const error = new Error("cancelled") as Error & { name: string }
      error.name = "AbortError"
      throw error
    })
    await expect(shareText({ message: "текст" })).resolves.toBe("dismissed")
    expect(nav().clipboard?.writeText).not.toHaveBeenCalled()
  })

  it("reports unavailable when neither sharing nor copying works", async () => {
    delete nav().share
    delete nav().clipboard
    await expect(shareText({ message: "текст" })).resolves.toBe("unavailable")
  })

  it("reports unavailable when the clipboard write is denied", async () => {
    delete nav().share
    nav().clipboard = {
      writeText: jest.fn(async () => {
        throw new Error("denied")
      }),
    }
    await expect(shareText({ message: "текст" })).resolves.toBe("unavailable")
  })
})

describe("shareFeedback", () => {
  it("says something only when the member needs to know", () => {
    expect(shareFeedback("shared")).toBeNull()
    expect(shareFeedback("dismissed")).toBeNull()
    expect(shareFeedback("copied")).toMatch(/Скопировано/)
    expect(shareFeedback("unavailable")).toMatch(/вручную/)
  })
})
