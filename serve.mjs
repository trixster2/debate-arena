import http from 'node:http';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './src/gateway.mjs';
import { SEATS, MODELS, autoAssign, shuffleAssign } from './src/models.mjs';
import { runDebate } from './src/orchestrator.mjs';
import { toMarkdown } from './src/report.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const WEB = join(ROOT, 'web');
const RUNS = join(ROOT, 'runs');
const PORT = Number(process.env.PORT || 5180);

loadEnv();

// 内存里的进行中比赛；结束后落盘，进程重启也能从 runs/ 回放
const live = new Map();

function newRunId() {
  let id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  while (live.has(id) || existsSync(join(RUNS, id))) id += 'x';
  return id;
}

function startRun(body) {
  const topic = String(body.topic || '').trim();
  if (!topic) throw new Error('辩题不能为空');
  if (!process.env.LLMGW_API_KEY) throw new Error('服务器缺少 LLMGW_API_KEY，请在项目根目录 .env 中配置');
  const freeRounds = Math.min(6, Math.max(1, Number(body.rounds) || 3));
  const qaRounds = Math.min(3, Math.max(1, Number(body.qa) || 2));
  const shuffle = !!body.shuffle;
  const seed = Number(body.seed) || 0;
  const assign = shuffle ? shuffleAssign(seed || Date.now()) : autoAssign(seed);
  const proStance = String(body.pro || '').trim() || `支持辩题所表述的一方（即「${topic}」成立）`;
  const conStance = String(body.con || '').trim() || `反对辩题所表述的一方（即「${topic}」不成立）`;

  const id = newRunId();
  const state = {
    id,
    status: 'running',
    meta: { topic, proStance, conStance, assign, freeRounds, qaRounds, startedAt: Date.now() },
    pending: null,
    transcript: [],
    progress: { idx: 0, total: 1 + 2 + 2 * (2 * qaRounds + 1) + 2 + 2 * freeRounds + 2 + 3 },
    scores: null,
    winner: null,
    winnerLabel: null,
    firstTeam: null,
    error: null,
  };
  live.set(id, state);

  runDebate({
    topic, proStance, conStance, assign, freeRounds, qaRounds, seed,
    log: () => {},
    onEvent: (ev) => {
      if (ev.type === 'pending') { state.pending = { ...ev, startedAt: Date.now() }; state.progress.idx = ev.idx; }
      else if (ev.type === 'speech') { state.transcript.push(ev.entry); state.pending = null; }
      else if (ev.type === 'score') { state.scores = ev.scores; state.winner = ev.winner; state.winnerLabel = ev.winnerLabel; state.firstTeam = ev.firstTeam; }
    },
  }).then((result) => {
    const dir = join(RUNS, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'debate.json'), JSON.stringify({ ...result, totalElapsedMs: Date.now() - state.meta.startedAt }, null, 2));
    writeFileSync(join(dir, 'transcript.md'), toMarkdown(result));
    state.status = 'done';
    state.finishedAt = Date.now();
  }).catch((e) => {
    state.status = 'error';
    state.error = String(e.message || e);
    state.pending = null;
    // 中断也留档：把已产生的实录落盘，历史对局里仍可回放到中断前
    try {
      const dir = join(RUNS, id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'debate.json'), JSON.stringify({
        topic, proStance, conStance, assign, transcript: state.transcript,
        scores: state.scores, winner: state.winner, winnerLabel: state.winnerLabel, firstTeam: state.firstTeam,
        error: state.error, totalElapsedMs: Date.now() - state.meta.startedAt,
      }, null, 2));
      if (state.scores) writeFileSync(join(dir, 'transcript.md'), toMarkdown({
        topic, proStance, conStance, assign, transcript: state.transcript,
        scores: state.scores, winnerLabel: state.winnerLabel, winner: state.winner,
      }));
    } catch { /* 留档失败不影响状态 */ }
  });

  return id;
}

function listRuns() {
  const out = [];
  for (const [id, s] of live) {
    out.push({ id, topic: s.meta.topic, status: s.status, speeches: s.transcript.length, scores: s.scores, startedAt: s.meta.startedAt });
  }
  if (existsSync(RUNS)) {
    for (const name of readdirSync(RUNS).sort().reverse()) {
      const f = join(RUNS, name, 'debate.json');
      if (live.has(name) || !existsSync(f)) continue;
      try {
        const d = JSON.parse(readFileSync(f, 'utf8'));
        out.push({ id: name, topic: d.topic, status: 'done', speeches: (d.transcript || []).length, scores: d.scores, startedAt: null });
      } catch { /* 跳过损坏的历史产物 */ }
    }
  }
  return out;
}

function getRun(id) {
  if (live.has(id)) {
    const s = live.get(id);
    return {
      ...s, meta: { ...s.meta }, pending: s.pending ? { ...s.pending } : null,
      totalElapsedMs: s.finishedAt ? s.finishedAt - s.meta.startedAt : null,
    };
  }
  const f = join(RUNS, id, 'debate.json');
  if (!existsSync(f)) return null;
  const d = JSON.parse(readFileSync(f, 'utf8'));
  return {
    id,
    status: 'done',
    meta: { topic: d.topic, proStance: d.proStance, conStance: d.conStance, assign: d.assign, freeRounds: null, qaRounds: null, startedAt: null },
    pending: null,
    transcript: d.transcript || [],
    scores: d.scores, winner: d.winner, winnerLabel: d.winnerLabel, firstTeam: d.firstTeam,
    error: null, totalElapsedMs: d.totalElapsedMs,
  };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  try {
    if (p.startsWith('/api/')) {
      if (p === '/api/config' && req.method === 'GET') {
        return send(res, 200, JSON.stringify({ seats: SEATS, models: MODELS, hasKey: !!process.env.LLMGW_API_KEY }));
      }
      if (p === '/api/runs' && req.method === 'GET') return send(res, 200, JSON.stringify(listRuns()));
      if (p === '/api/runs' && req.method === 'POST') {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          chunks.push(chunk); size += chunk.length;
          if (size > 64_000) throw new Error('body too large');
        }
        const id = startRun(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
        return send(res, 200, JSON.stringify({ id }));
      }
      const m = p.match(/^\/api\/runs\/([\w-]+)$/);
      if (m && req.method === 'GET') {
        const run = getRun(decodeURIComponent(m[1]));
        return run ? send(res, 200, JSON.stringify(run)) : send(res, 404, JSON.stringify({ error: 'not found' }));
      }
      return send(res, 404, JSON.stringify({ error: 'not found' }));
    }

    // 静态文件
    const file = p === '/' ? '/index.html' : p;
    const safe = file.replace(/\.\./g, '');
    const abs = join(WEB, safe);
    if (existsSync(abs) && extname(abs) in MIME) {
      return send(res, 200, readFileSync(abs), MIME[extname(abs)]);
    }
    return send(res, 404, 'not found', 'text/plain; charset=utf-8');
  } catch (e) {
    return send(res, 500, JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`模型辩论擂台已启动：http://localhost:${PORT}`);
  if (!process.env.LLMGW_API_KEY) console.log('提示：未检测到 LLMGW_API_KEY（.env），开赛会失败');
});
