const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json;charset=UTF-8', 'cache-control': 'no-store' }
});

const CATALOG_PREFIX = 'catalog:';
const CATALOG_RESULTS = new Set(['pendente', 'valida', 'invalida']);

async function listCatalogEntries(env) {
  const listed = await env.STATE.list({ prefix: CATALOG_PREFIX });
  const entries = {};
  for (const key of listed.keys) {
    const raw = await env.STATE.get(key.name);
    if (!raw) continue;
    entries[key.name.slice(CATALOG_PREFIX.length)] = JSON.parse(raw);
  }
  return entries;
}

function parseCatalogBody(body) {
  if (!body || typeof body.matchId !== 'string' || !body.matchId.trim()) return { error: 'invalid_match_id' };
  const result = String(body.result ?? 'pendente').toLowerCase();
  if (!CATALOG_RESULTS.has(result)) return { error: 'invalid_result' };
  const stake = body.stake === '' || body.stake == null ? null : Number(body.stake);
  const odd = body.odd === '' || body.odd == null ? null : Number(body.odd);
  if (stake != null && (!Number.isFinite(stake) || stake < 0)) return { error: 'invalid_stake' };
  if (odd != null && (!Number.isFinite(odd) || odd < 1)) return { error: 'invalid_odd' };
  return {
    entry: {
      result,
      stake,
      odd,
      updatedAt: new Date().toISOString()
    }
  };
}

function catalogSecretOk(request, env) {
  return Boolean(env.RUN_SECRET) && request.headers.get('x-catalog-secret') === env.RUN_SECRET;
}

async function catalogGet(env) {
  return json({ entries: await listCatalogEntries(env) });
}

async function catalogPost(request, env) {
  if (!catalogSecretOk(request, env)) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'invalid_json' }, 400); }
  const parsed = parseCatalogBody(body);
  if (parsed.error) return json({ error: parsed.error }, 400);
  const matchId = body.matchId.trim();
  await env.STATE.put(`${CATALOG_PREFIX}${matchId}`, JSON.stringify(parsed.entry), { expirationTtl: 15552000 });
  return json({ ok: true, matchId, entry: parsed.entry });
}

function dashboard() {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BotBet — Monitor</title><style>
  :root{color-scheme:dark;--bg:#07111f;--panel:#10213a;--line:#203857;--pink:#ff276f;--text:#edf4ff;--muted:#9fb1c9;--green:#29d693;--yellow:#ffd26f}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top right,#17386a 0,#07111f 45%);color:var(--text);font:15px Inter,system-ui,sans-serif}.wrap{max-width:1040px;margin:auto;padding:34px 20px}header{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:26px}.brand{font-size:26px;font-weight:800}.brand i{font-style:normal;color:var(--pink)}.tag{color:var(--green);font-size:13px;font-weight:700;background:#0d342b;padding:7px 10px;border-radius:99px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.stat,.match{border:1px solid var(--line);background:rgba(16,33,58,.88);border-radius:16px;padding:18px}.label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.value{font-size:27px;font-weight:750;margin-top:6px}.coverage{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.coverage-item{border:1px solid #315276;border-radius:9px;padding:8px 10px;font-size:13px}.section-title{font-size:17px;margin:30px 0 10px}.matches{display:grid;gap:12px}.match h2{font-size:18px;margin:0 0 5px}.league,.meta{color:var(--muted)}.facts{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.fact{border:1px solid #315276;border-radius:8px;padding:7px 9px;font-size:13px}.rejected{border-color:#77532a}.reason{margin:14px 0 0;color:var(--yellow);line-height:1.4}.empty{text-align:center;padding:28px;color:var(--muted);border:1px dashed var(--line);border-radius:16px}.warn{margin-top:14px;color:var(--yellow);font-size:13px}.settings{margin-top:20px;border:1px solid var(--line);border-radius:14px;padding:14px 16px;background:rgba(16,33,58,.6)}.settings summary{cursor:pointer;font-weight:650;color:var(--muted)}.settings-row{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;align-items:flex-end}.settings-row label{font-size:12px;color:var(--muted);display:flex;flex-direction:column;gap:6px;flex:1;min-width:200px}.settings-row input{padding:9px 11px;border-radius:8px;border:1px solid #315276;background:#0a1628;color:var(--text)}.settings-row button{padding:9px 14px;border-radius:8px;border:0;background:var(--pink);color:#fff;font-weight:700;cursor:pointer}.catalog{margin-top:16px;padding-top:14px;border-top:1px dashed #315276}.catalog-title{font-size:13px;font-weight:700;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.06em}.catalog-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.catalog-grid label{font-size:11px;color:var(--muted);display:flex;flex-direction:column;gap:5px}.catalog-grid select,.catalog-grid input{padding:8px 9px;border-radius:8px;border:1px solid #315276;background:#0a1628;color:var(--text);font-size:14px}.catalog-actions{margin-top:10px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}.catalog-actions button{padding:8px 12px;border-radius:8px;border:1px solid #315276;background:#173458;color:var(--text);cursor:pointer;font-weight:650}.catalog-actions button.primary{background:var(--green);border-color:#1d7a57;color:#042016}.catalog-msg{font-size:12px;color:var(--muted)}.catalog-msg.err{color:#ff8fa8}.badge-valida{color:var(--green);font-weight:700}.badge-invalida{color:#ff8fa8;font-weight:700}.badge-pendente{color:var(--yellow);font-weight:700}@media(max-width:760px){.wrap{padding:22px 14px}.grid{grid-template-columns:repeat(2,1fr)}.brand{font-size:22px}.catalog-grid{grid-template-columns:1fr}}@media(max-width:410px){.grid{grid-template-columns:1fr}}</style></head><body><main class="wrap"><header><div><div class="brand">Bot<i>Bet</i></div><div class="meta">Filtro por forma no mando de campo e diferença de tabela</div></div><span class="tag">● Football-Data</span></header><section class="grid"><div class="stat"><div class="label">Última execução</div><div class="value" id="run">Carregando…</div></div><div class="stat"><div class="label">Jogos analisados</div><div class="value" id="checked">—</div></div><div class="stat"><div class="label">Aprovados</div><div class="value" id="approved">—</div></div><div class="stat"><div class="label">Reprovados</div><div class="value" id="rejected">—</div></div></section><h2 class="section-title">Catalogação do método</h2><section class="grid"><div class="stat"><div class="label">Entradas registradas</div><div class="value" id="cat-total">—</div></div><div class="stat"><div class="label">Válidas</div><div class="value" id="cat-valida">—</div></div><div class="stat"><div class="label">Inválidas</div><div class="value" id="cat-invalida">—</div></div><div class="stat"><div class="label">ROI (stake)</div><div class="value" id="cat-roi">—</div></div></section><details class="settings"><summary>Configuração para salvar catalogação</summary><p class="meta" style="margin:10px 0 0">Use o mesmo <code>RUN_SECRET</code> do Worker. O valor fica só neste navegador (sessionStorage).</p><div class="settings-row"><label>Segredo de catalogação<input type="password" id="catalog-secret" placeholder="RUN_SECRET" autocomplete="off"></label><button type="button" id="save-secret">Guardar na sessão</button></div></details><section class="coverage" id="coverage"></section><h2 class="section-title">Jogos aprovados</h2><section class="matches" id="approved-list"></section><h2 class="section-title">Jogos reprovados</h2><section class="matches" id="rejected-list"></section><section id="warnings"></section></main><script>
const esc=s=>String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));
const SECRET_KEY='botbet_catalog_secret';
let catalogEntries={};
function getSecret(){return sessionStorage.getItem(SECRET_KEY)||'';}
function resultLabel(r){return r==='valida'?'Válida':r==='invalida'?'Inválida':'Pendente';}
function resultBadge(r){const c=r==='valida'?'badge-valida':r==='invalida'?'badge-invalida':'badge-pendente';return '<span class="'+c+'">'+resultLabel(r)+'</span>';}
function catalogBlock(m){const id=esc(m.id);const c=catalogEntries[m.id]||{result:'pendente',stake:null,odd:null};const stake=c.stake!=null?c.stake:'';const odd=c.odd!=null?c.odd:'';return '<div class="catalog" data-match-id="'+id+'"><div class="catalog-title">Catalogação · ID '+id+' · '+resultBadge(c.result||'pendente')+'</div><div class="catalog-grid"><label>Resultado<select class="cat-result"><option value="pendente"'+(c.result==='pendente'?' selected':'')+'>Pendente</option><option value="valida"'+(c.result==='valida'?' selected':'')+'>Válida</option><option value="invalida"'+(c.result==='invalida'?' selected':'')+'>Inválida</option></select></label><label>Stake (unidades)<input class="cat-stake" type="number" min="0" step="0.01" placeholder="ex: 10" value="'+esc(stake)+'"></label><label>Odd no momento<input class="cat-odd" type="number" min="1" step="0.01" placeholder="ex: 1.75" value="'+esc(odd)+'"></label></div><div class="catalog-actions"><button type="button" class="primary cat-save">Salvar catalogação</button><span class="catalog-msg cat-msg"></span></div></div>';}
function card(m,isRejected){let facts='';if(m.favorite)facts+='<span class="fact">Favorito: <b>'+esc(m.favorite)+'</b> ('+esc(m.side)+')</span>';if(m.table)facts+='<span class="fact">Tabela: '+esc(m.table)+'</span>';if(m.favoriteForm||m.underdogForm)facts+='<span class="fact">Forma: '+esc(m.favoriteForm||'—')+' × '+esc(m.underdogForm||'—')+'</span>';if(!isRejected)facts+='<span class="fact">Regra odd: &lt; 1,80 (conferir na casa)</span>';const cat=!isRejected&&m.id?catalogBlock(m):'';return '<article class="match'+(isRejected?' rejected':'')+'" data-id="'+esc(m.id||'')+'"><h2>'+esc(m.home)+' × '+esc(m.away)+'</h2><div class="league">'+esc(m.league)+' · '+esc(m.time)+'</div>'+(facts?'<div class="facts">'+facts+'</div>':'')+(isRejected?'<p class="reason"><b>Motivo:</b> '+esc(m.reason)+'</p>':'')+cat+'</article>';}
function catalogStats(entries){const vals=Object.values(entries||{});const tracked=vals.filter(e=>e&&(e.result!=='pendente'||e.stake!=null||e.odd!=null));const valida=vals.filter(e=>e&&e.result==='valida').length;const invalida=vals.filter(e=>e&&e.result==='invalida').length;let profit=0,staked=0;for(const e of vals){if(!e||e.result==='pendente'||e.stake==null||!Number.isFinite(e.stake))continue;staked+=e.stake;if(e.result==='invalida')profit-=e.stake;else if(e.result==='valida'&&e.odd!=null&&Number.isFinite(e.odd))profit+=e.stake*(e.odd-1);}const roi=staked>0?((profit/staked)*100).toFixed(1)+'%':'—';return{total:tracked.length,valida,invalida,roi};}
function renderCatalogStats(){const s=catalogStats(catalogEntries);document.querySelector('#cat-total').textContent=s.total;document.querySelector('#cat-valida').textContent=s.valida;document.querySelector('#cat-invalida').textContent=s.invalida;document.querySelector('#cat-roi').textContent=s.roi;}
async function saveCatalog(matchId,root){const secret=getSecret();const msg=root.querySelector('.cat-msg');msg.textContent='';msg.classList.remove('err');if(!secret){msg.textContent='Configure o RUN_SECRET nas configurações acima.';msg.classList.add('err');return;}const payload={matchId,result:root.querySelector('.cat-result').value,stake:root.querySelector('.cat-stake').value,odd:root.querySelector('.cat-odd').value};try{const r=await fetch('/api/catalog',{method:'POST',headers:{'content-type':'application/json','x-catalog-secret':secret},body:JSON.stringify(payload)});const data=await r.json();if(!r.ok){msg.textContent=data.error||'Falha ao salvar';msg.classList.add('err');return;}catalogEntries[matchId]=data.entry;msg.textContent='Salvo às '+new Date(data.entry.updatedAt).toLocaleTimeString('pt-BR');renderCatalogStats();const title=root.querySelector('.catalog-title');if(title)title.innerHTML='Catalogação · ID '+esc(matchId)+' · '+resultBadge(data.entry.result);}catch(e){msg.textContent='Erro de rede';msg.classList.add('err');}}
function bindCatalogButtons(){document.querySelectorAll('.cat-save').forEach(btn=>{btn.onclick=()=>{const root=btn.closest('.catalog');const id=root?.dataset?.matchId;if(id)saveCatalog(id,root);};});}
async function load(){const [statusRes,catalogRes]=await Promise.all([fetch('/status'),fetch('/api/catalog')]);const x=await statusRes.json();const cat=await catalogRes.json();catalogEntries=cat.entries||{};document.querySelector('#run').textContent=x.runAt?new Date(x.runAt).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'Aguardando primeira coleta';document.querySelector('#checked').textContent=x.checked??0;document.querySelector('#approved').textContent=x.approved??0;document.querySelector('#rejected').textContent=x.rejected??0;renderCatalogStats();const coverage=document.querySelector('#coverage');coverage.innerHTML=(x.leagueSummary||[]).map(l=>'<div class="coverage-item"><b>'+esc(l.league)+'</b> · '+(l.error?'erro: '+esc(l.error):esc(l.fixtures)+' jogos · '+esc(l.approved)+' aprovados · '+esc(l.rejected)+' reprovados')+'</div>').join('')||'<div class="coverage-item">A cobertura por liga aparecerá após a próxima coleta.</div>';const approved=x.matches||[];const rejected=x.rejectedMatches||[];document.querySelector('#approved-list').innerHTML=approved.length?approved.map(m=>card(m,false)).join(''):'<div class="empty">Nenhum jogo passou em todos os critérios nesta coleta.</div>';document.querySelector('#rejected-list').innerHTML=rejected.length?rejected.map(m=>card(m,true)).join(''):'<div class="empty">Os jogos reprovados aparecerão após a próxima coleta.</div>';document.querySelector('#warnings').innerHTML=x.failureReasons?.length?'<div class="warn">Fonte: '+esc(x.failureReasons.join(' · '))+'</div>':'';bindCatalogButtons();}
document.querySelector('#save-secret').onclick=()=>{const v=document.querySelector('#catalog-secret').value.trim();if(v)sessionStorage.setItem(SECRET_KEY,v);};
document.querySelector('#catalog-secret').value=getSecret();
load();setInterval(load,60000);
</script></body></html>`, { headers: { 'content-type': 'text/html;charset=UTF-8', 'cache-control': 'no-store' } });
}

async function telegram(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Telegram ${response.status}`);
  return response.json();
}

const html = value => String(value ?? '').replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));

function saoPauloDate(offset = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = type => parts.find(part => part.type === type)?.value;
  const date = new Date(`${value('year')}-${value('month')}-${value('day')}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function commandOf(text) {
  return String(text || '').trim().toLowerCase().split(/\s+/)[0].replace(/@[^\s]+$/, '');
}

function commandsText() {
  return [
    '🤖 <b>BotBet</b>',
    'Use os comandos abaixo para consultar a última coleta disponível.',
    '',
    '/hoje — resumo e candidatos de hoje',
    '/amanha — resumo e candidatos de amanhã',
    '/aprovados — somente candidatos aprovados',
    '/reprovados — jogos eliminados e motivos',
    '/ligas — cobertura por competição',
    '/status — situação da coleta',
    '/painel — abrir a interface web',
    '',
    'A odd continua para validação manual.'
  ].join('\n');
}

async function resultForDate(env, date) {
  const raw = await env.STATE.get(`run:${date}`);
  return raw ? JSON.parse(raw) : null;
}

function resultHeader(result) {
  return `📅 <b>${result.date.split('-').reverse().join('/')}</b>\nJogos analisados: <b>${result.checked || 0}</b> · Aprovados: <b>${result.approved || 0}</b> · Reprovados: <b>${result.rejected || 0}</b>`;
}

function compactMatch(match, rejected = false) {
  const title = `<b>${html(match.home)} × ${html(match.away)}</b> — ${html(match.time)}`;
  if (rejected) return `${title}\n❌ ${html(match.reason || 'Critério não informado')}`;
  return `${title}\n✅ Favorito: ${html(match.favorite)} (${html(match.side)}) · ${html(match.table)}`;
}

function matchesText(result, type) {
  const rejected = type === 'rejected';
  const items = rejected ? (result.rejectedMatches || []) : (result.matches || []);
  const label = rejected ? 'reprovado' : 'aprovado';
  if (!items.length) return `${resultHeader(result)}\n\nNenhum jogo ${label} nesta coleta.`;
  const shown = items.slice(0, 8);
  const remaining = items.length - shown.length;
  return [resultHeader(result), '', ...shown.map(item => compactMatch(item, rejected)), remaining > 0 ? `\n… e mais ${remaining} jogo(s) no painel.` : ''].filter(Boolean).join('\n\n');
}

function leaguesText(result) {
  const lines = (result.leagueSummary || []).map(league => league.error
    ? `• <b>${html(league.league)}</b>: erro na fonte`
    : `• <b>${html(league.league)}</b>: ${league.fixtures || 0} jogos · ${league.approved || 0} aprovados · ${league.rejected || 0} reprovados`);
  return [resultHeader(result), '', '<b>Cobertura por liga</b>', ...lines].join('\n');
}

async function ensureBotCommands(env) {
  if (await env.STATE.get('telegram_commands_ready')) return;
  await telegram(env, 'setMyCommands', {
    commands: [
      { command: 'hoje', description: 'Consultar jogos de hoje' },
      { command: 'amanha', description: 'Consultar jogos de amanhã' },
      { command: 'aprovados', description: 'Ver jogos aprovados' },
      { command: 'reprovados', description: 'Ver jogos reprovados' },
      { command: 'ligas', description: 'Ver cobertura por liga' },
      { command: 'status', description: 'Ver última coleta' },
      { command: 'painel', description: 'Abrir o painel web' }
    ]
  });
  await env.STATE.put('telegram_commands_ready', '1');
}

const DEFAULT_PANEL_ORIGIN = 'https://botbet-monitor.botbetwill.workers.dev';

function panelOriginFrom(requestUrl) {
  if (!requestUrl) return DEFAULT_PANEL_ORIGIN;
  try { return new URL(requestUrl).origin; }
  catch { return DEFAULT_PANEL_ORIGIN; }
}

async function replyToCommand(env, message, { captureChat = false, panelOrigin = DEFAULT_PANEL_ORIGIN } = {}) {
  if (message?.chat?.type !== 'private' || !message?.chat?.id) return;
  const chatId = String(message.chat.id);
  const owner = await env.STATE.get('chat_id');
  if (owner && owner !== chatId) return;
  if (!owner) {
    if (captureChat) await env.STATE.put('chat_id', chatId);
    else {
      await telegram(env, 'sendMessage', {
        chat_id: chatId,
        text: [
          '⚙️ O BotBet ainda não está vinculado a este chat.',
          '',
          'Envie /start aqui e peça ao administrador para executar a captura autenticada (endpoint /capture-telegram com RUN_SECRET), conforme o README.',
          'Até então, comandos e alertas não serão entregues neste chat.'
        ].join('\n'),
        disable_web_page_preview: true
      });
      return;
    }
  }
  const command = commandOf(message.text);
  const today = saoPauloDate();
  const tomorrow = saoPauloDate(1);
  const date = command === '/amanha' ? tomorrow : today;
  const result = await resultForDate(env, date);
  let text;
  if (command === '/start' || command === '/ajuda' || !command) text = commandsText();
  else if (command === '/painel') text = `📊 Painel BotBet:\n${panelOrigin}/`;
  else if (command === '/status') {
    const latest = JSON.parse((await env.STATE.get('latest_run')) || 'null');
    text = latest ? `${resultHeader(latest)}\n\nFonte: ${html(latest.source || '—')}\nAtualizado: ${html(new Date(latest.runAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}` : 'Ainda não há coleta disponível.';
  } else if (!result) {
    text = `Ainda não há uma coleta para ${date.split('-').reverse().join('/')}. O bot será atualizado pela próxima rotina agendada.`;
  } else if (command === '/ligas') text = leaguesText(result);
  else if (command === '/reprovados') text = matchesText(result, 'rejected');
  else if (command === '/aprovados') text = matchesText(result, 'approved');
  else if (command === '/hoje' || command === '/amanha') text = matchesText(result, 'approved');
  else text = commandsText();
  await telegram(env, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
}

async function processTelegramUpdates(env, { captureChat = false, panelOrigin = DEFAULT_PANEL_ORIGIN } = {}) {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  const offset = Number(await env.STATE.get('telegram_offset') || '0');
  const updates = await telegram(env, 'getUpdates', { offset, timeout: 0, allowed_updates: ['message'] });
  let nextOffset = offset;
  for (const update of updates?.result || []) {
    nextOffset = Math.max(nextOffset, Number(update.update_id) + 1);
    try { await replyToCommand(env, update.message, { captureChat, panelOrigin }); }
    catch (error) { console.log('telegram_command_failed', error instanceof Error ? error.message : 'unknown'); }
  }
  if (nextOffset > offset) await env.STATE.put('telegram_offset', String(nextOffset));
  try { await ensureBotCommands(env); }
  catch (error) { console.log('telegram_commands_failed', error instanceof Error ? error.message : 'unknown'); }
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
  await processTelegramUpdates(env, { panelOrigin: panelOriginFrom(request.url) });
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
  await env.STATE.put(`run:${stored.date}`, JSON.stringify(stored), { expirationTtl: 604800 });
  if (stored.date === saoPauloDate()) await env.STATE.put('latest_run', JSON.stringify(stored));
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
  if (url.pathname === '/health') return json({ ok: true, monitor: 'botbet', source: 'football-data.org' });
  if (url.pathname === '/status') {
    const date = url.searchParams.get('date');
    return json(JSON.parse((date ? await env.STATE.get(`run:${date}`) : await env.STATE.get('latest_run')) || '{}'));
  }
  if (url.pathname === '/api/catalog') {
    if (request.method === 'GET') return catalogGet(env);
    if (request.method === 'POST') return catalogPost(request, env);
    return json({ error: 'method_not_allowed' }, 405);
  }
  if (url.pathname === '/ingest' && request.method === 'POST') return ingest(request, env);
  if (url.pathname === '/capture-telegram' && request.headers.get('authorization') === `Bearer ${env.RUN_SECRET}`) {
    try {
      await processTelegramUpdates(env, { captureChat: true, panelOrigin: panelOriginFrom(request.url) });
      return json({ ok: true, connected: Boolean(await env.STATE.get('chat_id')) });
    }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'telegram_capture_failed' }, 500); }
  }
  return new Response('Not found', { status: 404 });
}

addEventListener('fetch', event => event.respondWith(handleFetch(event.request)));
addEventListener('scheduled', event => event.waitUntil(processTelegramUpdates(environment())));
