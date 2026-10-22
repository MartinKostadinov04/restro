// The control page (#71; #51 design §2.5): the simulated POS's own screen, one self-contained HTML
// page served at `/control`. It is not part of the admin and never in Tonight: no POS-shaped code
// reaches the platform. The page itself carries no data and no secret; its data calls
// (`/control/api/*`) need the token from the environment when one is set, which the page asks for
// and keeps in this tab's session storage. Every value is written with `textContent`, never as
// markup.

export const CONTROL_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Simulated POS</title>
<style>
  :root { color-scheme: light dark; --line: #8884; --muted: #888; --accent: #2563eb; --bad: #c2410c; }
  * { box-sizing: border-box; }
  body { font: 14px/1.4 system-ui, sans-serif; margin: 0 auto; max-width: 1200px; padding: 12px 16px 48px; }
  h1 { font-size: 18px; margin: 0; }
  h2 { font-size: 15px; margin: 24px 0 8px; }
  header { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between; }
  .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  input, select, button { font: inherit; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: inherit; }
  button { cursor: pointer; }
  button.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  .muted { color: var(--muted); }
  .bad { color: var(--bad); }
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }
  .card { border: 1px solid var(--line); border-radius: 8px; padding: 10px; }
  .card h3 { font-size: 14px; margin: 0 0 6px; display: flex; justify-content: space-between; gap: 8px; }
  .tag { border: 1px solid var(--line); border-radius: 99px; padding: 0 8px; font-size: 12px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { text-align: left; padding: 2px 6px 2px 0; vertical-align: top; }
  td.num, th.num { text-align: right; }
  .mono { font-family: ui-monospace, monospace; font-size: 12px; }
  details { margin-top: 6px; }
  #message { min-height: 1.4em; margin: 8px 0; }
  form.op { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
  form.op label { display: grid; gap: 2px; font-size: 12px; }
  .calls { max-height: 260px; overflow: auto; border: 1px solid var(--line); border-radius: 8px; padding: 6px; }
</style>
</head>
<body>
<header>
  <h1>Simulated POS <span id="scenario" class="muted"></span></h1>
  <div class="bar">
    <input id="token" type="password" placeholder="control token" autocomplete="off" aria-label="control token">
    <select id="scenario-pick" aria-label="scenario"></select>
    <button id="load" class="primary">Load scenario</button>
    <button id="refresh">Refresh</button>
    <label class="muted"><input id="auto" type="checkbox" checked> auto</label>
  </div>
</header>
<p class="muted" id="description"></p>
<div id="message" role="status"></div>

<h2>Waiter operation</h2>
<form class="op" id="op-form">
  <label>Operation <select id="op-name"></select></label>
  <span id="op-params" class="bar"></span>
  <button class="primary" type="submit">Do it</button>
</form>
<p class="muted" id="op-summary"></p>

<h2>Tickets per bar</h2>
<div class="grid" id="bars"></div>

<h2>Tables</h2>
<div class="grid" id="tables"></div>

<h2>Call log</h2>
<div class="calls"><table id="calls"></table></div>

<script>
(() => {
  const $ = (id) => document.getElementById(id)
  const tokenInput = $('token')
  tokenInput.value = sessionStorage.getItem('sim-token') || ''
  let view = null
  let opsByName = {}

  const money = (minor) => (minor < 0 ? '-' : '') + (Math.abs(minor) / 100).toFixed(2)
  const el = (tag, text, className) => {
    const node = document.createElement(tag)
    if (text !== undefined && text !== null) node.textContent = String(text)
    if (className) node.className = className
    return node
  }
  const say = (text, bad) => { const m = $('message'); m.textContent = text; m.className = bad ? 'bad' : 'muted' }

  async function call(path, body) {
    const headers = { 'x-sim-token': tokenInput.value }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error || ('HTTP ' + response.status))
    return data
  }

  async function act(op, args) {
    try {
      const result = await call('/control/api/waiter/' + op, args)
      say(op + ': ' + JSON.stringify(result.result))
    } catch (error) { say(op + ' refused: ' + error.message, true) }
    await refresh()
  }

  function renderParams() {
    const op = opsByName[$('op-name').value]
    const box = $('op-params')
    box.replaceChildren()
    $('op-summary').textContent = op ? op.summary : ''
    if (!op) return
    for (const param of op.params) {
      const label = el('label', param.name + (param.required ? '' : ' (optional)'))
      const input = el('input')
      input.name = param.name
      input.placeholder = param.hint
      input.size = 18
      label.append(input)
      box.append(label)
    }
  }

  function renderBars() {
    const box = $('bars'); box.replaceChildren()
    for (const bar of view.bars) {
      const card = el('div', null, 'card')
      const title = el('h3'); title.append(el('span', bar.name)); title.append(el('span', bar.tickets.length + ' ticket(s)', 'muted'))
      card.append(title)
      if (bar.tickets.length === 0) card.append(el('div', 'Nothing printed.', 'muted'))
      for (const ticket of bar.tickets) {
        const d = el('details'); const s = el('summary', ticket.at.slice(11, 19) + ' table ' + ticket.table + ' ' + ticket.kind + ' by ' + ticket.by)
        d.append(s)
        for (const row of ticket.rows) d.append(el('div', row.quantity + ' x ' + row.name + (row.note ? ' (' + row.note + ')' : ''), 'mono'))
        card.append(d)
      }
      box.append(card)
    }
  }

  function renderTables() {
    const box = $('tables'); box.replaceChildren()
    const barName = Object.fromEntries(view.bars.map((b) => [b.id, b.name]))
    for (const table of view.tables) {
      const card = el('div', null, 'card')
      const title = el('h3')
      title.append(el('span', 'Table ' + table.number + ' \\u00b7 ' + table.hall))
      title.append(el('span', (table.payment ? 'payment \\u00b7 ' : '') + (barName[table.bar] || ''), 'tag'))
      card.append(title)
      if (table.bills.length === 0) card.append(el('div', 'No open bill.', 'muted'))
      for (const bill of table.bills) {
        const head = el('div', null, 'bar')
        head.append(el('strong', money(bill.totalMinor) + ' EUR'))
        head.append(el('span', 'bill ' + bill.id + ' by ' + bill.openedBy + (bill.lockedBy ? ' \\u00b7 locked by ' + bill.lockedBy : ''), 'muted mono'))
        card.append(head)
        const list = el('table')
        for (const row of bill.rows) {
          const tr = el('tr')
          tr.append(el('td', row.quantity + ' x ' + row.name + (row.pending ? ' (waiting)' : '')))
          tr.append(el('td', money(row.amountMinor), 'num'))
          tr.append(el('td', row.id, 'mono muted'))
          const cell = el('td'); const b = el('button', 'void'); b.onclick = () => act('void-line', { bill: bill.id, row: row.id }); cell.append(b); tr.append(cell)
          list.append(tr)
        }
        card.append(list)
        const buttons = el('div', null, 'bar')
        for (const [label, name, args] of [['close cash', 'close-bill', { bill: bill.id, kind: 'cash' }], ['close card', 'close-bill', { bill: bill.id, kind: 'card' }], [bill.lockedBy ? 'unlock' : 'lock', bill.lockedBy ? 'unlock-bill' : 'lock-bill', { bill: bill.id }]]) {
          const b = el('button', label); b.onclick = () => act(name, args); buttons.append(b)
        }
        card.append(buttons)
      }
      box.append(card)
    }
  }

  function renderCalls() {
    const t = $('calls'); t.replaceChildren()
    for (const c of view.calls) {
      const tr = el('tr')
      tr.append(el('td', c.seq, 'mono muted'), el('td', c.at.slice(11, 19), 'mono'), el('td', c.login || '-', 'mono'), el('td', c.method + (c.write ? ' (write)' : ''), 'mono'), el('td', c.status, c.status === 200 ? 'mono' : 'mono bad'), el('td', (c.faults || []).join(', '), 'mono muted'))
      t.append(tr)
    }
  }

  async function refresh() {
    sessionStorage.setItem('sim-token', tokenInput.value)
    try { view = await call('/control/api/state') } catch (error) { say(error.message, true); return }
    $('scenario').textContent = '\\u00b7 ' + view.scenario.name + ' (' + view.scenario.profile + ')' + (view.scenario.chaosSeed !== null ? ' \\u00b7 chaos seed ' + view.scenario.chaosSeed : '') + (view.training ? ' \\u00b7 TRAINING' : '') + (view.printerDown ? ' \\u00b7 PRINTER DOWN' : '')
    $('description').textContent = view.scenario.description
    const pick = $('scenario-pick')
    if (pick.options.length !== view.scenario.scenarios.length) {
      pick.replaceChildren(...view.scenario.scenarios.map((name) => { const o = el('option', name); o.value = name; return o }))
      pick.value = view.scenario.name
    }
    const names = $('op-name')
    if (names.options.length !== view.ops.length) {
      opsByName = Object.fromEntries(view.ops.map((op) => [op.name, op]))
      names.replaceChildren(...view.ops.map((op) => { const o = el('option', op.name); o.value = op.name; return o }))
      renderParams()
    }
    renderBars(); renderTables(); renderCalls()
  }

  $('op-name').onchange = renderParams
  $('op-form').onsubmit = (event) => {
    event.preventDefault()
    const args = {}
    for (const input of $('op-params').querySelectorAll('input')) if (input.value !== '') args[input.name] = input.value
    act($('op-name').value, args)
  }
  $('load').onclick = async () => {
    try { await call('/control/api/scenario', { name: $('scenario-pick').value }); say('loaded ' + $('scenario-pick').value) } catch (error) { say(error.message, true) }
    await refresh()
  }
  $('refresh').onclick = refresh
  tokenInput.onchange = refresh
  setInterval(() => { if ($('auto').checked) refresh() }, 3000)
  refresh()
})()
</script>
</body>
</html>
`
