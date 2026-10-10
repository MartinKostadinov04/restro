<!-- lang:bg -->
# QR кодове за масите: нашият линк или собствен линк на заведението

Това ръководство е за управителя на заведението. Обяснява какъв адрес носи QR кодът на всяка маса и как да използвате собствен адрес от вашия сайт вместо нашия. Не са нужни технически знания за първия вариант; за втория ще ви трябва човекът, който се грижи за сайта или домейна ви.

Настройката е в раздел „Маси и QR“, карта „Адрес в кодовете“.

## Два начина

**Вариант 1: нашият линк.** Кодът отваря адрес от вида `<нашия-адрес>/t/<код-на-масата>`. Нищо не се настройва.

**Вариант 2: вашият собствен линк.** Кодът отваря адрес от вашия домейн, например `<вашия-домейн>/t/<код-на-масата>`, а вашият сайт препраща госта към нашия адрес. Така стикерите носят вашето име и остават валидни, дори някога да сменим нашия адрес.

Ако не сте сигурни, започнете с Вариант 1. Можете да минете на Вариант 2 по-късно, но стикерите, които вече са отпечатани, запазват адреса, с който са отпечатани.

## Вариант 1: нашият линк

1. Отворете раздел „Маси и QR“.
2. В картата „Адрес в кодовете“ изберете „Нашият линк“.
3. Натиснете „Създай кодове за всички маси“.
4. Натиснете „Лист за печат“, после „Печат / Запиши като PDF“.

Докато изграждаме системата, „Основен адрес“ е адресът на компютъра, на който работи приложението. За да сканирате от телефон в същата Wi-Fi мрежа, въведете мрежовия адрес на този компютър, например `http://192.168.1.20:3000`. Когато системата получи постоянен адрес, ще го зададем тук и ще отпечатаме стикерите отново.

## Вариант 2: вашият собствен линк

Нужно е едно правило за препращане в сайта или домейна ви: всичко, което започва с `https://<вашия-домейн>/t/`, се препраща към `https://<нашия-адрес>/t/`, като остатъкът от адреса се запазва. Кодът на масата е в остатъка, затова той трябва да се запази.

„Нашия адрес“ е „Основният адрес“ от картата „Адрес в кодовете“ (избрана на „Нашият линк“). „Вашия домейн“ е домейнът или поддомейнът, който ще пише на стикерите, например `menu.<вашия-домейн>`.

Направете препращането със **временно** (302) пренасочване, а не с постоянно (301): така можем да сменим нашия адрес, без браузърите на гостите да помнят стария.

### Пример 1: Cloudflare (Redirect Rules)

1. Влезте в Cloudflare, изберете домейна си и отворете „Rules“, после „Redirect Rules“.
2. Създайте ново правило („Create rule“) с име, например „Меню на масите“.
3. В „When incoming requests match“ изберете „Custom filter expression“ и въведете: `(http.host eq "<вашия-домейн>" and starts_with(http.request.uri.path, "/t/"))`.
4. В „Then“ изберете „Dynamic“ и въведете израза: `concat("https://<нашия-адрес>", http.request.uri.path)`.
5. Изберете код 302 и включете „Preserve query string“.
6. Запазете и пуснете правилото („Deploy“).

Поддомейнът (например `menu.<вашия-домейн>`) трябва да сочи към Cloudflare и да е с включено проксиране, за да се прилагат правилата.

### Пример 2: обикновен хостинг (панел или конфигурационен файл)

Потърсете „Redirects“, „Пренасочвания“ или „URL redirects“ в панела на хостинга. Изберете временно (302) пренасочване, с „wildcard“ или „запазване на пътя“, от `https://<вашия-домейн>/t/` към `https://<нашия-адрес>/t/`.

Ако хостингът ви ползва Apache, същото се записва във файла `.htaccess` на сайта:

```
RedirectMatch 302 ^/t/(.*)$ https://<нашия-адрес>/t/$1
```

Ако ползвате nginx, правилото е:

```
location /t/ {
    return 302 https://<нашия-адрес>$request_uri;
}
```

### Пример 3: конструктор на сайтове

Повечето конструктори имат раздел „Redirects“, „URL redirects“ или „URL mappings“ в настройките на сайта. Важно е дали позволява правило за всички адреси, започващи с `/t/` („wildcard“).

- Ако позволява, въведете `/t/*` като източник и `https://<нашия-адрес>/t/*` като цел, временно (302).
- Ако позволява само по един адрес, ще трябва по едно правило за всяка маса: от `/t/<код-на-масата>` към `https://<нашия-адрес>/t/<код-на-масата>`. Кодът на всяка маса виждате, като натиснете малкия QR код на масата в раздел „Маси и QR“. Тогава е по-практично да ползвате Вариант 1 или да помолите човека, който се грижи за сайта ви, да го направи.

### След като препращането е готово

1. В картата „Адрес в кодовете“ изберете „Собствен линк на заведението“.
2. В „Шаблон на линка“ напишете адреса си със `{token}` на мястото на кода на масата, например `https://<вашия-домейн>/t/{token}`.
3. Под полето се показва пример с кода на една от масите. Натиснете „Отвори тестовия линк“: в нов раздел на браузъра трябва да се отвори менюто с името на масата най-отгоре.
4. Натиснете „Запиши адреса“, после „Лист за печат“ и отпечатайте.

Тестовият линк се отваря от вашия браузър. Нашият сървър никога не отваря адреса, който сте въвели.

## Ако препращането се развали

Стикерите са с адрес от вашия домейн и работят само докато правилото за препращане работи. Ако правилото бъде изтрито или домейнът изтече, гостът ще види грешка от вашия сайт, а не менюто.

- Върнете правилото. Стикерите започват да работят веднага, без нов печат.
- Ако не можете да го върнете, изберете „Нашият линк“, създайте нов лист и го отпечатайте. Старите стикери ще продължат да не работят.

Ако „Отвори тестовия линк“ показва:

- **„Този код за маса не е активен“**: препращането работи, но кодът е изключен или сменен. Проверете масата в списъка.
- **Грешка от вашия сайт (например „страницата не е намерена“)**: правилото не хваща адреса. Проверете, че е за `/t/` и за точния домейн.
- **Менюто, но без името на масата**: препращането губи края на адреса. Включете запазване на пътя („wildcard“, „preserve path“).

## Какво се случва със стикерите

- „Нов код“ за маса прави стария стикер неработещ: пише, че кодът не е активен. Затова пита за потвърждение.
- „Изключи кода“ прави същото, без да създава нов.
- Ако barsy изтрие масата, кодът ѝ се изключва автоматично при следващото синхронизиране.
- Смяната на адреса в картата не променя вече отпечатаните стикери.

<!-- lang:en -->
# Table QR codes: our link or the venue's own link

This guide is for the venue manager. It explains which address the QR code on each table carries, and how to use an address on your own website instead of ours. The first option needs no technical knowledge; for the second you will need whoever looks after your website or domain.

The setting is in the Tables & QR tab, in the "Address in the codes" card.

## Two ways

**Option 1: our link.** The code opens an address like `<our-address>/t/<table-code>`. Nothing to set up.

**Option 2: your own link.** The code opens an address on your own domain, for example `<your-domain>/t/<table-code>`, and your website forwards the guest to our address. The stickers carry your name, and they keep working even if we ever change our address.

If you are not sure, start with Option 1. You can move to Option 2 later, but stickers that are already printed keep the address they were printed with.

## Option 1: our link

1. Open the Tables & QR tab.
2. In the "Address in the codes" card choose "Our link".
3. Click "Create codes for all tables".
4. Click "Print sheet", then "Print / Save as PDF".

While we build the system, the "Base address" is the address of the computer the app runs on. To scan from a phone on the same Wi-Fi, type this computer's network address, for example `http://192.168.1.20:3000`. When the system has its permanent address we will set it here and print the stickers again.

## Option 2: your own link

You need one forwarding rule on your website or domain: everything that starts with `https://<your-domain>/t/` is forwarded to `https://<our-address>/t/`, and the rest of the address is kept. The table's code is in that rest, so it must be kept.

"Our address" is the "Base address" in the "Address in the codes" card (with "Our link" chosen). "Your domain" is the domain or subdomain that will be printed on the stickers, for example `menu.<your-domain>`.

Make the forwarding a **temporary** (302) redirect, not a permanent (301) one: that way we can change our address without guests' browsers remembering the old one.

### Example 1: Cloudflare (Redirect Rules)

1. Sign in to Cloudflare, choose your domain and open "Rules", then "Redirect Rules".
2. Create a new rule ("Create rule") and name it, for example "Table menu".
3. Under "When incoming requests match" choose "Custom filter expression" and enter: `(http.host eq "<your-domain>" and starts_with(http.request.uri.path, "/t/"))`.
4. Under "Then" choose "Dynamic" and enter the expression: `concat("https://<our-address>", http.request.uri.path)`.
5. Choose status code 302 and turn on "Preserve query string".
6. Save and deploy the rule ("Deploy").

The subdomain (for example `menu.<your-domain>`) must point to Cloudflare with proxying on, so that the rules apply.

### Example 2: ordinary hosting (control panel or configuration file)

Look for "Redirects" or "URL redirects" in the hosting control panel. Choose a temporary (302) redirect, with "wildcard" or "keep the path", from `https://<your-domain>/t/` to `https://<our-address>/t/`.

If your hosting uses Apache, the same is written in the site's `.htaccess` file:

```
RedirectMatch 302 ^/t/(.*)$ https://<our-address>/t/$1
```

If you use nginx, the rule is:

```
location /t/ {
    return 302 https://<our-address>$request_uri;
}
```

### Example 3: a website builder

Most builders have "Redirects", "URL redirects" or "URL mappings" in the site settings. What matters is whether it allows one rule for every address that starts with `/t/` (a "wildcard").

- If it does, enter `/t/*` as the source and `https://<our-address>/t/*` as the target, temporary (302).
- If it allows only one address per rule, you need one rule for each table: from `/t/<table-code>` to `https://<our-address>/t/<table-code>`. You see each table's code by clicking the small QR code of the table in the Tables & QR tab. In that case Option 1 is more practical, or ask whoever looks after your site to do it.

### When the forwarding is ready

1. In the "Address in the codes" card choose "The venue's own link".
2. In "Link pattern" write your address with `{token}` where the table's code goes, for example `https://<your-domain>/t/{token}`.
3. Under the field you see an example with the code of one of your tables. Click "Open test link": in a new browser tab the menu should open, with the table's name at the top.
4. Click "Save address", then "Print sheet" and print.

The test link is opened by your browser. Our server never opens the address you typed.

## If the forwarding breaks

The stickers carry an address on your domain and work only while the forwarding rule works. If the rule is deleted or the domain expires, the guest sees an error from your website instead of the menu.

- Put the rule back. The stickers work again at once, with no new print.
- If you cannot, choose "Our link", create a new sheet and print it. The old stickers stay broken.

If "Open test link" shows:

- **"This table code is not active"**: the forwarding works, but the code is turned off or replaced. Check the table in the list.
- **An error from your website (for example "page not found")**: the rule does not match the address. Check that it is for `/t/` and for the exact domain.
- **The menu, but without the table's name**: the forwarding loses the end of the address. Turn on keeping the path ("wildcard", "preserve path").

## What happens to the stickers

- "New code" for a table makes the old sticker stop working: it says the code is not active. That is why it asks you to confirm.
- "Turn off code" does the same without making a new one.
- If barsy deletes the table, its code is turned off automatically at the next sync.
- Changing the address in the card does not change stickers that are already printed.
