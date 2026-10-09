#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './src/gateway.mjs';
import { autoAssign, shuffleAssign, normalizeAssign, SEATS } from './src/models.mjs';
import { runDebate } from './src/orchestrator.mjs';
import { toMarkdown } from './src/report.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { freeRounds: 3, qaRounds: 2, out: null, seed: 0, shuffle: false, dry: false, assign: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--rounds') args.freeRounds = Number(argv[++i]);
    else if (a === '--qa') args.qaRounds = Number(argv[++i]);
    else if (a === '--pro') args.pro = argv[++i];
    else if (a === '--con') args.con = argv[++i];
    else if (a === '--shuffle') args.shuffle = true;
    else if (a === '--seed') { args.seed = Number(argv[i + 1]); i++; }
    else if (a === '--assign') args.assign = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--dry') args.dry = true;
    else if (a === '-h' || a === '--help') { usage(); process.exit(0); }
    else rest.push(a);
  }
  args.topic = rest.join(' ').trim();
  return args;
}

function usage() {
  console.log(`用法: node debate.mjs "辩题" [选项]

选项:
  --pro "正方立场"    默认：支持辩题所表述的一方
  --con "反方立场"    默认：反对辩题所表述的一方
  --rounds N          自由辩论回合数（每回合双方各发言一次），默认 3
  --qa N              每组盘问的问答轮数，默认 2
  --shuffle           随机分配席位（默认按人设契合度自动分配）
  --seed N            随机/打散种子，同种子结果可复现
  --assign k=v,...    手动指定席位模型，如 pro1=glm-5.3,judge=kimi-k2.6
  --out DIR           输出目录，默认 runs/<时间戳>/
  --dry               只做席位分配并打印，不调用网关

密钥: 在项目根目录 .env 中写 LLMGW_API_KEY=...（参考 .env.example）`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.topic) { usage(); process.exit(1); }

loadEnv();

let assign;
if (args.assign) {
  const raw = {};
  for (const pair of args.assign.split(',')) {
    const [k, v] = pair.split('=');
    if (!k || !v) throw new Error(`--assign 格式应为 key=model，收到: ${pair}`);
    raw[k.trim()] = v.trim();
  }
  assign = normalizeAssign(raw);
} else if (args.shuffle) {
  assign = shuffleAssign(args.seed || Date.now());
} else {
  assign = autoAssign(args.seed);
}

if (args.dry) {
  console.log(`辩题：${args.topic}`);
  console.log('席位分配：');
  for (const s of SEATS) console.log(`  ${s.label.padEnd(5, '　')} ${assign[s.key]}`);
  process.exit(0);
}

if (!process.env.LLMGW_API_KEY) {
  console.error('缺少 LLMGW_API_KEY：请在项目根目录建 .env（参考 .env.example）');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = args.out ? join(ROOT, args.out) : join(ROOT, 'runs', stamp);
mkdirSync(outDir, { recursive: true });

const proStance = args.pro || `支持辩题所表述的一方（即「${args.topic}」成立）`;
const conStance = args.con || `反对辩题所表述的一方（即「${args.topic}」不成立）`;

console.log(`辩题：${args.topic}`);
console.log(`正方：${proStance}`);
console.log(`反方：${conStance}`);
console.log('席位：', Object.entries(assign).map(([k, v]) => `${k}=${v}`).join(', '));
console.log('---');

const t0 = Date.now();
let result;
const collected = [];
try {
  result = await runDebate({
    topic: args.topic,
    proStance,
    conStance,
    assign,
    freeRounds: args.freeRounds,
    qaRounds: args.qaRounds,
    onEvent: (ev) => { if (ev.type === 'speech') collected.push(ev.entry); },
  });
} catch (e) {
  console.error(`\n辩论中断：${e.message}`);
  writeFileSync(join(outDir, 'debate.json'), JSON.stringify({
    topic: args.topic, proStance, conStance, assign, transcript: collected,
    scores: null, error: String(e.message || e), totalElapsedMs: Date.now() - t0,
  }, null, 2));
  console.error(`已中断前的实录留档在 ${join(outDir, 'debate.json')}`);
  process.exit(2);
}

writeFileSync(join(outDir, 'debate.json'), JSON.stringify({ ...result, totalElapsedMs: Date.now() - t0 }, null, 2));
writeFileSync(join(outDir, 'transcript.md'), toMarkdown(result));
console.log('---');
console.log(`完赛，用时 ${((Date.now() - t0) / 60000).toFixed(1)} 分钟。产物：`);
console.log(`  ${join(outDir, 'transcript.md')}`);
console.log(`  ${join(outDir, 'debate.json')}`);
console.log(`结果：${result.winnerLabel}胜（${result.scores.pro_total} : ${result.scores.con_total}）`);
