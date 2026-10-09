import { chat } from './gateway.mjs';
import { SEATS, findModel } from './models.mjs';

const SIDE_NAME = { pro: '正方', con: '反方' };

function truncate(text, n = 900) {
  return text.length > n ? text.slice(0, n) + '……（发言略）' : text;
}

export async function runDebate(opts) {
  const {
    topic,
    proStance,
    conStance,
    assign,
    freeRounds = 3,
    qaRounds = 2,
    log = console.log,
    onEvent = () => {},
  } = opts;

  const stance = { pro: proStance, con: conStance };
  const transcript = [];
  let callNo = 0;
  const totalCalls = 1 + 2 + 2 * (2 * qaRounds + 1) + 2 + 2 * freeRounds + 2 + 3;

  const context = (excludeIdx = transcript.length) =>
    transcript
      .filter((_, i) => i !== excludeIdx)
      .map((s) => `【${s.label}·${s.alias}】${truncate(s.text)}`)
      .join('\n\n') || '（场上还没有发言。）';

  async function call(seatKey, task, extra = {}) {
    const modelId = assign[seatKey];
    const seat = SEATS.find((s) => s.key === seatKey);
    const m = findModel(modelId);
    const sideName = seat.side ? SIDE_NAME[seat.side] : m.alias;
    const system = extra.system ?? [
      `你是一场中文辩论赛里的「${m.alias}」，真实身份是语言模型 ${m.id}。`,
      `本场辩题：${topic}。${sideName}的立场：${stance[seat.side] ?? '（非选手席位）'}。`,
      `你的席位：${seat.label}。你的人设：${m.style}`,
      `赛制为国际大专辩论赛流程：开篇立论 → 盘问 → 驳立论 → 自由辩论 → 结辩。`,
      `要求：全程中文；只输出你的发言本身，不要解释规则、不要旁白、不要自问自答；紧扣场上已发生的发言。`,
    ].join('\n');

    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: `【场上实录】\n${context()}\n\n【现在轮到你】${task}` },
    ];

    callNo += 1;
    const tag = `[${callNo}/${totalCalls}] ${seat.label}（${m.alias} · ${m.id}）`;
    onEvent({ type: 'pending', stage: extra.stage || seat.label, seat: seatKey, label: seat.label, alias: m.alias, model: modelId, idx: callNo, total: totalCalls });
    let r;
    try {
      r = await chat({ model: modelId, messages, thinking: false, maxTokens: 8192, ...extra.chatOpts });
    } catch (e1) {
      log(`${tag} 首次调用失败（${e1.message.slice(0, 80)}），2 秒后重试…`);
      await new Promise((ok) => setTimeout(ok, 2000));
      r = await chat({ model: modelId, messages, thinking: false, maxTokens: 8192, ...extra.chatOpts });
    }
    log(`${tag} ${extra.stage || seat.label} ✓ ${(r.elapsedMs / 1000).toFixed(1)}s / ${r.usage.completion_tokens ?? '?'} tok`);

    const entry = {
      stage: extra.stage || seat.label,
      seat: seatKey,
      side: seat.side,
      label: seat.label,
      alias: m.alias,
      model: modelId,
      text: r.text || '（该模型未产出正文）',
      truncated: r.truncated,
      recovered: r.recoveredFromReasoning,
      elapsedMs: r.elapsedMs,
      usage: r.usage,
    };
    transcript.push(entry);
    onEvent({ type: 'speech', entry });
    return entry;
  }

  // ── 1. 主席开场 ────────────────────────────────────────────
  await call('chair', [
    '你是本场辩论赛主席。做开场：宣布辩题、介绍正方与反方立场、点名四方辩手席位与裁判长，',
    '并简要说明流程（立论→盘问→驳立论→自由辩论→结辩→裁判评议）。250 字以内，只说开场词。',
  ].join(''), { stage: '主席开场', chatOpts: { temperature: 0.7 } });

  // ── 2. 开篇立论 ────────────────────────────────────────────
  for (const k of ['pro1', 'con1']) {
    await call(k, '开篇立论：给出你方对辩题核心概念的定义与比较标准，再用三个分论点搭起你方立论框架。700 字以内。', { stage: '开篇立论' });
  }

  // ── 3. 盘问（三辩提问，对方一辩应答）─────────────────────────
  for (const [askKey, ansKey] of [['pro3', 'con1'], ['con3', 'pro1']]) {
    const asker = SEATS.find((s) => s.key === askKey).label;
    const answerer = SEATS.find((s) => s.key === ansKey).label;
    for (let i = 1; i <= qaRounds; i++) {
      await call(askKey, `盘问环节第 ${i} 问：向${answerer}提出一个追问，一次只问一个问题，80 字以内，不要自己作答。`, { stage: `盘问·${asker}` });
      await call(ansKey, `回答${asker}刚才的提问：直面问题本身，不回避，给出你方解释。150 字以内。`, { stage: `盘问·${answerer}应答` });
    }
    await call(askKey, '盘问小结：用一段话点明刚才盘问中你方获得的最有价值的东西（对方暴露的前提、退让或矛盾）。200 字以内。', { stage: `盘问小结·${asker}` });
  }

  // ── 4. 驳立论 ──────────────────────────────────────────────
  for (const k of ['pro2', 'con2']) {
    await call(k, '驳立论：针对对方此前的立论与盘问表现做系统反驳，指出其定义或推论上的漏洞，同时重申你方框架。600 字以内。', { stage: '驳立论' });
  }

  // ── 5. 自由辩论 ────────────────────────────────────────────
  for (let r = 1; r <= freeRounds; r++) {
    for (const side of ['pro', 'con']) {
      const speaker = side === 'pro' ? ['pro2', 'pro3', 'pro4'][(r - 1) % 3] : ['con2', 'con3', 'con4'][(r - 1) % 3];
      await call(speaker, '自由辩论：轮到你方发言，回应对方最近一次发言或抛出新的攻击点。150 字以内，短、准、狠。', { stage: `自由辩论 第${r}轮` });
    }
  }

  // ── 6. 结辩（反方先，正方后）────────────────────────────────
  for (const k of ['con4', 'pro4']) {
    await call(k, '结辩陈词：收束全场，比较双方整场交锋的得失，把裁判的注意力引向你方最硬的论点。700 字以内。', { stage: '结辩' });
  }

  // ── 7. 裁判：评分 + 点评 ───────────────────────────────────
  const judgeModel = findModel(assign.judge);
  const fullContext = transcript.map((s) => `【${s.label}·${s.alias}】${truncate(s.text, 1200)}`).join('\n\n');

  const scoreSystem = [
    `你是辩论赛的裁判长，代号「${judgeModel.alias}」，真实身份是语言模型 ${assign.judge}。`,
    `你评审的辩题是「${topic}」。正方立场：${proStance}；反方立场：${conStance}。`,
    '按国际大专辩论赛标准评分：内容与逻辑 40 分、语言表达 30 分、团队配合与应变 30 分，各满分以上三项合计 100。',
    '只输出 JSON，不要输出其他文字。JSON 形如：',
    '{"pro_total":0,"con_total":0,"winner":"pro|con|tie","best_debater_seat":"pro3","score_breakdown":{"pro":{"内容与逻辑":0,"语言表达":0,"团队配合与应变":0},"con":{"内容与逻辑":0,"语言表达":0,"团队配合与应变":0}},"notes":"一句话核心理由"}',
  ].join('\n');

  callNo += 1;
  log(`[${callNo}/${totalCalls}] 裁判长评分（${judgeModel.alias} · ${assign.judge}）…`);
  let scores;
  for (let attempt = 1; ; attempt++) {
    const r = await chat({
      model: assign.judge,
      temperature: 0.2,
      maxTokens: 4096,
      thinking: false,
      json: true,
      messages: [
        { role: 'system', content: scoreSystem },
        { role: 'user', content: `【全场实录】\n${fullContext}\n\n请给出评分 JSON。` },
      ],
    });
    try {
      const jsonText = r.text.match(/\{[\s\S]*\}/)?.[0];
      scores = JSON.parse(jsonText);
      break;
    } catch {
      if (attempt >= 2) throw new Error(`裁判评分 JSON 解析失败：${r.text.slice(0, 200)}`);
      log('  评分格式异常，重试…');
    }
  }
  const winner = scores.winner || (scores.pro_total > scores.con_total ? 'pro' : scores.con_total > scores.pro_total ? 'con' : 'pro');
  log(`  → 正方 ${scores.pro_total} : ${scores.con_total} 反方，胜方：${SIDE_NAME[winner] ?? winner}，最佳辩手：${SEATS.find((s) => s.key === scores.best_debater_seat)?.label ?? scores.best_debater_seat}`);
  onEvent({ type: 'score', scores, winner, winnerLabel: SIDE_NAME[winner] });

  const critique = await call('judge', [
    '裁判点评（口头部分）：结合你的评分，指出本场胜负手在哪里、双方最值得肯定的表现各一处，',
    `并说明为什么最佳辩手是 ${SEATS.find((s) => s.key === scores.best_debater_seat)?.label ?? '该选手'}。300 字以内。`,
  ].join(''), { stage: '裁判点评', chatOpts: { temperature: 0.6 } });

  // ── 8. 主席宣布结果 ────────────────────────────────────────
  const bestSeat = SEATS.find((s) => s.key === scores.best_debater_seat);
  const result = await call('chair', [
    '宣布结果：正方 {P} 比 反方 {C}，胜方为{W}，最佳辩手为{B}（{BA}）。',
    '念出终场宣布词：宣布比分、胜方与最佳辩手，感谢双方与裁判。100 字以内。',
  ].join('').replace('{P}', scores.pro_total).replace('{C}', scores.con_total)
    .replace('{W}', SIDE_NAME[winner]).replace('{B}', bestSeat?.label ?? '?').replace('{BA}', bestSeat ? findModel(assign[bestSeat.key]).alias : '?'),
    { stage: '主席宣布', chatOpts: { temperature: 0.7 } });

  return { topic, proStance, conStance, assign, transcript, scores, winnerLabel: SIDE_NAME[winner], winner, critique, result };
}
