// The PWA's "Скачать мои данные" is this function: if the anchor isn't named,
// attached and clicked, the browser silently downloads nothing.
import { saveMyData } from "./save-my-data.web"

type FakeAnchor = {
  href: string
  download: string
  rel: string
  click: jest.Mock
  remove: jest.Mock
}

// The node test environment has no DOM; the spec installs a fake `document`.
const globals: { document?: unknown } = globalThis

describe("saveMyData (web)", () => {
  const realDocument = globals.document
  let anchor: FakeAnchor
  let appended: FakeAnchor[]
  let createObjectURL: jest.SpyInstance
  let revokeObjectURL: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    appended = []
    anchor = {
      href: "",
      download: "",
      rel: "",
      click: jest.fn(() => {
        // The click has to happen while the anchor is in the document.
        expect(appended).toContain(anchor)
      }),
      remove: jest.fn(() => {
        appended = appended.filter((a) => a !== anchor)
      }),
    }
    globals.document = {
      createElement: (tag: string) => {
        expect(tag).toBe("a")
        return anchor
      },
      body: { appendChild: (node: FakeAnchor) => appended.push(node) },
    }
    createObjectURL = jest
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:https://app.test/1")
    revokeObjectURL = jest
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
    createObjectURL.mockRestore()
    revokeObjectURL.mockRestore()
    globals.document = realDocument
  })

  it("downloads the JSON under the export's file name", async () => {
    const outcome = await saveMyData(
      "clubspace-my-data-2026-11-01.json",
      '{"formatVersion":1}',
    )

    expect(outcome).toBe("saved")
    expect(anchor.download).toBe("clubspace-my-data-2026-11-01.json")
    expect(anchor.href).toBe("blob:https://app.test/1")
    expect(anchor.click).toHaveBeenCalledTimes(1)
    expect(appended).toHaveLength(0)

    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe("application/json")
    expect(await blob.text()).toBe('{"formatVersion":1}')
  })

  it("frees the Blob URL only after the browser had time to read it", async () => {
    await saveMyData("f.json", "{}")

    expect(revokeObjectURL).not.toHaveBeenCalled()
    jest.runAllTimers()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:https://app.test/1")
  })
})
