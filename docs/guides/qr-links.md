<!-- lang:bg -->
# QR кодове за масите: накъде водят

Това ръководство е за управителя на заведението. Обяснява какъв адрес носи QR кодът на всяка маса, как да отпечатате кодовете и как ще работи собствен линк от вашия сайт, когато заведението може да зададе свой домейн.

Всичко е в раздел „Маси и QR“, карта „Адрес в кодовете“.

## Два начина

**Вариант 1: нашият адрес.** Кодът отваря адрес от вида `<нашия-адрес>/t/<код-на-масата>`. Нищо не се настройва. Така работят всички кодове днес.

**Вариант 2: вашият собствен линк (по-късно).** Кодът ще отваря адрес от вашия домейн, например `<вашия-домейн>/t/<код-на-масата>`, а вашият сайт ще препраща госта към нашия адрес. Така стикерите ще носят вашето име. Настройката за това още я няма: картата пише „Собствен домейн за кодовете ще има по-късно.“ Препращането можете да подготвите и сега.

Стикерите, които вече са отпечатани, запазват адреса, с който са отпечатани.

## Вариант 1: нашият адрес

1. Отворете раздел „Маси и QR“.
2. В картата „Адрес в кодовете“, под „Кодовете водят до“, е адресът, който носи всеки код.
3. Натиснете „Създай кодове за всички маси“.
4. Натиснете „Отвори тестовия линк“: в нов раздел на браузъра трябва да се отвори менюто с името на една маса най-отгоре.
5. Натиснете „Лист за печат“, после „Печат / Запиши като PDF“.

## Вариант 2: вашият собствен линк (по-късно)

Ще е нужно едно правило за препращане в сайта или домейна ви: всичко, което започва с `https://<вашия-домейн>/t/`, се препраща към `https://<нашия-адрес>/t/`, като остатъкът от адреса се запазва. Кодът на масата е в остатъка, затова той трябва да се запази.

„Нашия адрес“ е адресът под „Кодовете водят до“ в картата „Адрес в кодовете“, без `/t/<code>` в края. „Вашия домейн“ е домейнът или поддомейнът, който ще пише на стикерите, например `menu.<вашия-домейн>`.

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
- Ако позволява само по един адрес, ще трябва по едно правило за всяка маса: от `/t/<код-на-масата>` към `https://<нашия-адрес>/t/<код-на-масата>`. Кода на всяка маса виждате, като натиснете малкия QR код на масата в раздел „Маси и QR“. Тогава е по-практично да останете на Вариант 1 или да помолите човека, който се грижи за сайта ви, да го направи.

### Когато собственият домейн стане наличен

Картата „Адрес в кодовете“ ще приема адреса ви като шаблон със `{token}` на мястото на кода на масата, например `https://<вашия-домейн>/t/{token}`. Преди да отпечатате, проверете с „Отвори тестовия линк“, че се отваря менюто с името на масата.

Тестовият линк се отваря от вашия браузър. Нашият сървър никога не отваря адреса на вашия сайт.

Дотогава кодовете носят нашия адрес. Той продължава да работи и след като добавите собствен домейн, така че стикерите, отпечатани сега, няма да се развалят.

## Ако препращането се развали

Стикерите с адрес от вашия домейн работят само докато правилото за препращане работи. Ако правилото бъде изтрито или домейнът изтече, гостът ще види грешка от вашия сайт, а не менюто.

- Върнете правилото. Стикерите започват да работят веднага, без нов печат.
- Ако не можете да го върнете, картата ще ви позволи да върнете кодовете на нашия адрес; след това отпечатайте нов „Лист за печат“ и сменете стикерите. Старите стикери ще продължат да не работят.

Ако „Отвори тестовия линк“ показва:

- **„Този код за маса не е активен“**: препращането работи, но кодът е изключен или сменен. Проверете масата в списъка.
- **Грешка от вашия сайт (например „страницата не е намерена“)**: правилото не хваща адреса. Проверете, че е за `/t/` и за точния домейн.
- **Менюто, но без името на масата**: препращането губи края на адреса. Включете запазване на пътя („wildcard“, „preserve path“).

## Какво се случва със стикерите

- „Нов код“ за маса прави стария стикер неработещ: пише, че кодът не е активен. Затова пита за потвърждение.
- „Изключи кода“ прави същото, без да създава нов.
- Ако POS системата изтрие масата, кодът ѝ се изключва автоматично при следващото синхронизиране.
- Смяната на адреса не променя вече отпечатаните стикери.

<!-- lang:en -->
# Table QR codes: where they lead

This guide is for the venue manager. It explains which address the QR code on each table carries, how to print the codes, and how a link on your own website will work once a venue can set a domain of its own.

Everything is in the Tables & QR tab, in the "Address in the codes" card.

## Two ways

**Option 1: our address.** The code opens an address like `<our-address>/t/<table-code>`. Nothing to set up. This is how every code works today.

**Option 2: your own link (comes later).** The code will open an address on your own domain, for example `<your-domain>/t/<table-code>`, and your website will forward the guest to our address. The stickers will then carry your name. The setting for it is not there yet: the card says "A domain of your own for the codes comes later." You can prepare the forwarding now.

Stickers that are already printed keep the address they were printed with.

## Option 1: our address

1. Open the Tables & QR tab.
2. In the "Address in the codes" card, under "Codes lead to", is the address every code carries.
3. Click "Create codes for all tables".
4. Click "Open test link": in a new browser tab the menu should open, with a table's name at the top.
5. Click "Print sheet", then "Print / Save as PDF".

## Option 2: your own link (comes later)

You will need one forwarding rule on your website or domain: everything that starts with `https://<your-domain>/t/` is forwarded to `https://<our-address>/t/`, and the rest of the address is kept. The table's code is in that rest, so it must be kept.

"Our address" is the address under "Codes lead to" in the "Address in the codes" card, without the `/t/<code>` at the end. "Your domain" is the domain or subdomain that will be printed on the stickers, for example `menu.<your-domain>`.

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
- If it allows only one address per rule, you need one rule for each table: from `/t/<table-code>` to `https://<our-address>/t/<table-code>`. You see each table's code by clicking the small QR code of the table in the Tables & QR tab. In that case staying with Option 1 is more practical, or ask whoever looks after your site to do it.

### When a domain of your own arrives

The "Address in the codes" card will take your address as a pattern with `{token}` where the table's code goes, for example `https://<your-domain>/t/{token}`. Before you print, check with "Open test link" that the menu opens with the table's name.

The test link is opened by your browser. Our server never opens your website's address.

Until then the codes carry our address. It keeps working after you add a domain of your own, so the stickers you print now will not break.

## If the forwarding breaks

Stickers with an address on your domain work only while the forwarding rule works. If the rule is deleted or the domain expires, the guest sees an error from your website instead of the menu.

- Put the rule back. The stickers work again at once, with no new print.
- If you cannot, the card will let you switch the codes back to our address; then print a new "Print sheet" and replace the stickers. The old stickers stay broken.

If "Open test link" shows:

- **"This table code is not active"**: the forwarding works, but the code is turned off or replaced. Check the table in the list.
- **An error from your website (for example "page not found")**: the rule does not match the address. Check that it is for `/t/` and for the exact domain.
- **The menu, but without the table's name**: the forwarding loses the end of the address. Turn on keeping the path ("wildcard", "preserve path").

## What happens to the stickers

- "New code" for a table makes the old sticker stop working: it says the code is not active. That is why it asks you to confirm.
- "Turn off code" does the same without making a new one.
- If the POS deletes the table, its code is turned off automatically at the next sync.
- Changing the address does not change stickers that are already printed.
