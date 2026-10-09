const $ = (s) => document.querySelector(s);
let cfg = null;
let pollTimer = null;
let tickTimer = null;
let renderedCount = 0;

const SEAT_CHIP = ['主席开场', '开篇立论', '盘问', '驳立论', '自由辩论', '结辩', '裁判点评', '主席宣布'];
const SIDE_NAME = { pro: '正方', con: '反方' };

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const br = (s) => esc(s).replace(/\n/g, '<br>');
const modelInfo = (id) => (cfg?.models || []).find((m) => m.id === id) || { alias: '无名', style: '' };
const seatInfo = (key) => (cfg?.seats || []).find((s) => s.key === key);

function chipOf(stage) {
  if (!stage) return null;
  if (stage.includes('盘问')) return '盘问';
  if (stage === '主席开场') return '主席开场';
  for (const c of SEAT_CHIP) if (stage.includes(c) && c !== '盘问') return c;
  return null;
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/* ── 路由 ─────────────────────────────── */
function route() {
  const m = location.hash.match(/^#\/r\/([\w-]+)$/);
  stopTimers();
  if (m) {
    $('#view-setup').hidden = true;
    $('#view-arena').hidden = false;
    renderArena(m[1]);
    pollTimer = setInterval(() => renderArena(m[1], true), 1500);
  } else {
    $('#view-setup').hidden = false;
    $('#view-arena').hidden = true;
    renderArchive();
  }
}
function stopTimers() {
  clearInterval(pollTimer); pollTimer = null;
  clearInterval(tickTimer); tickTimer = null;
}
addEventListener('hashchange', route);

/* ── 历史对局 ─────────────────────────── */
async function renderArchive() {
  const box = $('#archive-list');
  try {
    const runs = await api('/api/runs');
    if (!runs.length) {
      box.innerHTML = '<p class="archive-empty">还没有对局。上面出一道辩题，开赛。</p>';
      return;
    }
    box.innerHTML = runs.map((r) => {
      const s = r.scores;
      const score = s ? `${s.pro_total} : ${s.con_total}` : '';
      const badge = r.status === 'running' ? '<span class="arc-badge live">进行中</span>' : r.status === 'error' ? '<span class="arc-badge">中断</span>' : '<span class="arc-badge">已完赛</span>';
      const d = r.id.slice(0, 10).replace(/-/g, '.');
      const t = r.id.slice(11, 19).replace(/-/g, ':');
      return `<a class="arc-item" href="#/r/${r.id}">
        <span class="arc-date">${d} ${t}</span>
        <span class="arc-topic">${esc(r.topic)}</span>
        <span class="arc-score">${score}</span>${badge}</a>`;
    }).join('');
  } catch (e) {
    box.innerHTML = `<p class="archive-empty">${esc(e.message)}</p>`;
  }
}

/* ── 开赛 ─────────────────────────────── */
$('#btn-start').addEventListener('click', async () => {
  const btn = $('#btn-start'), err = $('#setup-error');
  const topic = $('#f-topic').value.trim();
  if (!topic) { err.hidden = false; err.textContent = '先写辩题。'; return; }
  err.hidden = true; btn.disabled = true; btn.textContent = '排席中…';
  try {
    const { id } = await api('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        topic,
        pro: $('#f-pro').value.trim(),
        con: $('#f-con').value.trim(),
        rounds: Number($('#f-rounds').value),
        qa: Number($('#f-qa').value),
        shuffle: $('#f-assign').value === 'shuffle',
      }),
    });
    location.hash = `#/r/${id}`;
  } catch (e) {
    err.hidden = false; err.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = '开 赛';
  }
});
$('#f-topic').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-start').click(); });

/* ── 赛场渲染 ─────────────────────────── */
let lastStateKey = '';

async function renderArena(id, isPoll = false) {
  let st;
  try { st = await api(`/api/runs/${id}`); }
  catch (e) { if (!isPoll) $('#feed').innerHTML = `<div class="run-error">${esc(e.message)}</div>`; return; }

  const { meta } = st;
  $('#a-topic').textContent = `「${meta.topic}」`;
  $('#a-stances').innerHTML = `<b>正方</b> ${esc(meta.proStance)}<span class="sp">◆</span><b>反方</b> ${esc(meta.conStance)}`;

  const total = st.transcript.length;
  if (st.status === 'running') {
    $('#a-progress').textContent = `进行中 ｜ 已发言 ${total} ｜ 第 ${st.pending?.idx ?? '?'}/${st.progress?.total ?? '?'} 手`;
  } else if (st.status === 'done') {
    const mins = st.totalElapsedMs ? (st.totalElapsedMs / 60000).toFixed(1) : '?';
    $('#a-progress').textContent = `已完赛 ｜ ${total} 次发言 ｜ 全程约 ${mins} 分钟`;
  } else if (st.status === 'error') {
    $('#a-progress').textContent = `比赛第 ${total + 1} 手中断`;
  }

  renderSeats(st);
  renderChips(st);
  renderFeed(st);
  renderVerdict(st);

  if (st.status !== 'running') stopTimers();
}

function renderSeats(st) {
  const box = $('#seat-cards');
  box.innerHTML = (cfg?.seats || []).map((s) => {
    const m = modelInfo(st.meta.assign[s.key]);
    const cls = s.side ? s.side : 'neutral';
    const speaking = st.pending && st.pending.seat === s.key ? ' speaking' : '';
    return `<div class="seat ${cls}${speaking}">
      <div class="s-label">${s.label}</div>
      <div class="s-alias">${m.alias}</div>
      <div class="s-model">${m.id}</div>
    </div>`;
  }).join('');
}

function renderChips(st) {
  const curStage = st.pending?.stage || st.transcript[st.transcript.length - 1]?.stage;
  const cur = chipOf(curStage);
  const curIdx = cur ? SEAT_CHIP.indexOf(cur) : -1;
  $('#a-chips').innerHTML = SEAT_CHIP.map((c, i) => {
    const cls = i === curIdx ? 'on' : i < curIdx ? 'past' : '';
    return `<span class="chip ${cls}">${c}</span>`;
  }).join('');
}

function renderFeed(st) {
  const feed = $('#feed');
  const key = `${st.id}:${st.transcript.length}:${st.pending ? st.pending.idx : 'x'}`;
  if (key === lastStateKey) { tickPending(st); return; }
  lastStateKey = key;

  const nearBottom = window.innerHeight + window.scrollY > document.body.offsetHeight - 400;
  const start = Math.min(renderedCount, st.transcript.length);
  if (st.transcript.length < renderedCount) { feed.innerHTML = ''; renderedCount = 0; }

  let blocks = [];
  for (const e of st.transcript) {
    let b = blocks[blocks.length - 1];
    if (!b || b.stage !== e.stage) { b = { stage: e.stage, items: [] }; blocks.push(b); }
    b.items.push(e);
  }

  const rebuild = start === 0;
  if (rebuild) feed.innerHTML = '';
  blocks.forEach((b, bi) => {
    let blk = feed.querySelector(`[data-blk="${CSS.escape(b.stage)}"]`);
    if (!blk) {
      blk = document.createElement('div');
      blk.className = 'stage-block';
      blk.dataset.blk = b.stage;
      blk.innerHTML = `<div class="stage-name">${esc(b.stage)}</div>`;
      feed.appendChild(blk);
    }
    for (const e of b.items) {
      if (blk.querySelector(`[data-seq="${st.transcript.indexOf(e)}"]`)) continue;
      const card = document.createElement('article');
      const side = e.side || 'neutral';
      card.className = `speech ${side}`;
      card.dataset.seq = st.transcript.indexOf(e);
      const metaBits = [`${(e.elapsedMs / 1000).toFixed(1)}s`, e.usage?.completion_tokens != null ? `${e.usage.completion_tokens} tok` : '', e.truncated ? '被截断' : ''].filter(Boolean).join(' ｜ ');
      card.innerHTML = `<div class="sp-head">
          <span class="sp-seat">${esc(e.label)}</span>
          <span class="sp-alias">${esc(e.alias)}</span>
          <span class="sp-model">${esc(e.model)}</span>
        </div>
        <div class="sp-body">${br(e.text)}</div>
        <div class="sp-meta">${metaBits}</div>`;
      blk.appendChild(card);
    }
  });

  // 正在思考的提示卡（始终钉在流末尾）
  let pd = feed.querySelector('.pending');
  if (st.pending) {
    if (!pd) {
      pd = document.createElement('div');
      pd.className = 'pending';
    }
    pd.innerHTML = `<span class="dot"></span>${esc(st.pending.alias)} · ${esc(st.pending.label)} 正在「${esc(st.pending.stage)}」… <span class="wait-s"></span>`;
    feed.appendChild(pd);
    tickPending(st);
  } else if (pd) pd.remove();

  if (st.status === 'error') {
    let er = feed.querySelector('.run-error');
    if (!er) { er = document.createElement('div'); er.className = 'run-error'; feed.appendChild(er); }
    er.textContent = `比赛中断：${st.error}`;
  }
  if (st.status === 'done') {
    let df = feed.querySelector('.done-flag');
    if (!df) { df = document.createElement('div'); df.className = 'done-flag'; df.textContent = '—— 本 场 终 ——'; feed.appendChild(df); }
    if (pd) pd.remove();
  }
  renderedCount = st.transcript.length;
  if (nearBottom) window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function tickPending(st) {
  if (!st?.pending?.startedAt) return;
  const el = document.querySelector('.pending .wait-s');
  if (!el) return;
  const upd = () => { el.textContent = `已等 ${Math.floor((Date.now() - st.pending.startedAt) / 1000)} 秒`; };
  upd();
  if (!tickTimer) tickTimer = setInterval(() => { if (pollTimer) upd(); }, 1000);
}

function renderVerdict(st) {
  const box = $('#verdict');
  if (!st.scores) { box.hidden = true; return; }
  box.hidden = false;
  const s = st.scores;
  const bd = s.score_breakdown || {};
  const bestKey = s.best_debater_seat;
  const best = seatInfo(bestKey);
  const bestM = best ? modelInfo(st.meta.assign[bestKey]) : null;
  const pendingAnnounce = st.status === 'running';
  box.innerHTML = `<h3>裁判评分卡</h3>
    <div class="win-line">
      ${st.winnerLabel ? `<div class="win-side">${st.winnerLabel}占上风</div>` : ''}
      <div class="win-score">正方 ${s.pro_total} ：${s.con_total} 反方</div>
      ${best ? `<div class="win-best">最佳辩手 <b>${best.label} · ${bestM.alias}</b></div>` : ''}
    </div>
    <table class="score-table">
      <tr><th>方</th><th>内容与逻辑 40</th><th>语言表达 30</th><th>配合与应变 30</th><th>总分</th></tr>
      ${['pro', 'con'].map((side) => {
        const b = bd[side] || {};
        return `<tr><td>${SIDE_NAME[side]}</td><td>${b['内容与逻辑'] ?? '—'}</td><td>${b['语言表达'] ?? '—'}</td><td>${b['团队配合与应变'] ?? '—'}</td><td class="total">${side === 'pro' ? s.pro_total : s.con_total}</td></tr>`;
      }).join('')}
    </table>
    ${s.notes ? `<p class="score-notes">${esc(s.notes)}</p>` : ''}
    ${pendingAnnounce ? '<p class="score-notes">裁判已亮分，主席正在收尾…</p>' : ''}`;
}

/* ── 启动 ─────────────────────────────── */
(async function boot() {
  cfg = await api('/api/config').catch(() => ({ seats: [], models: [] }));
  route();
})();
