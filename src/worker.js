const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json;charset=UTF-8', 'cache-control': 'no-store' }
});

function dashboard() {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BotBet — Monitor</title><style>
  :root{color-scheme:dark;--bg:#07111f;--panel:#10213a;--line:#203857;--pink:#ff276f;--text:#edf4ff;--muted:#9fb1c9;--green:#29d693}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top right,#17386a 0,#07111f 45%);color:var(--text);font:15px Inter,system-ui,sans-serif}.wrap{max-width:1040px;margin:auto;padding:34px 20px}header{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:26px}.brand{font-size:26px;font-weight:800}.brand i{font-style:normal;color:var(--pink)}.tag{color:var(--green);font-size:13px;font-weight:700;background:#0d342b;padding:7px 10px;border-radius:99px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.stat,.match{border:1px solid var(--line);background:rgba(16,33,58,.88);border-radius:16px;padding:18px}.label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.value{font-size:27px;font-weight:750;margin-top:6px}.matches{margin-top:22px;display:grid;gap:12px}.match h2{font-size:18px;margin:0 0 5px}.league,.meta{color:var(--muted)}.facts{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.fact{border:1px solid #315276;border-radius:8px;padding:7px 9px;font-size:13px}.empty{text-align:center;padding:36px;color:var(--muted);border:1px dashed var(--line);border-radius:16px}.warn{margin-top:14px;color:#ffd26f;font-size:13px}@media(max-width:650px){.wrap{padding:22px 14px}.grid{grid-template-columns:1fr}.brand{font-size:22px}}</style></head><body><main class="wrap"><header><div><div class="brand">Bot<i>Bet</i></div><div class="meta">Filtro por forma no mando de campo e diferença de tabela</div></div><span class="tag">● Coletor soccerdata</span></header><section class="grid"><div class="stat"><div class="label">Última execução</div><div class="value" id="run">Carregando…</div></div><div class="stat"><div class="label">Jogos analisados</div><div class="value" id="checked">—</div></div><div class="stat"><div class="label">Jogos aprovados</div><div class="value" id="approved">—</div></div></section><section class="matches" id="matches"></section></main><script>const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));async function load(){const r=await fetch('/status');const x=await r.json();document.querySelector('#run').textContent=x.runAt?new Date(x.runAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Aguardando primeira coleta';document.querySelector('#checked').textContent=x.checked??0;document.querySelector('#approved').textContent=x.approved??0;const root=document.querySelector('#matches');if(!x.matches?.length){root.innerHTML='<div class="empty">Nenhum jogo passou em todos os critérios na última coleta. O painel será atualizado pelo coletor agendado.</div>'+(x.failureReasons?.length?'<div class="warn">Fonte: '+esc(x.failureReasons.join(' · '))+'</div>':'');return}root.innerHTML=x.matches.map(m=>'<article class="match"><h2>'+esc(m.home)+' × '+esc(m.away)+'</h2><div class="league">'+esc(m.league)+' · '+esc(m.time)+'</div><div class="facts"><span class="fact">Favorito pela tabela: <b>'+esc(m.favorite)+'</b> ('+esc(m.side)+')</span><span class="fact">Odd: <b>validar manualmente</b></span><span class="fact">Tabela: '+esc(m.table)+'</span><span class="fact">Forma: '+esc(m.favoriteForm)+' × '+esc(m.underdogForm)+'</span></div></article>').join('')}load();setInterval(load,60000)</script></body></html>`, { headers: { 'content-type': 'text/html;charset=UTF-8', 'cache-control': 'no-store' } });
}

async function telegram(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Telegram ${response.status}`);
  return response.json();
}

async function captureChatId(env) {
  if (!env.TELEGRAM_BOT_TOKEN || await env.STATE.get('chat_id')) return;
  const updates = await telegram(env, 'getUpdates', { timeout: 0, allowed_updates: ['message'] });
  const update = updates?.result?.find(item => item.message?.chat?.type === 'private');
  if (!update) return;
  const chatId = String(update.message.chat.id);
  await env.STATE.put('chat_id', chatId);
  await telegram(env, 'sendMessage', { chat_id: chatId, text: '✅ Alertas BotBet ativados. Vou avisar somente jogos que passarem em todos os filtros.' });
}

function alertText(match) {
  return [
    '✅ <b>CANDIDATO ESTATÍSTICO — BOTBET</b>',
    `<b>${match.home} x ${match.away}</b> — ${match.time}`,
    match.league,
    '',
    `Favorito pela tabela: <b>${match.favorite}</b> (${match.side})`,
    'Odd: <b>validar manualmente (&lt; 1,80)</b>',
    `Tabela: ${match.table}`,
    `Forma favorito (${match.side}): ${match.favoriteForm}`,
    `Forma não favorito: ${match.underdogForm}`,
    '',
    'Critérios estatísticos aprovados. Não é recomendação de aposta.'
  ].join('\n');
}

async function ingest(request, env) {
  if (!env.INGEST_SECRET || request.headers.get('x-ingest-secret') !== env.INGEST_SECRET) return json({ error: 'unauthorized' }, 401);
  let result;
  try { result = await request.json(); }
  catch { return json({ error: 'invalid_json' }, 400); }
  if (!Array.isArray(result.matches) || !Number.isFinite(result.checked) || !Number.isFinite(result.approved)) return json({ error: 'invalid_payload' }, 400);
  await captureChatId(env);
  const chatId = await env.STATE.get('chat_id');
  let sent = 0;
  const failures = [];
  for (const match of result.matches) {
    if (!match?.id || !chatId || await env.STATE.get(`sent:${match.id}`)) continue;
    try {
      await telegram(env, 'sendMessage', { chat_id: chatId, text: alertText(match), parse_mode: 'HTML', disable_web_page_preview: true });
      await env.STATE.put(`sent:${match.id}`, new Date().toISOString(), { expirationTtl: 172800 });
      sent += 1;
    } catch (error) { failures.push(error instanceof Error ? error.message : 'telegram_failed'); }
  }
  const stored = { ...result, runAt: result.runAt || new Date().toISOString(), sent, failures: (result.failures || 0) + failures.length, failureReasons: [...new Set([...(result.failureReasons || []), ...failures])].slice(0, 5) };
  await env.STATE.put('latest_run', JSON.stringify(stored));
  return json({ ok: true, sent, approved: stored.approved });
}

function environment() {
  return {
    STATE,
    TELEGRAM_BOT_TOKEN: typeof TELEGRAM_BOT_TOKEN === 'undefined' ? undefined : TELEGRAM_BOT_TOKEN,
    RUN_SECRET: typeof RUN_SECRET === 'undefined' ? undefined : RUN_SECRET,
    INGEST_SECRET: typeof INGEST_SECRET === 'undefined' ? undefined : INGEST_SECRET
  };
}

async function handleFetch(request) {
  const env = environment();
  const url = new URL(request.url);
  if (url.pathname === '/') return dashboard();
  if (url.pathname === '/health') return json({ ok: true, monitor: 'botbet', source: 'soccerdata' });
  if (url.pathname === '/status') return json(JSON.parse((await env.STATE.get('latest_run')) || '{}'));
  if (url.pathname === '/ingest' && request.method === 'POST') return ingest(request, env);
  if (url.pathname === '/capture-telegram' && request.headers.get('authorization') === `Bearer ${env.RUN_SECRET}`) {
    try { await captureChatId(env); return json({ ok: true, connected: Boolean(await env.STATE.get('chat_id')) }); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'telegram_capture_failed' }, 500); }
  }
  return new Response('Not found', { status: 404 });
}

addEventListener('fetch', event => event.respondWith(handleFetch(event.request)));
addEventListener('scheduled', event => event.waitUntil(captureChatId(environment())));
