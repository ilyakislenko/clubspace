import { shortUpdateId } from "./update-id"

const UPDATE_ID = "a1b2c3d4-e5f6-4789-8abc-def012345678"

describe("shortUpdateId", () => {
  it("shows the first 8 characters of a downloaded OTA update", () => {
    expect(
      shortUpdateId({ isEnabled: true, isEmbeddedLaunch: false, updateId: UPDATE_ID }),
    ).toBe("a1b2c3d4")
  })

  it("shows nothing for the bundle built into the binary", () => {
    expect(
      shortUpdateId({ isEnabled: true, isEmbeddedLaunch: true, updateId: UPDATE_ID }),
    ).toBeNull()
  })

  it("shows nothing when updates are off or no id is known", () => {
    expect(
      shortUpdateId({ isEnabled: false, isEmbeddedLaunch: false, updateId: UPDATE_ID }),
    ).toBeNull()
    expect(
      shortUpdateId({ isEnabled: true, isEmbeddedLaunch: false, updateId: null }),
    ).toBeNull()
  })
})
