// MOCKUP ONLY. Throwaway prototype for the navigation plan (2026-11-18); no build step, no data,
// nothing persists. State lives in the URL: ?persona=&bases=&screen=  (the bar at the bottom sets it).
// One list declares every entry once, the way the plan's venue-nav-defs.ts would.

const GROUPS = [
  { id: 'menu', bg: 'Меню', en: 'Menu', base: null, entries: [
    { id: 'studio', bg: 'Студио', en: 'Studio', ic: '☰', who: 'office', views: ['Структура'], bar: 3 },
    { id: 'design', bg: 'Дизайн', en: 'Design', ic: '◐', who: 'office', bar: 4 },
    { id: 'tables', bg: 'Маси и QR', en: 'Tables & QR', ic: '▦', who: 'office', bar: 5 },
  ] },
  { id: 'ordering', bg: 'Поръчки', en: 'Ordering', base: 'ordering', entries: [
    { id: 'tonight', bg: 'Тази вечер', en: 'Tonight', ic: '🔔', who: 'tonight', badge: 2, bar: 0,
      views: ['Действия и маси', 'Поръчки', 'Дневник', 'Край на вечерта'] },
    { id: 'ordering-settings', bg: 'Настройки', en: 'Settings', ic: '⚙', who: 'office',
      views: ['Работно време', 'Поръчки', 'Плащане'] },
  ] },
  { id: 'reservations', bg: 'Резервации', en: 'Reservations', base: 'reservations', entries: [
    { id: 'night', bg: 'Вечерта', en: 'The night', ic: '📅', who: 'door', bar: 1, views: ['Списък', 'План', 'Гости'] },
    { id: 'reservations-settings', bg: 'Настройки', en: 'Settings', ic: '⚙', who: 'office' },
  ] },
  { id: 'requests', bg: 'Заявки за песни', en: 'Song requests', base: 'requests', entries: [
    { id: 'queue', bg: 'Опашка', en: 'Request queue', ic: '♪', who: 'dj', bar: 2 },
    { id: 'requests-settings', bg: 'Настройки', en: 'Settings', ic: '⚙', who: 'office' },
  ] },
  { id: 'venue', bg: 'Заведение', en: 'Venue', base: null, entries: [
    { id: 'settings', bg: 'Настройки', en: 'Settings', ic: '⚙', who: 'office',
      views: ['Общи', 'Персонал и роли', 'Известия', 'Публикуване', 'Версии', 'Функции'] },
  ] },
]

// What each persona's role may work. 'office' = everything but a staff-only sign-in or a device.
const PERSONAS = {
  owner: { bg: 'Собственик', en: 'Owner', sees: ['office', 'tonight', 'door', 'dj'], name: 'Мартин К.' },
  manager: { bg: 'Управител', en: 'Manager', sees: ['office', 'tonight', 'door'], name: 'Елена Д.' },
  waiter: { bg: 'Сервитьор (свой телефон)', en: 'Waiter, own phone', sees: ['tonight'], name: 'Иво П.' },
  door: { bg: 'Хост на входа (свой телефон)', en: 'Door host, own phone', sees: ['door', 'tonight'], name: 'Мария С.' },
  shared: { bg: 'Общо устройство', en: 'Shared device', sees: ['tonight', 'door'], name: 'Таблет „Вход“' },
}

const q = new URLSearchParams(location.search)
const state = {
  persona: q.get('persona') || document.body.dataset.persona || 'owner',
  bases: (q.get('bases') ?? document.body.dataset.bases ?? 'ordering,reservations').split(',').filter(Boolean),
  screen: q.get('screen') || document.body.dataset.screen || '',
  more: false, switcher: false,
}

function entriesFor(persona, bases) {
  const sees = PERSONAS[persona].sees
  return GROUPS.filter((g) => g.base === null || bases.includes(g.base))
    .map((g) => ({ ...g, entries: g.entries.filter((e) => sees.includes(e.who)) }))
    .filter((g) => g.entries.length > 0)
}
const flat = (groups) => groups.flatMap((g) => g.entries.map((e) => ({ ...e, group: g })))
// The phone's bar: service screens first, then the menu's, at most four; then "Още".
function barFor(persona, bases) {
  const all = flat(entriesFor(persona, bases)).filter((e) => e.bar !== undefined).sort((a, b) => a.bar - b.bar)
  return all.slice(0, 4)
}
function landing(persona, bases) {
  const all = flat(entriesFor(persona, bases))
  const order = persona === 'shared' ? ['tonight', 'night'] : ['night', 'tonight', 'queue']
  if (PERSONAS[persona].sees.includes('office')) return 'studio'
  return order.find((id) => all.some((e) => e.id === id)) || all[0]?.id
}

function sidebarHtml(persona, bases, screen, opts = {}) {
  const groups = entriesFor(persona, bases)
  const office = PERSONAS[persona].sees.includes('office')
  return `<aside class="side ${opts.alone ? 'alone' : ''}">
    <div style="position:relative">
      <button class="switcher" data-act="switcher" aria-label="Смени заведението / Switch venue">
        <span class="mark">B</span><span>Club Biad<small>На живо · Live</small></span>${office ? '<span class="chev">⌄</span>' : ''}
      </button>
      ${state.switcher && office && !opts.alone ? `<div class="menu"><div><b>Club Biad</b> ✓</div><div>Bar Terasa</div><hr><div>▦ Всички заведения · All venues</div><div>＋ Ново заведение · New venue</div></div>` : ''}
    </div>
    ${groups.map((g) => `<div class="group"><h4>${g.bg} · ${g.en}</h4>${g.entries.map((e) =>
      `<button class="entry ${e.id === screen ? 'on' : ''}" data-go="${e.id}"><span class="ic">${e.ic}</span>${e.bg}${e.badge && e.id !== screen ? `<span class="dot">${e.badge}</span>` : `<span class="en">${e.en}</span>`}</button>`).join('')}</div>`).join('')}
    <div class="foot">
      ${office ? '<button class="entry"><span class="ic">🏢</span>Организация<span class="en">Organisation</span></button>' : ''}
      <button class="entry"><span class="ic">👤</span>${PERSONAS[persona].name}<span class="en">език · изход</span></button>
    </div></aside>`
}

function pageHtml(entry, phone) {
  if (!entry) return '<div class="page"><div class="inside">Тази роля няма екран тук.<br>This role has no screen here.</div></div>'
  const views = entry.views && entry.views.length > 1
    ? `<div class="views" aria-label="Изгледи">${entry.views.map((v, i) => `<span class="${i === 0 ? 'on' : ''}">${v}</span>`).join('')}</div>` : ''
  return `<div class="page"><h1>${entry.bg}</h1><p class="sub">${entry.group.bg} › ${entry.bg} · ${entry.group.en} › ${entry.en}</p>${views}
    <div class="inside">Вътрешността на екрана остава както е днес.<br>The inside of this screen stays as it is today.${phone && views ? '<br><br>Редът с изгледи се плъзга настрани: няма падащо меню.<br>The row of views scrolls sideways: no dropdown.' : ''}</div></div>`
}

function desktopHtml() {
  const { persona, bases } = state
  const all = flat(entriesFor(persona, bases))
  const entry = all.find((e) => e.id === state.screen) || all.find((e) => e.id === landing(persona, bases))
  const menuScreen = entry && (entry.group.id === 'menu' || entry.id === 'settings')
  return `<div class="desk">${sidebarHtml(persona, bases, entry?.id)}
    <div class="main"><div class="crumb">${entry ? `${entry.group.bg} <span>›</span> <b>${entry.bg}</b>` : ''}
      ${menuScreen ? '<span class="pub"><button class="btn">Виж страницата за гости</button> <button class="btn primary">Публикувай</button></span>' : ''}</div>
      ${pageHtml(entry, false)}</div></div>`
}

function phoneHtml(wide) {
  const { persona, bases } = state
  const all = flat(entriesFor(persona, bases))
  const entry = all.find((e) => e.id === state.screen) || all.find((e) => e.id === landing(persona, bases))
  if (persona === 'shared') {
    // A shared device: one row, no sidebar, no venue list, no organisation switcher (D122 §7, S1, S3).
    return `<div class="phone ${wide ? 'wide' : ''}"><div class="ptop"><b>Club Biad</b><span class="right" style="color:var(--soft)">${PERSONAS.shared.name}</span></div>
      ${all.length > 1 ? `<div class="row2">${all.map((e) => `<button class="${e.id === entry.id ? 'on' : ''}" data-go="${e.id}">${e.bg}</button>`).join('')}</div>` : ''}
      ${pageHtml(entry, true)}</div>`
  }
  const bar = barFor(persona, bases)
  const office = PERSONAS[persona].sees.includes('office')
  const inBar = bar.some((e) => e.id === entry?.id)
  return `<div class="phone"><div class="ptop">
      <button class="vname" data-act="switcher"><span>Club Biad</span>${office ? '<span style="color:var(--soft)">⌄</span>' : ''}</button>
      ${entry && entry.group.id === 'menu' ? '<button class="btn primary right">Публикувай</button>' : ''}</div>
    ${pageHtml(entry, true)}
    <nav class="bar" aria-label="Навигация">${bar.map((e) => `<button class="${e.id === entry?.id ? 'on' : ''}" data-go="${e.id}"><span class="ic">${e.ic}</span>${e.bg}${e.badge && e.id !== entry?.id ? '<span class="dot"></span>' : ''}</button>`).join('')}
      <button class="${!inBar ? 'on' : ''}" data-act="more"><span class="ic">⋯</span>Още</button></nav>
    ${state.more ? `<div class="sheet"><div><button class="btn close" data-act="more">Затвори</button><p style="color:var(--soft);margin:8px">Още · More</p>${sidebarHtml(persona, bases, entry?.id).replace('class="side', 'class="side" style="width:auto;border:0;background:none" data-x="')}</div></div>` : ''}
  </div>`
}

function protoBar() {
  const opt = (v, cur, label) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${label}</option>`
  return `<div class="proto"><b>МАКЕТ · MOCKUP</b>
    <label>Кой / who <select data-set="persona">${Object.entries(PERSONAS).map(([k, p]) => opt(k, state.persona, `${p.bg} · ${p.en}`)).join('')}</select></label>
    ${['ordering', 'reservations', 'requests'].map((b) => `<label><input type="checkbox" data-base="${b}" ${state.bases.includes(b) ? 'checked' : ''}>${GROUPS.find((g) => g.base === b).bg}</label>`).join('')}
    <code>persona=${state.persona} · bases=${state.bases.join(',') || 'none'} · screen=${state.screen || 'landing'}</code></div>`
}

function render() {
  const root = document.getElementById('app')
  const kind = document.body.dataset.kind
  if (kind === 'bases') {
    const sets = [['Само менюто · Menu only', []], ['+ Поръчки · Ordering', ['ordering']], ['+ Резервации · Reservations', ['ordering', 'reservations']], ['+ Заявки за песни · Song requests (not built)', ['ordering', 'reservations', 'requests']]]
    root.innerHTML = `<div class="grid4">${sets.map(([label, bases]) => `<div><p class="caption"><b>${label}</b></p>${sidebarHtml(state.persona, bases, landing(state.persona, bases), { alone: true })}
      <nav class="bar">${barFor(state.persona, bases).map((e, i) => `<button class="${i === 0 ? 'on' : ''}"><span class="ic">${e.ic}</span>${e.bg}</button>`).join('')}<button><span class="ic">⋯</span>Още</button></nav></div>`).join('')}</div>`
  } else if (kind === 'phone') root.innerHTML = phoneHtml(false)
  else if (kind === 'shared') root.innerHTML = `<div><p class="caption"><b>Телефон 390 px</b></p>${phoneHtml(false)}</div><div><p class="caption"><b>Таблет на бара или входа</b> · the same row, wider</p>${phoneHtml(true)}</div>`
  else root.innerHTML = desktopHtml()
  document.getElementById('proto').innerHTML = protoBar()
}

function push() {
  const p = new URLSearchParams({ persona: state.persona, bases: state.bases.join(','), screen: state.screen })
  history.replaceState(null, '', `?${p}`)
  render()
}
document.addEventListener('click', (ev) => {
  const go = ev.target.closest('[data-go]'); const act = ev.target.closest('[data-act]')
  if (go) { state.screen = go.dataset.go; state.more = false; state.switcher = false; push() }
  else if (act) { state[act.dataset.act] = !state[act.dataset.act]; render() }
})
document.addEventListener('change', (ev) => {
  if (ev.target.dataset.set) { state.persona = ev.target.value; state.screen = '' }
  if (ev.target.dataset.base) {
    const b = ev.target.dataset.base
    state.bases = ev.target.checked ? [...state.bases, b] : state.bases.filter((x) => x !== b)
    state.screen = ''
  }
  push()
})
render()
