# Martin's actions for Stage 1

Three short tasks. None needs technical knowledge; each takes 5–15 minutes. Tell the lead agent in chat when each is done.

## 1. Supabase: create the Restro database (T37)
1. Go to https://supabase.com/dashboard and sign in (your usual account).
2. Top-left organisation menu → **New organization**. Name: `Restro`. Type: Personal. Plan: **Free**. Create.
3. In the new organisation → **New project**.
   - Name: `restro-staging`
   - Database password: click **Generate a password**, then save it in your password manager as "Supabase restro-staging DB". Do not paste it in chat.
   - Region: **Central EU (Frankfurt)**.
   - Create and wait about 2 minutes until the project is ready.
4. Switch off the public data API: in the project, **Project Settings → Data API** → turn **Enable Data API** off → Save. (We never use it; leaving it on would expose tables to the internet.)
5. Copy the **project reference**: Project Settings → General → "Reference ID" (about 20 letters). Paste only that reference in chat.
6. The lead agent will then ask you to paste the database password into a local file on this PC (`E:\Restro\.env.local`) — never into chat.

## 2. barsy demo password (T38)
1. Open https://www.barsy.bg/demo/
2. Fill in: company (Restro or your company), contact person, phone, a real email, "Как ни открихте" (any), type of venue **Клуб, Бар, Кафене**, region, and the anti-bot answer (type "барСи" backwards).
3. Submit. barsy emails a username and password for the demo installation.
4. Put them in `E:\Restro\.env.local` (the lead agent creates the file with empty lines for you):
   ```
   BARSY_HOST=https://demo.barsyonline.com
   BARSY_USER=<from the email>
   BARSY_PASSWORD=<from the email>
   BARSY_ENV=development
   ```
   Tell the lead agent "demo credentials are in .env.local" — never paste the password in chat.

## 3. Ask Lukanet for a test environment (T39)
Send this email from your usual address to **helpme@lukanet.com**. Edit the signature if needed.

**Subject:** Заявка за тестова среда — интеграция с Barsy API (QR поръчки за заведения)

> Здравейте,
>
> Казвам се Мартин Костадинов и разработвам Restro — уеб приложение за QR меню и поръчки от телефона за нощни клубове и барове, които работят с barsy. Гостът сканира QR код на масата, вижда менюто на български или английски, а по-късно ще може да поръча и плати от телефона си; поръчката трябва да влиза в barsy така, както ако я е въвел сервитьор.
>
> Съгласно раздел „Как да започна организиране на интеграцията" от документацията Ви, бих искал да заявя **тестова среда** за разработка.
>
> **Какво ще синхронизираме:** артикули, категории, модификатори, комбо групи, снимки, езици, валути, места (маси) и търговски обекти — само четене. По-късно: създаване на сметки с `Accounts_place` за поръчки от QR кода.
>
> **На какъв интервал:** инкрементално изтегляне на променените артикули на всеки 5 минути (`Articles_getlist` с `last_update`) и пълно изтегляне веднъж дневно извън работно време. Без webhooks на този етап.
>
> **Обеми:** пилот с няколко клуба, по няколкостотин артикула на заведение.
>
> **Молим за:**
> 1. Тестова инсталация, ако е възможно с тестов фискален принтер, на която да изпробваме и създаването на сметки, без да засягаме реално заведение.
> 2. Потвърждение дали достъпът **само за четене** (номенклатури) изисква платения „софтуерен ресурс", или той е нужен само при запис.
> 3. В каква часова зона са стойностите `last_update` и дали носят отместване (offset) — интересува ни преминаването към зимно време на 25 октомври.
> 4. Има ли параметър за checksum при `Categories_getalltree` (в описанието се споменава, но в списъка с параметри не фигурира)?
>
> Ще пазим `BARSY_REQUEST_ID` от всеки отговор, за да Ви подаваме структурирана информация при нужда.
>
> Благодаря предварително!
>
> Поздрави,
> Мартин Костадинов
> Restro
