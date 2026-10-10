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
4. Switch off the public data API: in the project, **Integrations → Data API** (older dashboards: Project Settings → Data API) → turn **Enable Data API** off → Save. (We never use it; leaving it on would expose tables to the internet.)
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

---

# Martin's actions for Stage 2

## 4. Cloudflare R2: storage for menu photos (~15 min)
1. Go to https://dash.cloudflare.com/sign-up and create a free account (or sign in if you have one).
2. In the left menu open **R2 Object Storage** → **Purchase R2 Plan** / **Get started**. Cloudflare asks for a payment card even for the free plan; the free tier (10 GB, 1M writes, 10M reads a month, free egress) costs nothing at our size.
3. **Create bucket**:
   - Name: `restro-assets-staging`
   - Location: **Specify jurisdiction → European Union (EU)**
   - Default storage class: Standard
   - Keep it **private** (do not enable public access or an r2.dev URL).
4. Back on the R2 overview page: **Manage API tokens** (also called "API" → "Manage R2 API Tokens") → **Create API token** (account token):
   - Name: `restro-staging`
   - Permissions: **Object Read & Write**
   - Specify bucket(s): **Apply to specific buckets only** → `restro-assets-staging`
   - TTL: Forever → **Create API Token**
5. The next page shows the values **only once**. Copy them straight into `E:\Restro\.env.local` (never into chat):
   ```
   R2_ACCOUNT_ID=<Account ID shown on the R2 overview page>
   R2_ACCESS_KEY_ID=<Access Key ID>
   R2_SECRET_ACCESS_KEY=<Secret Access Key>
   R2_BUCKET=restro-assets-staging
   R2_ENDPOINT=<the "EU" S3 endpoint shown, like https://<account id>.eu.r2.cloudflarestorage.com>
   ```
6. Tell the lead agent "R2 is in .env.local".

## 5. Lukanet docs sign-in (when the lead agent asks)
Press Ctrl+Shift+B to show the browser panel, sign in on the Lukanet page that is open, and say "signed in". The lead agent then checks every barsy call against the official docs (about 10 minutes); sessions expire after a while, so do it when asked.
