import { showAlert } from "../../shared/alert"

/**
 * Asks before deleting the account; `onConfirmed` opens DeleteAccountModal,
 * which mails the code and deletes with it. Shared by Settings and the
 * consent screen: without the personal-data consent the app can't be used,
 * so refusing it means deleting the account.
 */
export const confirmDeleteAccount = (onConfirmed: () => void) => {
  showAlert(
    "Удалить аккаунт?",
    "Это действие необратимо. Ваш профиль, доступы, заметки, закладки и загруженные на устройство видео будут удалены навсегда. Профили ваших детей, у которых нет другого родителя, будут удалены вместе с ним. Обезличенная история посещений и рангов сохранится в клубе. Для подтверждения мы отправим код на вашу почту.",
    [
      { text: "Отмена", style: "cancel" },
      { text: "Продолжить", style: "destructive", onPress: onConfirmed },
    ],
  )
}
