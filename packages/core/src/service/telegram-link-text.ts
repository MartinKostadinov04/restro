// What the bot says while an owner links Telegram (#87): the test message, the confirmation in the
// group and in a person's chat, and why a link did not work. Wording is the venue's own language
// (Bulgarian for `bg_BG`), like the alerts'. Pure: no I/O.

import type { AlertLocale } from './alert-text'

/** What the bot says while linking. */
export type TelegramLinkSaying =
  | 'test'
  | 'group_linked'
  | 'person_linked'
  | 'link_expired'
  | 'link_wrong_place'
  | 'person_taken'
  | 'not_working_here'
  | 'failed'

const EN: Readonly<Record<TelegramLinkSaying, (venue: string) => string>> = {
  test: (venue) => `Restro: a test message from ${venue}. Alerts will come here.`,
  group_linked: (venue) => `Restro is linked to ${venue}. Alerts will come here.`,
  person_linked: (venue) =>
    `You are linked at ${venue}. You can press Done on alerts in the group.`,
  link_expired: () => 'This link ran out. Ask for a new one in Restro.',
  link_wrong_place: () => 'This link is for another kind of chat. Open it from Restro again.',
  person_taken: () => 'This Telegram account is already linked to someone else.',
  not_working_here: (venue) => `You are not on the staff of ${venue} in Restro.`,
  failed: () => 'Something went wrong. Try again from Restro.',
}

const BG: Readonly<Record<TelegramLinkSaying, (venue: string) => string>> = {
  test: (venue) => `Restro: пробно съобщение от ${venue}. Известията ще идват тук.`,
  group_linked: (venue) => `Restro е свързан с ${venue}. Известията ще идват тук.`,
  person_linked: (venue) =>
    `Свързани сте в ${venue}. Можете да натискате „Готово“ на известията в групата.`,
  link_expired: () => 'Връзката изтече. Поискайте нова в Restro.',
  link_wrong_place: () => 'Тази връзка е за друг вид чат. Отворете я отново от Restro.',
  person_taken: () => 'Този Telegram акаунт вече е свързан с друг човек.',
  not_working_here: (venue) => `Не сте в персонала на ${venue} в Restro.`,
  failed: () => 'Нещо се обърка. Опитайте пак от Restro.',
}

/** The bot's line for `saying` in the venue's language. */
export function telegramLinkText(
  locale: AlertLocale,
  saying: TelegramLinkSaying,
  venueName: string,
): string {
  return (locale === 'bg' ? BG : EN)[saying](venueName)
}
