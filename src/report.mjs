import { SEATS, findModel } from './models.mjs';

const SIDE_NAME = { pro: '正方', con: '反方' };

function seatTable(assign) {
  const rows = SEATS.map((s) => {
    const m = findModel(assign[s.key]);
    return `| ${s.label} | ${m.alias} | \`${m.id}\` |`;
  });
  return ['| 席位 | 马甲 | 模型 |', '|---|---|---|', ...rows].join('\n');
}

export function toMarkdown(result) {
  const lines = [];
  lines.push(`# 辩论赛实录：${result.topic}`);
  lines.push('');
  lines.push(`- 正方立场：${result.proStance}`);
  lines.push(`- 反方立场：${result.conStance}`);
  lines.push(`- 时间：${new Date().toLocaleString('zh-CN')}`);
  lines.push('');
  lines.push('## 席位分配');
  lines.push(seatTable(result.assign));
  lines.push('');

  let lastStage = null;
  for (const s of result.transcript) {
    if (s.stage !== lastStage) {
      lines.push('', `## ${s.stage}`, '');
      lastStage = s.stage;
    }
    lines.push(`**${s.label}（${s.alias} · \`${s.model}\`）**`);
    lines.push('');
    lines.push(s.text);
    lines.push('');
    const notes = [];
    notes.push(`${(s.elapsedMs / 1000).toFixed(1)}s`);
    if (s.usage.completion_tokens != null) notes.push(`${s.usage.completion_tokens} tok`);
    if (s.truncated) notes.push('被截断');
    if (s.recovered) notes.push('正文空，回落推理内容');
    lines.push(`> ${notes.join(' ｜ ')}`);
    lines.push('');
  }

  lines.push('', '## 裁判评分', '');
  const bd = result.scores.score_breakdown || {};
  lines.push('| 方 | 内容与逻辑(40) | 语言表达(30) | 配合与应变(30) | 总分 |');
  lines.push('|---|---|---|---|---|');
  for (const side of ['pro', 'con']) {
    const b = bd[side] || {};
    lines.push(`| ${SIDE_NAME[side]} | ${b['内容与逻辑'] ?? '-'} | ${b['语言表达'] ?? '-'} | ${b['团队配合与应变'] ?? '-'} | **${side === 'pro' ? result.scores.pro_total : result.scores.con_total}** |`);
  }
  const best = SEATS.find((s) => s.key === result.scores.best_debater_seat);
  lines.push('');
  lines.push(`- 胜方：**${result.winnerLabel}**`);
  lines.push(`- 最佳辩手：${best ? `${best.label}（${findModel(result.assign[best.key]).alias} · \`${result.assign[best.key]}\`）` : '-'}`);
  if (result.scores.notes) lines.push(`- 裁判核心考量：${result.scores.notes}`);
  lines.push('');
  return lines.join('\n');
}
