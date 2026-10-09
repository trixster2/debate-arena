export const MODELS = [
  {
    id: 'deepseek-v4-pro-0813',
    alias: '锋刃',
    style: '逻辑链条又长又硬，喜欢当面拆对手的论证结构，攻击性强，不留情面。',
    traits: { constructive: 4, rebuttal: 5, questioning: 5, closing: 4, moderation: 2, judging: 5 },
  },
  {
    id: 'kimi-k2.6',
    alias: '说书人',
    style: '长于铺陈叙事，用具体的人、具体的场景讲道理，感染力足，收尾漂亮。',
    traits: { constructive: 4, rebuttal: 3, questioning: 3, closing: 5, moderation: 3, judging: 4 },
  },
  {
    id: 'minimax-m3',
    alias: '火种',
    style: '表达欲旺盛，金句多，节奏快，负责把全场气氛点燃，偶尔跳脱。',
    traits: { constructive: 3, rebuttal: 4, questioning: 3, closing: 5, moderation: 3, judging: 3 },
  },
  {
    id: 'qwen3.8-27b',
    alias: '定盘星',
    style: '四平八稳，不抢话也不掉链子，擅长在混战里把己方立场重新摆正。',
    traits: { constructive: 4, rebuttal: 3, questioning: 3, closing: 3, moderation: 4, judging: 4 },
  },
  {
    id: 'deepseek-v4-flash-0731',
    alias: '疾风',
    style: '反应极快，追问短促密集，盘问环节不给对手喘息的机会。',
    traits: { constructive: 2, rebuttal: 3, questioning: 5, closing: 2, moderation: 3, judging: 3 },
  },
  {
    id: 'deepseek-v4-flash-vision',
    alias: '明察',
    style: '对细节过敏，专抓对手发言里前后不一致的措辞，以小见大。',
    traits: { constructive: 2, rebuttal: 4, questioning: 4, closing: 2, moderation: 3, judging: 3 },
  },
  {
    id: 'Agents-A1',
    alias: '杂家',
    style: '知识面杂，什么领域都能接一句，野路子类比多，常在意外处得手。',
    traits: { constructive: 3, rebuttal: 4, questioning: 3, closing: 3, moderation: 3, judging: 3 },
  },
  {
    id: 'Atria-Dawn-Preview',
    alias: '晨星',
    style: '温和克制，控场感好，念流程、cue 环节从不失手，天生的主持腔。',
    traits: { constructive: 3, rebuttal: 2, questioning: 2, closing: 3, moderation: 5, judging: 3 },
  },
];

export const SEATS = [
  { key: 'pro1', trait: 'constructive', label: '正方一辩', side: 'pro', order: 1 },
  { key: 'pro2', trait: 'rebuttal', label: '正方二辩', side: 'pro', order: 2 },
  { key: 'pro3', trait: 'questioning', label: '正方三辩', side: 'pro', order: 3 },
  { key: 'pro4', trait: 'closing', label: '正方四辩', side: 'pro', order: 4 },
  { key: 'con1', trait: 'constructive', label: '反方一辩', side: 'con', order: 1 },
  { key: 'con2', trait: 'rebuttal', label: '反方二辩', side: 'con', order: 2 },
  { key: 'con3', trait: 'questioning', label: '反方三辩', side: 'con', order: 3 },
  { key: 'con4', trait: 'closing', label: '反方四辩', side: 'con', order: 4 },
  { key: 'judge', trait: 'judging', label: '裁判长', side: null, order: 0 },
  { key: 'chair', trait: 'moderation', label: '主席', side: null, order: 0 },
];

const SEAT_BY_KEY = Object.fromEntries(SEATS.map((s) => [s.key, s]));
const MODEL_BY_ID = Object.fromEntries(MODELS.map((m) => [m.id, m]));

export function findModel(id) {
  return MODEL_BY_ID[id] || { id, alias: '无名', style: '风格未知，临场自定。', traits: {} };
}

// 贪心分配：按 (席位, 模型) 的人设契合分从高到低占座
export function autoAssign(seed = 0) {
  const rng = mulberry32(seed);
  const pairs = [];
  for (const seat of SEATS) {
    for (const m of MODELS) {
      const jitter = seed ? rng() * 0.01 : 0; // 打散同分，保证同 seed 可复现
      pairs.push({ seat: seat.key, model: m.id, score: (m.traits[seat.trait] ?? 0) + jitter });
    }
  }
  // 稳定排序：分数优先，同分按席位声明顺序再按模型声明顺序
  const seatRank = Object.fromEntries(SEATS.map((s, i) => [s.key, i]));
  const modelRank = Object.fromEntries(MODELS.map((m, i) => [m.id, i]));
  pairs.sort((a, b) => b.score - a.score || seatRank[a.seat] - seatRank[b.seat] || modelRank[a.model] - modelRank[b.model]);

  // 模型池 ≥ 席位时每个模型只上一个座；池子不够时先限额兼帽（每模型最多 ceil(席位/池) 顶），
  // 仍填不满再放开限制，避免出现一个模型包场三个席位的怪局
  const hats = {};
  const assign = {};
  for (const p of pairs) {
    if (assign[p.seat] || hats[p.model]) continue;
    assign[p.seat] = p.model;
    hats[p.model] = 1;
    if (Object.keys(assign).length === SEATS.length) break;
  }
  const cap = Math.ceil(SEATS.length / MODELS.length);
  for (const p of pairs) {
    if (!assign[p.seat] && (hats[p.model] || 0) < cap) {
      assign[p.seat] = p.model;
      hats[p.model] = (hats[p.model] || 0) + 1;
    }
  }
  for (const p of pairs) {
    if (!assign[p.seat]) assign[p.seat] = p.model;
  }
  return assign;
}

export function shuffleAssign(seed = Date.now()) {
  const rng = mulberry32(seed);
  const pool = MODELS.map((m) => m.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const assign = {};
  SEATS.forEach((s, i) => { assign[s.key] = pool[i % pool.length]; });
  return assign;
}

export function normalizeAssign(raw) {
  const assign = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!SEAT_BY_KEY[k]) throw new Error(`未知席位: ${k}（可用：${SEATS.map((s) => s.key).join(', ')}）`);
    assign[k] = v;
  }
  for (const s of SEATS) {
    if (!assign[s.key]) throw new Error(`手动分配缺少席位: ${s.key}`);
  }
  return assign;
}

export function seatLabel(key) {
  return SEAT_BY_KEY[key]?.label ?? key;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
