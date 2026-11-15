// 図鑑の点検の台帳を書き出す（2026-11-14 Claude）。正本は data.js・space-data.js・construction-data.js・book-data.js。ここでは数を書き写さず、BOOK から毎回作る。
// 出力：docs/book/RESOURCE-LEDGER.md（天然の原料・到達・元素の出どころ・説明との不一致）、docs/book/MANUSCRIPT-GAPS.md（原稿・出典・監修の不足）、docs/book/book-ledger.json（機械で読む形）
// 使い方：node scripts/export-book-ledger.mjs
import fs from 'node:fs'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const D = require('../src/game/data.js'); globalThis.DATA = D; require('../src/game/space-data.js'); require('../src/game/space-science.js'); require('../src/game/construction-data.js'); require('../src/game/book-data.js'); delete globalThis.DATA;
const E = require('../src/game/engine.js'); globalThis.CONS = require('../src/game/construction.js'); const B = require('../src/game/book.js');
const A = B.audit(), G = B.gaps(), IT = D.items, nm = id => IT[id] ? IT[id].name : id;
const out = new URL('../docs/book/', import.meta.url); fs.mkdirSync(out, { recursive: true });
const S = E.newState(); S.cons.rule = 'build';

let md = `# 資源と説明の点検の台帳（自動生成：node scripts/export-book-ledger.mjs）

正本（data.js の regions・procs・crafts、construction-data.js、space-data.js）から毎回作る。数をここで手書きしない。
元素は地面に元素のまま置かず、鉱石・水・空気・植物などの採れる原料に含まれる物として表している（品目の \`el\`）。

## 概要
| 項目 | 数 |
|---|---|
| 品目 | ${Object.keys(IT).length} |
| 天然の原料（地域で採れる・珍しい発見） | ${A.raws.length} |
| 天然の原料から作れない品目（到達不能） | ${A.unreachable.length}${A.unreachable.length ? '：' + A.unreachable.map(nm).join('・') : ''} |
| 採れる原料のどれにも含まれない元素 | ${A.noSource.length}${A.noSource.length ? '：' + A.noSource.map(x => x.element).join('・') : ''} |
| 用途の文があるのに、どの作り方にも使われていない品目 | ${A.usesTextOnly.length} |
| 天然の原料なのに「自然界では」の文がない品目 | ${A.rawNoNature.length} |

## 天然の原料
| 原料 | 採れる地域（必要な道具） | 原料の処理（研究室の作り方） | 使い道の数 | 含む元素 |
|---|---|---|---|---|
${A.raws.map(r => `| ${r.name}（${r.id}） | ${r.regions.map(g => g.name + (g.rare ? '（珍しい発見）' : '') + (g.need.length ? '［' + g.need.map(nm).join('か') + '］' : '')).join('・')} | ${r.processing.join('・') || '—'} | ${r.uses} | ${r.elements.join(' ') || '—'} |`).join('\n')}

## 元素の出どころ
| 元素 | その元素を含む採れる原料 | 使う品目の数 |
|---|---|---|
${Object.entries(A.elements).sort().map(([e, v]) => `| ${e} | ${[...new Set(v.sources)].map(nm).join('・') || '**なし**'} | ${v.users.length} |`).join('\n')}

## 説明との不一致（記録。科学の判断が要るものは GPT へ）
${A.usesTextOnly.length ? A.usesTextOnly.map(id => `- ${nm(id)}（${id}）：図鑑の用途の文「${IT[id].uses}」があるが、登録された作り方・建物の資材には使われていない。文を直すか、作り方を足すかは科学の判断が要る（作り方を足すなら根拠と元素の保存の確認が要る）。`).join('\n') : '- なし'}
`;
fs.writeFileSync(new URL('RESOURCE-LEDGER.md', out), md);

const cnt = k => G.filter(g => g.miss.includes(k)).length;
let gm = `# 図鑑の原稿・出典・監修の不足（自動生成：node scripts/export-book-ledger.mjs）

図鑑の画面は、原稿や出典がなくても表示できる（欄に「原稿待ち」「未登録」と出す）。ここは「何が足りないか」の一覧で、科学の原稿の全件監修とは完了の判定を分ける。
監修の状態は \`src/game/book-data.js\` の \`review\`。書いていない品目は「未確認」で、今は全件が未確認（${G.length} 件）。出典は品目に書いてある \`scienceSources\` だけを出し、ここで作らない。

## 欄ごとの不足の数（全 ${G.length} 品目）
| 欄 | 不足 |
|---|---|
| 自然界での存在（天然の原料だけ） | ${cnt('自然界での存在')} |
| 用途（文も作り方での使い道もない） | ${cnt('用途')} |
| ゲーム上の簡略化 | ${cnt('ゲーム上の簡略化')} |
| 出典 | ${cnt('出典')} |
| 監修（確認済みでない） | ${cnt('監修')} |

## 品目ごと（不足の欄）
| 品目 | 分類 | 不足 |
|---|---|---|
${G.map(g => `| ${g.name}（${g.id}） | ${g.cat} | ${g.miss.join('・') || '—'} |`).join('\n')}
`;
fs.writeFileSync(new URL('MANUSCRIPT-GAPS.md', out), gm);
fs.writeFileSync(new URL('book-ledger.json', out), JSON.stringify({ generatedBy: 'scripts/export-book-ledger.mjs', items: Object.keys(IT).length, raws: A.raws, unreachable: A.unreachable, noSource: A.noSource, usesTextOnly: A.usesTextOnly, rawNoNature: A.rawNoNature,
  gaps: G, entries: Object.keys(IT).map(id => { const e = B.entry(S, id); return { id, name: e.name, yomi: e.yomi, cat: e.cat, natural: e.natural, obtain: e.obtain.map(o => ({ kind: o.kind, key: o.key, inputs: o.inputs, outputs: o.outputs, at: o.at, tools: o.tools, time: o.time })), review: e.review.status, sources: e.sources.urls.length }; }) }, null, 1));
console.log(`品目 ${Object.keys(IT).length}・天然の原料 ${A.raws.length}・到達不能 ${A.unreachable.length}・出どころのない元素 ${A.noSource.length}・用途の文だけ ${A.usesTextOnly.length}・原稿の不足（出典） ${cnt('出典')}`);
