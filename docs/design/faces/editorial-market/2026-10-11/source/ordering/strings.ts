import type { Locale } from '../types';

const en = {
  add: 'Add', addToBag: 'Add to bag', addNamed: (n: string) => `Add ${n}`, increase: 'One more', decrease: 'One less', quantity: 'Quantity',
  required: 'Required', optional: 'Optional', pickUpTo: (n: number) => `Choose up to ${n}`, pickOne: 'Choose 1', pickAtLeast: (n: number) => `Choose at least ${n}`,
  note: 'Note for the kitchen', notePlaceholder: 'e.g. no onion, sauce on the side', bag: 'Your bag', viewBag: 'View bag', items: (n: number) => (n === 1 ? '1 item' : `${n} items`),
  emptyBag: 'Your bag is empty. Add something from the menu.', remove: 'Remove', edit: 'Edit', sendToKitchen: 'Send to kitchen', sent: 'Sent to the kitchen', subtotal: 'Subtotal',
  tab: 'Table order', tabIntro: 'Everything ordered at this table, from the app and from the waiter.', fromApp: 'From the app', fromWaiter: 'From the waiter', round: 'Round',
  received: 'Received', preparing: 'Preparing', served: 'Served', tableTotal: 'Table total', pay: 'Pay', emptyTab: 'Nothing has been ordered yet.',
  callServer: 'Call a server', callWaiter: 'Call waiter', bringBill: 'Bring the bill', water: 'Water', cutlery: 'Cutlery', other: 'Something else', otherPlaceholder: 'Tell us what you need', send: 'Send',
  waiterComing: 'A waiter is on the way', waiterComingHint: 'You can keep browsing. We let the team know.', cancelRequest: 'Cancel request',
  payTitle: 'Pay', whatToPay: 'What would you like to pay?', fullTab: 'Full table', splitEqual: 'Split equally', myItems: 'My items', people: 'People', perPerson: 'per person',
  tip: 'Tip for the team', noTip: 'No tip', custom: 'Custom', customTip: 'Custom tip amount', promo: 'Promo code', apply: 'Apply', allergyNote: 'Any allergies? Tell your waiter before paying if something needs to change.',
  total: 'Total', payWith: 'Pay with', applePay: 'Apple Pay', googlePay: 'Google Pay', card: 'Card', payWaiter: 'Pay the waiter at the table',
  processing: 'Processing your payment', success: 'Payment complete', successHint: 'Thank you. Your receipt is ready.', failure: 'Payment did not go through', failureHint: 'Nothing was charged. Try again or choose another method.', retry: 'Try again', viewReceipt: 'View receipt', done: 'Back to menu',
  receipt: 'Receipt', table: 'Table', date: 'Date', vat: (r: number) => `incl. VAT ${r}%`, method: 'Paid with', fiscal: 'Fiscal ref.', downloadPdf: 'Download PDF', email: 'Email receipt', print: 'Ask waiter to print', actionDone: 'Done — request sent', close: 'Close', bell: 'Waiter', bill: 'Bill', terminal: 'Card terminal',
};
type S = typeof en;
const bg: S = {
  add: 'Добави', addToBag: 'Добави в поръчката', addNamed: n => `Добави ${n}`, increase: 'Още едно', decrease: 'Едно по-малко', quantity: 'Количество',
  required: 'Задължително', optional: 'По избор', pickUpTo: n => `Изберете до ${n}`, pickOne: 'Изберете 1', pickAtLeast: n => `Изберете поне ${n}`,
  note: 'Бележка за кухнята', notePlaceholder: 'напр. без лук, сосът отделно', bag: 'Вашата поръчка', viewBag: 'Виж поръчката', items: n => (n === 1 ? '1 артикул' : `${n} артикула`),
  emptyBag: 'Поръчката е празна. Добавете нещо от менюто.', remove: 'Премахни', edit: 'Промени', sendToKitchen: 'Изпрати към кухнята', sent: 'Изпратено към кухнята', subtotal: 'Междинна сума',
  tab: 'Поръчка на масата', tabIntro: 'Всичко поръчано на тази маса — от приложението и от сервитьора.', fromApp: 'От приложението', fromWaiter: 'От сервитьора', round: 'Поръчка',
  received: 'Приета', preparing: 'Приготвя се', served: 'Сервирана', tableTotal: 'Общо за масата', pay: 'Плати', emptyTab: 'Все още няма поръчки.',
  callServer: 'Повикай сервитьор', callWaiter: 'Повикай сервитьор', bringBill: 'Сметката, моля', water: 'Вода', cutlery: 'Прибори', other: 'Друго', otherPlaceholder: 'Напишете от какво имате нужда', send: 'Изпрати',
  waiterComing: 'Сервитьор идва', waiterComingHint: 'Може да продължите да разглеждате. Екипът е уведомен.', cancelRequest: 'Отмени заявката',
  payTitle: 'Плащане', whatToPay: 'Какво искате да платите?', fullTab: 'Цялата маса', splitEqual: 'Раздели поравно', myItems: 'Моите артикули', people: 'Души', perPerson: 'на човек',
  tip: 'Бакшиш за екипа', noTip: 'Без', custom: 'Друг', customTip: 'Друга сума бакшиш', promo: 'Промо код', apply: 'Приложи', allergyNote: 'Имате алергии? Кажете на сервитьора преди плащане, ако нещо трябва да се промени.',
  total: 'Общо', payWith: 'Плащане с', applePay: 'Apple Pay', googlePay: 'Google Pay', card: 'Карта', payWaiter: 'Плащане при сервитьора',
  processing: 'Плащането се обработва', success: 'Плащането е успешно', successHint: 'Благодарим! Бележката ви е готова.', failure: 'Плащането не беше успешно', failureHint: 'Нищо не е таксувано. Опитайте отново или изберете друг начин.', retry: 'Опитай отново', viewReceipt: 'Виж бележката', done: 'Обратно към менюто',
  receipt: 'Касова бележка', table: 'Маса', date: 'Дата', vat: r => `вкл. ДДС ${r}%`, method: 'Платено с', fiscal: 'Фискален №', downloadPdf: 'Изтегли PDF', email: 'Изпрати по имейл', print: 'Помоли за разпечатка', actionDone: 'Готово — заявката е изпратена', close: 'Затвори', bell: 'Сервитьор', bill: 'Сметка', terminal: 'ПОС терминал',
};
export const orderStrings = (l: Locale): S => (l === 'bg_BG' ? bg : en);
export type OrderStrings = S;
