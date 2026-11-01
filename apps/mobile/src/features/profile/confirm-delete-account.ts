import { showAlert } from "../../shared/alert"
import { deleteAccount } from "../../shared/api/me"
import { errorMessage } from "../../shared/error-message"

/**
 * Asks, then permanently deletes the account; `onDeleted` signs out locally.
 * Shared by Settings and the consent screen: without the personal-data consent
 * the app can't be used, so refusing it means deleting the account.
 */
export const confirmDeleteAccount = (onDeleted: () => void) => {
  showAlert(
    "Удалить аккаунт?",
    "Это действие необратимо. Ваш профиль, доступы, заметки, закладки и загруженные на устройство видео будут удалены навсегда. Профили ваших детей, у которых нет другого родителя, будут удалены вместе с ним. Обезличенная история посещений и рангов сохранится в клубе.",
    [
      { text: "Отмена", style: "cancel" },
      {
        text: "Удалить",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteAccount()
            onDeleted()
          } catch (e) {
            showAlert("Не удалось удалить аккаунт", errorMessage(e))
          }
        },
      },
    ],
  )
}
