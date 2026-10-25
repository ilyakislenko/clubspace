"use client"

import { useState, type FormEvent } from "react"

import { Button, Input, Label } from "@clubspace/ui-kit/ui"

type Props = {
  // phone is optional: the self-edit card doesn't show it, the staff view does.
  initial: {
    firstname: string
    lastname: string
    email: string
    phone?: string
  }
  submitting: boolean
  onCancel: () => void
  onSubmit: (patch: {
    firstname: string | null
    lastname: string | null
    email: string
    phone?: string | null
  }) => Promise<void>
}

export function ProfileEditForm({
  initial,
  submitting,
  onCancel,
  onSubmit,
}: Props) {
  const [firstname, setFirstname] = useState(initial.firstname)
  const [lastname, setLastname] = useState(initial.lastname)
  const [email, setEmail] = useState(initial.email)
  const [phone, setPhone] = useState(initial.phone ?? "")

  const dirty =
    firstname.trim() !== initial.firstname ||
    lastname.trim() !== initial.lastname ||
    email.trim().toLowerCase() !== initial.email.toLowerCase() ||
    (initial.phone !== undefined && phone.trim() !== initial.phone)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!dirty || submitting) return
    void onSubmit({
      firstname: firstname.trim() || null,
      lastname: lastname.trim() || null,
      email: email.trim().toLowerCase(),
      ...(initial.phone !== undefined ? { phone: phone.trim() || null } : {}),
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor="profile-first">Имя</Label>
          <Input
            id="profile-first"
            value={firstname}
            onChange={(e) => setFirstname(e.target.value)}
            placeholder="Иван"
          />
        </div>
        <div>
          <Label htmlFor="profile-last">Фамилия</Label>
          <Input
            id="profile-last"
            value={lastname}
            onChange={(e) => setLastname(e.target.value)}
            placeholder="Иванов"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="profile-email">Email</Label>
        <Input
          id="profile-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ivan@mail.ru"
          required
        />
        <p className="mt-1 text-xs text-muted-foreground">
          Если ученик меняет почту — обнови её здесь. Коды для входа будут
          уходить на новый адрес, старые токены остаются валидными.
        </p>
      </div>
      {initial.phone !== undefined && (
        <div>
          <Label htmlFor="profile-phone">Телефон</Label>
          <Input
            id="profile-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+7 900 000-00-00"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            По нему тренер звонит в списке «Кто пропадает».
          </p>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={submitting}
        >
          Отмена
        </Button>
        <Button type="submit" disabled={!dirty || submitting}>
          {submitting ? "Сохраняю…" : "Сохранить"}
        </Button>
      </div>
    </form>
  )
}
