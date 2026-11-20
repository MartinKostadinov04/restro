// MOCKUP ONLY. Throwaway prototype for the navigation plan (2026-11-18, revised 11-19); no build
// step, no data, nothing persists. State lives in the URL: ?persona=&screen= (the bar at the bottom
// sets it). Tonight's pages draw only what tonight's build ships; everything later is drawn by
// laterHtml() on feature-bases.html, under a "По-късно / Later" banner.
// One list declares every entry once, the way the plan's venue-nav-defs.ts does.

const GROUPS = [
  {
    id: 'menu',
    bg: 'Меню',
    en: 'Menu',
    base: null,
    entries: [
      {
        id: 'studio',
        bg: 'Студио',
        en: 'Studio',
        ic: '☰',
        who: 'personal',
        views: ['Структура', 'Дизайн ↗'],
      },
      { id: 'tables', bg: 'Маси и QR', en: 'Tables & QR', ic: '▦', who: 'personal' },
    ],
  },
  {
    id: 'ordering',
    bg: 'Поръчки',
    en: 'Ordering',
    base: 'ordering',
    entries: [
      {
        id: 'tonight',
        bg: 'Тази вечер',
        en: 'Tonight',
        ic: '🔔',
        who: 'all',
        service: true,
        views: ['Действия и маси', 'Поръчки', 'Дневник', 'Край на вечерта'],
      },
      {
        id: 'ordering-settings',
        bg: 'Настройки',
        title: 'Настройки на поръчките',
        en: 'Ordering settings',
        ic: '⚙',
        who: 'personal',
        views: ['Работно време', 'Поръчки', 'Плащане', 'Известия'],
      },
    ],
  },
  {
    id: 'reservations',
    bg: 'Резервации',
    en: 'Reservations',
    base: 'reservations',
    entries: [
      {
        id: 'night',
        bg: 'Резервации',
        en: 'Reservations',
        ic: '📅',
        who: 'rsv',
        service: true,
        views: ['Списък', 'План', 'Гости'],
      },
      {
        id: 'reservations-settings',
        bg: 'Настройки',
        title: 'Настройки на резервациите',
        en: 'Reservation settings',
        ic: '⚙',
        who: 'personal',
      },
    ],
  },
  // Later only (not built): drawn on the "По-късно / Later" page.
  {
    id: 'requests',
    bg: 'Заявки за песни',
    en: 'Song requests',
    base: 'requests',
    later: true,
    entries: [
      { id: 'queue', bg: 'Опашка', en: 'Request queue', ic: '♪', who: 'dj', service: true },
      {
        id: 'requests-settings',
        bg: 'Настройки',
        title: 'Настройки на заявките',
        en: 'Song request settings',
        ic: '⚙',
        who: 'personal',
      },
    ],
  },
  {
    id: 'venue',
    bg: 'Заведение',
    en: 'Venue',
    base: null,
    entries: [
      {
        id: 'settings',
        bg: 'Настройки',
        title: 'Настройки на заведението',
        en: 'Venue settings',
        ic: '⚙',
        who: 'personal',
        views: ['Общи', 'Персонал и роли', 'Публикуване', 'Версии'],
      },
    ],
  },
]

// What each persona holds today. `personal`: their own sign-in; `staffOnly`: not an owner or admin,
// one venue (D141 landing); `rsv`: reservations.tonight; `device`: a shared tablet (D122 §7).
const PERSONAS = {
  owner: {
    bg: 'Собственик',
    en: 'Owner',
    personal: true,
    rsv: true,
    canCreate: true,
    publish: true,
    name: 'Мартин К.',
  },
  manager: {
    bg: 'Управител (свой вход)',
    en: 'Manager, own sign-in',
    personal: true,
    rsv: true,
    name: 'Елена Д.',
  },
  waiter: {
    bg: 'Сервитьор (свой телефон)',
    en: 'Waiter, own phone',
    personal: true,
    staffOnly: true,
    rsv: false,
    name: 'Иво П.',
  },
  door: {
    bg: 'Хост на входа (свой телефон)',
    en: 'Door host, own phone',
    personal: true,
    staffOnly: true,
    rsv: true,
    name: 'Мария С.',
  },
  shared: {
    bg: 'Общо устройство',
    en: 'Shared device',
    device: true,
    rsv: true,
    name: 'Таблет „Вход“',
  },
}

const TONIGHT_BASES = ['ordering', 'reservations']
const q = new URLSearchParams(location.search)
const state = {
  persona: q.get('persona') || document.body.dataset.persona || 'owner',
  screen: q.get('screen') || '',
  sheet: false,
  switcher: false,
  device: false,
}

// opts (later only): bases, staffRule (decision 157), flat (decision 156 B).
function shows(p, e, opts = {}) {
  if (e.who === 'all') return true
  if (e.who === 'rsv') return p.rsv
  if (e.who === 'dj') return !p.device && !p.staffOnly
  if (p.device) return false
  if (opts.staffRule && p.staffOnly) return false
  return true
}
function entriesFor(persona, opts = {}) {
  const p = PERSONAS[persona]
  const bases = opts.bases || TONIGHT_BASES
  return GROUPS.filter(
    (g) => (g.base === null || bases.includes(g.base)) && (!g.later || opts.bases),
  )
    .map((g) => ({
      ...g,
      entries: g.entries.filter(
        (e) => shows(p, e, opts) && !(opts.flat && e.title && e.id !== 'settings'),
      ),
    }))
    .filter((g) => g.entries.length > 0)
}
const flat = (groups) => groups.flatMap((g) => g.entries.map((e) => ({ ...e, group: g })))
// Where each persona lands (D141): staff on their first service screen, the device on Tonight.
function landing(persona, opts) {
  const p = PERSONAS[persona]
  const all = flat(entriesFor(persona, opts))
  if (p.device) return 'tonight'
  if (!p.staffOnly) return 'studio'
  return ['night', 'tonight'].find((id) => all.some((e) => e.id === id)) || all[0]?.id
}
function current(opts) {
  const all = flat(entriesFor(state.persona, opts))
  return (
    all.find((e) => e.id === state.screen) || all.find((e) => e.id === landing(state.persona, opts))
  )
}
const settingsName = (e) => e.title || e.bg

function switcherHtml(p, interactive) {
  const menu = !p.staffOnly
  return `<div style="position:relative">
    <button class="switcher" ${menu && interactive ? 'data-act="switcher"' : ''} aria-label="Смени заведението / Switch venue">
      <span class="mark">B</span><span>Club Biad</span>${menu ? '<span class="chev">⌄</span>' : ''}
    </button>
    ${state.switcher && menu && interactive ? `<div class="menu"><div><b>Club Biad</b> ✓</div><div>Bar Terasa</div><hr><div>▦ Всички заведения · All venues</div>${p.canCreate ? '<div>＋ Ново заведение · New venue</div>' : ''}</div>` : ''}
  </div>`
}

function sidebarHtml(persona, screen, opts = {}) {
  const p = PERSONAS[persona]
  const groups = entriesFor(persona, opts)
  const entry = (e, g) => {
    const name = e.title ? `${e.title}` : e.bg
    return `<button class="entry ${e.id === screen ? 'on' : ''}" data-go="${e.id}" title="${name}" aria-label="${name}"${e.id === screen ? ' aria-current="page"' : ''}><span class="ic">${e.ic}</span>${e.bg}<span class="en">${e.en}</span></button>`
  }
  const body = opts.flat
    ? `<div class="group">${flat(groups)
        .map((e) => entry(e, e.group))
        .join('')}</div>`
    : groups
        .map(
          (g) =>
            `<div class="group"><h4>${g.bg} · ${g.en}</h4>${g.entries.map((e) => entry(e, g)).join('')}</div>`,
        )
        .join('')
  return `<aside class="side ${opts.alone ? 'alone' : ''}" aria-label="Навигация в заведението">
    ${switcherHtml(p, !opts.alone)}
    ${body}
    ${opts.staffRule && p.staffOnly ? '' : '<div class="group"><h4>Организация · Organisation</h4><button class="entry" title="Настройки на организацията"><span class="ic">⚙</span>Настройки<span class="en">Settings</span></button></div>'}
    <div class="foot">
      <button class="entry"><span class="ic">🏢</span>Club Biad Group<span class="en">⌄</span></button>
      <button class="entry"><span class="ic">👤</span>${p.name}<span class="en">език · тема · изход</span></button>
    </div></aside>`
}

function viewsHtml(entry, phone) {
  if (!entry || !entry.views || entry.views.length < 2) return ''
  // Tonight a phone keeps today's dropdown; with the bottom bar (ticket 5) it becomes a scrolling row with a fade (K8).
  if (phone === 'bar')
    return `<div class="views fade" role="tablist">${entry.views.map((v, i) => `<span class="${i === 0 ? 'on' : ''}">${v}</span>`).join('')}</div>`
  if (phone) return `<div class="select" aria-label="Изглед">${entry.views[0]}<span>⌄</span></div>`
  return `<div class="views" role="tablist">${entry.views.map((v, i) => `<span class="${i === 0 ? 'on' : ''}">${v}</span>`).join('')}</div>`
}

function pageHtml(entry, phone, opts = {}) {
  const p = PERSONAS[opts.persona || state.persona]
  if (!entry)
    return '<div class="page"><div class="inside">Тази роля няма екран тук.<br>This role has no screen here.</div></div>'
  const publish = p.publish && !p.device && entry.id !== 'tonight'
  const settingsBtn = opts.flat && entry.service ? '<button class="btn">⚙ Настройки</button>' : ''
  return `<div class="page">
    <div class="titlerow"><div><h1>${settingsName(entry)}</h1><code class="addr">/m/biad/club-biad</code></div>
      <span class="pub">${settingsBtn}${publish ? `${phone ? '' : '<button class="btn">Виж страницата за гости</button> '}<button class="btn primary">Публикувай</button>` : ''}</span></div>
    ${viewsHtml(entry, phone)}
    <div class="inside">Вътрешността на екрана остава както е днес.<br>The inside of this screen stays as it is today.${entry.id === 'studio' ? '<br><br>„Дизайн“ отваря своята страница, както днес.<br>“Design” opens its own page, as today.' : ''}</div></div>`
}

function crumbHtml(p, showTrigger = true) {
  return `<div class="crumb">${showTrigger ? '<button class="trigger" data-act="sheet" aria-label="Странична лента / Sidebar">☰</button>' : ''}
    ${p.staffOnly ? '<b>Club Biad</b>' : '<span>Заведения</span><span>›</span><b>Club Biad</b>'}</div>`
}

function desktopHtml() {
  const p = PERSONAS[state.persona]
  if (p.device) return deviceHtml(true)
  const entry = current()
  return `<div class="desk">${sidebarHtml(state.persona, entry?.id)}
    <div class="main">${crumbHtml(p)}${pageHtml(entry, false)}</div></div>`
}

function phoneHtml() {
  const p = PERSONAS[state.persona]
  if (p.device) return deviceHtml(false)
  const entry = current()
  return `<div class="phone">${crumbHtml(p)}${pageHtml(entry, true)}
    ${state.sheet ? `<div class="sheet left" data-act="sheet"><div>${sidebarHtml(state.persona, entry?.id)}</div></div>` : ''}
  </div>`
}

// A shared device (D122 §7, D153): no sidebar, no venue list, no organisation switcher; today's row
// of two; its own name top right opens language, theme and sign-out (K2).
function deviceHtml(wide) {
  const all = flat(entriesFor('shared'))
  const entry = all.find((e) => e.id === state.screen) || all[0]
  return `<div class="phone ${wide ? 'wide' : ''}">
    <div class="crumb"><b>Club Biad</b>
      <span style="margin-left:auto;position:relative"><button class="btn" data-act="device" aria-label="Език, тема и изход">${PERSONAS.shared.name} ⌄</button>
      ${state.device ? '<div class="menu" style="right:0"><div>🌐 Език · Language: <b>Български</b> / English</div><div>◐ Тема · Theme: светла / тъмна / системна</div><hr><div>⎋ Изход · Sign out</div></div>' : ''}</span></div>
    <div class="row2">${all.map((e) => `<button class="${e.id === entry.id ? 'on' : ''}" data-go="${e.id}">${e.bg}</button>`).join('')}</div>
    <div class="page"><div class="inside">Вътрешността на екрана остава както е днес.<br>The inside of this screen stays as it is today.</div></div></div>`
}

// ---- Later / По-късно (feature-bases.html): pieces that are tickets or decisions, not tonight. ----
function barFor(persona, opts) {
  const all = flat(entriesFor(persona, opts))
  const order = ['night', 'tonight', 'queue', 'studio']
  return order
    .map((id) => all.find((e) => e.id === id))
    .filter(Boolean)
    .slice(0, 4)
}
function phoneWithBar(persona, opts, screen, note) {
  const p = PERSONAS[persona]
  const bar = barFor(persona, opts)
  const entry = flat(entriesFor(persona, opts)).find((e) => e.id === screen) || bar[0]
  const hasBar = bar.length >= 2
  // K10: with fewer than two destinations there is no bar; the top row carries the person's name menu.
  const head = hasBar
    ? crumbHtml(p, false)
    : `<div class="crumb"><b>Club Biad</b><span style="margin-left:auto"><button class="btn">${p.name} ⌄</button></span></div>`
  return `<div><p class="caption">${note}</p><div class="phone">${head}${pageHtml(entry, hasBar ? 'bar' : true, { persona })}
    ${screen === 'studio' ? '<div class="selbar">3 избрани · Скрий · Изчерпано · ⋯</div>' : ''}
    ${hasBar ? `<nav class="bar">${bar.map((e) => `<button class="${e.id === entry.id ? 'on' : ''}"><span class="ic">${e.ic}</span>${e.bg}</button>`).join('')}<button><span class="ic">⋯</span>Още</button></nav>` : ''}
  </div></div>`
}
function laterHtml() {
  const persona = state.persona === 'shared' ? 'owner' : state.persona
  const sets = [
    ['Само менюто · Menu only', []],
    ['+ Поръчки · Ordering', ['ordering']],
    ['+ Резервации · Reservations', ['ordering', 'reservations']],
    ['+ Заявки за песни · Song requests (not built)', ['ordering', 'reservations', 'requests']],
  ]
  const modules = {
    ...GROUPS.find((g) => g.id === 'venue').entries[0],
    views: ['Общи', 'Персонал и роли', 'Публикуване', 'Версии', 'Модули'],
  }
  return `<section class="later-block"><h2>1 · Модули, включвани за всяко заведение · Modules switched on per venue <small>ticket 2, decision 155</small></h2>
    <p class="caption">Изключен модул не се рисува и не се отваря. Превключва се в Заведение › Настройки › Модули. · An off module is neither drawn nor opened.</p>
    <div class="grid4">${sets.map(([label, bases]) => `<div><p class="caption"><b>${label}</b></p>${sidebarHtml(persona, landing(persona, { bases }), { alone: true, bases })}</div>`).join('')}</div>
    <div class="desk" style="margin-top:16px;min-height:0"><div class="main">${crumbHtml(PERSONAS.owner)}<div class="page"><h1>Настройки на заведението</h1>${viewsHtml(modules, false).replace('<span class="">Модули</span>', '<span class="on">Модули</span>').replace('<span class="on">Общи</span>', '<span class="">Общи</span>')}
      <div class="inside" style="min-height:0;place-items:stretch;text-align:left">
        <div class="card"><b>Поръчки</b> · Поръчки на масата и Тази вечер <span class="sw on"></span></div>
        <div class="card"><b>Резервации</b> · Резервации, планът и гостите <span class="sw on"></span></div>
        <div class="card"><b>Заявки за песни</b> · DJ опашка <span class="sw"></span></div></div></div></div></div>
  </section>
  <section class="later-block"><h2>2 · Долна лента на телефона · Phone bottom bar <small>ticket 5, decision 154</small></h2>
    <p class="caption">Екраните за вечерта, после Студио, после „Още“. Лентата за избор в Студиото стои над нея. Под две места: без лента. · Service screens, Studio, More; the Studio's selection bar sits above it; under two destinations, no bar.</p>
    <div class="stage" style="padding:0;justify-content:flex-start">
      ${phoneWithBar('owner', {}, 'studio', '<b>Собственик</b>, Студио с избрани артикули')}
      ${phoneWithBar('door', {}, 'night', '<b>Хост на входа</b>, свой телефон')}
      ${phoneWithBar('waiter', { staffRule: true }, 'tonight', '<b>Сервитьор</b> с правилото на решение 157: едно място, без лента')}
    </div></section>
  <section class="later-block"><h2>3 · Кой какво отваря · Who opens what <small>ticket 4, decision 157</small></h2>
    <p class="caption">Служител със свой вход вижда и отваря само екраните си за вечерта. · A staff-only sign-in sees and opens only its service screens.</p>
    <div class="grid4">
      <div><p class="caption"><b>Сервитьор · Waiter</b></p>${sidebarHtml('waiter', 'tonight', { alone: true, staffRule: true })}</div>
      <div><p class="caption"><b>Хост на входа · Door host</b></p>${sidebarHtml('door', 'night', { alone: true, staffRule: true })}</div>
    </div></section>
  <section class="later-block"><h2>4 · Решение 156, вариант Б: без отделни „Настройки“ в лентата · Decision 156, option B (flat)</h2>
    <p class="caption">Един запис на модул; настройките му са бутон на неговия екран. Препоръката е вариант А (тази вечер). · One entry per module; its settings are a button on its screen. The recommendation is A, built tonight.</p>
    <div class="desk">${sidebarHtml('owner', 'tonight', { flat: true, bases: TONIGHT_BASES })}<div class="main">${crumbHtml(PERSONAS.owner)}${pageHtml(GROUPS[1].entries[0], false, { flat: true, persona: 'owner' })}</div></div>
  </section>`
}

function protoBar() {
  const opt = (v, cur, label) =>
    `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`
  return `<div class="proto"><b>МАКЕТ · MOCKUP</b>
    <label>Кой / who <select data-set="persona">${Object.entries(PERSONAS)
      .map(([k, p]) => opt(k, state.persona, `${p.bg} · ${p.en}`))
      .join('')}</select></label>
    <code>persona=${state.persona} · screen=${state.screen || 'landing'}</code></div>`
}

function render() {
  const root = document.getElementById('app')
  const kind = document.body.dataset.kind
  if (kind === 'later') root.innerHTML = laterHtml()
  else if (kind === 'phone') root.innerHTML = phoneHtml()
  else if (kind === 'shared')
    root.innerHTML = `<div><p class="caption"><b>Телефон 390 px</b></p>${deviceHtml(false)}</div><div><p class="caption"><b>Таблет на бара или входа</b> · the same, wider</p>${deviceHtml(true)}</div>`
  else root.innerHTML = desktopHtml()
  document.getElementById('proto').innerHTML = kind === 'shared' ? '' : protoBar()
}

function push() {
  const p = new URLSearchParams({ persona: state.persona, screen: state.screen })
  history.replaceState(null, '', `?${p}`)
  render()
}
document.addEventListener('click', (ev) => {
  const go = ev.target.closest('[data-go]')
  const act = ev.target.closest('[data-act]')
  if (go) {
    state.screen = go.dataset.go
    state.sheet = false
    state.switcher = false
    push()
  } else if (act) {
    state[act.dataset.act] = !state[act.dataset.act]
    render()
  }
})
document.addEventListener('change', (ev) => {
  if (ev.target.dataset.set) {
    state.persona = ev.target.value
    state.screen = ''
  }
  push()
})
render()
