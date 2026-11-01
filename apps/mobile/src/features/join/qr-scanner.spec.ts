import {
  createScanHandler,
  openJoinFromScan,
  scannerView,
} from "./qr-scanner"

describe("scannerView", () => {
  it("waits for the permission state", () => {
    expect(scannerView(null)).toBe("checking")
  })

  it("asks while the system prompt can still be shown", () => {
    expect(scannerView({ granted: false, canAskAgain: true })).toBe("ask")
  })

  it("shows the denied state once the user refused for good", () => {
    expect(scannerView({ granted: false, canAskAgain: false })).toBe("denied")
  })

  it("opens the camera when granted", () => {
    expect(scannerView({ granted: true, canAskAgain: false })).toBe("camera")
  })
})

describe("createScanHandler", () => {
  const setup = () => {
    let t = 0
    const onCode = jest.fn()
    const onRejected = jest.fn()
    const scan = createScanHandler({ onCode, onRejected, now: () => t })
    return { scan, onCode, onRejected, tick: (ms: number) => (t += ms) }
  }

  it("navigates to the join screen with the scanned code, once", () => {
    const { scan, onCode } = setup()
    const navigation = { popTo: jest.fn() }
    onCode.mockImplementation((code: string) => openJoinFromScan(navigation, code))

    scan("https://app.club.test/join/abcd-2345")
    scan("https://app.club.test/join/abcd-2345")
    scan("https://app.club.test/join/WXYZ2345")

    expect(onCode).toHaveBeenCalledTimes(1)
    expect(navigation.popTo).toHaveBeenCalledTimes(1)
    expect(navigation.popTo).toHaveBeenCalledWith("JoinClub", { code: "ABCD2345" })
  })

  it("rejects a foreign QR and keeps scanning", () => {
    const { scan, onCode, onRejected, tick } = setup()
    scan("https://example.com")
    scan("https://example.com") // the same frame again: ignored
    expect(onRejected).toHaveBeenCalledTimes(1)
    tick(2500)
    scan("https://example.com")
    expect(onRejected).toHaveBeenCalledTimes(2)

    scan("ABCD2345")
    expect(onCode).toHaveBeenCalledWith("ABCD2345")
  })
})
