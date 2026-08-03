import { normalizeHitSlop, webHitSlopStyle } from "./hit-slop"

describe("normalizeHitSlop", () => {
  it("expands a number to all four sides", () => {
    expect(normalizeHitSlop(8)).toEqual({
      top: 8,
      bottom: 8,
      left: 8,
      right: 8,
    })
  })

  it("fills in the sides an Insets object leaves out", () => {
    expect(normalizeHitSlop({ top: 10, bottom: 4 })).toEqual({
      top: 10,
      bottom: 4,
      left: 0,
      right: 0,
    })
  })

  it("treats nothing-to-do as null", () => {
    expect(normalizeHitSlop(undefined)).toBeNull()
    expect(normalizeHitSlop(null)).toBeNull()
    expect(normalizeHitSlop(0)).toBeNull()
    expect(normalizeHitSlop({})).toBeNull()
  })
})

describe("webHitSlopStyle", () => {
  it("grows the target without moving the control", () => {
    expect(webHitSlopStyle(8, {})).toEqual({
      paddingTop: 8,
      paddingBottom: 8,
      marginTop: -8,
      marginBottom: -8,
      paddingLeft: 8,
      paddingRight: 8,
      marginLeft: -8,
      marginRight: -8,
    })
  })

  it("leaves an axis alone when the caller already pads it", () => {
    // A control that pads itself has a real target and its own box model.
    expect(webHitSlopStyle(8, { paddingVertical: 12 })).toEqual({
      paddingLeft: 8,
      paddingRight: 8,
      marginLeft: -8,
      marginRight: -8,
    })
    expect(webHitSlopStyle(8, { paddingHorizontal: 12 })).toEqual({
      paddingTop: 8,
      paddingBottom: 8,
      marginTop: -8,
      marginBottom: -8,
    })
  })

  it("does nothing when the caller pads both axes", () => {
    expect(webHitSlopStyle(8, { padding: 12 })).toBeNull()
    expect(
      webHitSlopStyle(8, { paddingTop: 4, paddingLeft: 4 }),
    ).toBeNull()
  })

  it("does nothing without a hitSlop", () => {
    expect(webHitSlopStyle(undefined, {})).toBeNull()
    expect(webHitSlopStyle(undefined, undefined)).toBeNull()
  })

  it("handles a style that was never set", () => {
    expect(webHitSlopStyle(6, undefined)).toEqual({
      paddingTop: 6,
      paddingBottom: 6,
      marginTop: -6,
      marginBottom: -6,
      paddingLeft: 6,
      paddingRight: 6,
      marginLeft: -6,
      marginRight: -6,
    })
  })
})
