/* eslint-disable import/first -- jest.mock must be hoisted above the imports
   it stubs. */
// react-native-web's Alert.alert is an empty function, so on web every
// confirmation in the app silently didn't happen. These cover the mapping onto
// the browser dialogs: the wrong branch here means a destructive action fires
// without being confirmed, or a confirmed one never runs.
const rnAlert = jest.fn()
jest.mock("react-native", () => ({ Alert: { alert: (...a: unknown[]) => rnAlert(...a) } }))

let web = true
jest.mock("./platform", () => ({
  get isWeb() {
    return web
  },
}))

import { showAlert } from "./alert"

type Dialogs = {
  alert?: jest.Mock
  confirm?: jest.Mock
}

const globals = globalThis as unknown as Dialogs

beforeEach(() => {
  web = true
  rnAlert.mockClear()
  globals.alert = jest.fn()
  globals.confirm = jest.fn(() => true)
})

describe("on native", () => {
  it("delegates to React Native untouched", () => {
    web = false
    const buttons = [{ text: "Отмена", style: "cancel" as const }]
    showAlert("Заголовок", "Текст", buttons)
    expect(rnAlert).toHaveBeenCalledWith("Заголовок", "Текст", buttons)
    expect(globals.confirm).not.toHaveBeenCalled()
  })
})

describe("on web — a notice (no cancel button)", () => {
  it("shows the message and runs the only action", () => {
    const onPress = jest.fn()
    showAlert("Готово", "Курс скачан", [{ text: "OK", onPress }])
    expect(globals.alert).toHaveBeenCalledWith("Готово\n\nКурс скачан")
    expect(globals.confirm).not.toHaveBeenCalled()
    expect(onPress).toHaveBeenCalled()
  })

  it("shows a bare title with no message", () => {
    showAlert("Сначала отметьте точку A раньше точки B.")
    expect(globals.alert).toHaveBeenCalledWith(
      "Сначала отметьте точку A раньше точки B.",
    )
  })
})

describe("on web — a confirmation", () => {
  const buttons = () => [
    { text: "Отмена", style: "cancel" as const, onPress: jest.fn() },
    { text: "Удалить", style: "destructive" as const, onPress: jest.fn() },
  ]

  it("runs the destructive action when the member accepts", () => {
    const b = buttons()
    showAlert("Удалить запись?", undefined, b)
    expect(globals.confirm).toHaveBeenCalledWith("Удалить запись?")
    expect(b[1].onPress).toHaveBeenCalled()
    expect(b[0].onPress).not.toHaveBeenCalled()
  })

  it("runs the cancel action — and NOT the destructive one — when they decline", () => {
    globals.confirm = jest.fn(() => false)
    const b = buttons()
    showAlert("Удалить запись?", undefined, b)
    expect(b[1].onPress).not.toHaveBeenCalled()
    expect(b[0].onPress).toHaveBeenCalled()
  })

  it("treats the last non-cancel button as the primary action", () => {
    const cancel = jest.fn()
    const primary = jest.fn()
    showAlert("Закрепить курс?", "Название", [
      { text: "Отмена", style: "cancel", onPress: cancel },
      { text: "Закрепить", onPress: primary },
    ])
    expect(primary).toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
  })

  it("survives a browser with dialogs disabled", () => {
    delete globals.confirm
    const onPress = jest.fn()
    expect(() =>
      showAlert("Удалить?", undefined, [
        { text: "Отмена", style: "cancel" },
        { text: "Удалить", onPress },
      ]),
    ).not.toThrow()
    // Nothing was confirmed, so nothing destructive runs.
    expect(onPress).not.toHaveBeenCalled()
  })
})
