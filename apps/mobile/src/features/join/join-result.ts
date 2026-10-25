import type { JoinWorkspaceResult } from "../../shared/api/join"

export type JoinResultView =
  | { action: "enter"; toast: string }
  | {
      action: "panel"
      tone: "success" | "info" | "error"
      title: string
      body: string
      primary: string
    }

// What to show after POST /workspaces/join answered. Pure so every state is
// unit-testable; the screen only renders it.
export const joinResultView = (res: JoinWorkspaceResult): JoinResultView => {
  const club = res.workspaceName
  if (res.status === "active") {
    return {
      action: "enter",
      toast: res.created ? `Вы в клубе «${club}»` : `Вы уже в клубе «${club}»`,
    }
  }
  if (res.status === "pending") {
    return res.created
      ? {
          action: "panel",
          tone: "success",
          title: "Заявка отправлена",
          body: `Клуб «${club}» получил вашу заявку. Как только администратор её примет, мы пришлём письмо, а клуб появится в приложении.`,
          primary: "Готово",
        }
      : {
          action: "panel",
          tone: "info",
          title: "Заявка уже отправлена",
          body: `Ждём, когда администратор клуба «${club}» её примет.`,
          primary: "Готово",
        }
  }
  return {
    action: "panel",
    tone: "error",
    title: "Заявка отклонена",
    body: `Клуб «${club}» отклонил заявку. Свяжитесь с клубом.`,
    primary: "Ввести другой код",
  }
}

/**
 * What «Готово» does on the result panel: in onboarding back to the request
 * list (the root), otherwise back where the member came from, or to the Home
 * tab when the screen is the root (a web deep link).
 */
export const doneAction = (opts: {
  onboarding: boolean
  canGoBack: boolean
}): "popToOnboarding" | "goBack" | "home" =>
  opts.onboarding ? "popToOnboarding" : opts.canGoBack ? "goBack" : "home"
