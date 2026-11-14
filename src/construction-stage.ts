/* 街づくり：Muse の正式な工程別の見た目（2026-11-14。正本は docs/construction/CONSTRUCTION-CONTRACT.md の「Muse の納品」節と
   construction-assets.json の museFields.stageNodes）。three.js に依存しない（テストで直接呼ぶ）。描画への適用は graphics-entry.ts の stagedBuildingType。
   ・一覧 k は、工程 k が「完了した直後」に表示するノード（累積。ロケット v6 の slotNodes と同じ読み方）。最後の一覧＝完成した姿。
   ・工程 k の施工中は一覧 k−1（k=0 は建物のノードなし）＋足場と資材。予定地・搬入中も、終わった工程の一覧（工程 0 の前は建物なし）。
   ・ContactShadow（接地影）は最後の一覧にだけある（途中で出すと斜面で板が浮く）。一覧のとおりに出す。
   ・足場 Scaffold_* は建物の GLB には無く、共有キットから別に置く（construction-visual.ts）。完成した建物では必ず隠す。
   ・名前の照合：GLTFLoader は読み込みでノード名を正規化する（空白→_、[ ] . : / を取り除く。post.001 → post001）。一覧の名前も同じ規則で正規化して比べる。 */
export type StageNodes = Record<string, string[]>;
export const SCAFFOLD = /^Scaffold_/;
/** three.js の PropertyBinding.sanitizeNodeName と同じ規則 */
export const normName = (n: string) => String(n).replace(/\s/g, '_').replace(/[\[\]\.:\/]/g, '');

/** 工程の状態から、表示に使う一覧の番号を決める。null は「建物のノードを出さない（予定地キットと資材だけ）」。
 *  phase：planned／supplying／constructing／completed。stage：施工が終わった工程の数（construction.js の inst.stage）。 */
export function stageKey(stageNodes: StageNodes | null | undefined, phase: string, stage: number, count: number): string | null {
  if (!stageNodes) return null;
  if (phase === 'completed') return 'done';
  const idx = Math.min(stage, count) - 1;          // 終わった工程の最後（施工中の工程 k なら k−1）
  if (idx < 0) return null;
  return stageNodes[String(idx)] ? String(idx) : null;
}
const sets = new WeakMap<StageNodes, Map<string, Set<string>>>();
function setOf(stageNodes: StageNodes, key: string): Set<string> {
  let m = sets.get(stageNodes); if (!m) { m = new Map(); sets.set(stageNodes, m); }
  let s = m.get(key); if (!s) { s = new Set((stageNodes[key] || []).map(normName)); m.set(key, s); }
  return s;
}
/** メッシュが属する GLTF のノードの名前（読み込み後の正規化された名前）から、表示するかを決める。key='done' は完成形（足場以外の全部）。 */
export function stageVisible(nodeName: string, key: string, stageNodes: StageNodes | null | undefined): boolean {
  if (SCAFFOLD.test(nodeName)) return false;
  if (key === 'done' || !stageNodes) return true;
  return setOf(stageNodes, key).has(normName(nodeName));
}

/** 契約の検査：一覧の名前が GLB に実在し（正規化してから比べる）、工程の番号が 0〜count-1 にあり、正規化で名前がぶつからないか。問題の文の一覧を返す。 */
export function checkStageNodes(stageNodes: StageNodes, nodeNames: string[], count: number): string[] {
  const out: string[] = [], norm = new Map<string, string>();
  for (const n of nodeNames) { const k = normName(n); if (norm.has(k) && norm.get(k) !== n) out.push(`正規化で名前がぶつかる：${norm.get(k)} と ${n}`); norm.set(k, n); }
  for (const [k, list] of Object.entries(stageNodes)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= count) out.push(`工程の番号 ${k} が 0〜${count - 1} の外`);
    for (const n of list) if (!norm.has(normName(n))) out.push(`工程 ${k}：ノード ${n} が GLB にない`);
  }
  return out;
}

/* ---------- 足場の配置（契約の「足場キット」の規則。数だけを返し、three.js の部品はゲーム側で置く） ----------
   占有範囲を 0.45 広げた外周に、柱を角と 2.2 以下の間隔で立てる。施工中の工程 k（全 N 工程）では高さ (k+1)/N ×（建物の高さ＋0.6）を上限に、
   2.2 ごとの段で横木を回す。足場板は最上段の入口側（+Z）ともう 1 面（+X）。筋交いは外周の区間に 1 つおき。梯子は入口側の角に 1 本。 */
export type Pt = [number, number];
export function scaffoldPlan(shape: 'rect' | 'circle', w: number, d: number, r: number, k: number, N: number, h: number) {
  const H = Math.max(0.6, (Math.min(k, N - 1) + 1) / Math.max(1, N) * (h + 0.6));
  let corners: Pt[];
  if (shape === 'rect') { const hw = w / 2 + 0.45, hd = d / 2 + 0.45; corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]; }
  else { const R = r + 0.45; corners = Array.from({ length: 8 }, (_, i) => [Math.cos(i / 8 * Math.PI * 2) * R, Math.sin(i / 8 * Math.PI * 2) * R] as Pt); }
  const posts: Pt[] = [], segs: { a: Pt; b: Pt; side: string }[] = [];
  corners.forEach((p, i) => { const q = corners[(i + 1) % corners.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(len / 2.2 - 1e-9));
    const side = shape === 'rect' ? ['-z', '+x', '+z', '-x'][i] : (p[1] + q[1] > 0 ? '+z' : p[0] + q[0] > 0 ? '+x' : 'o');
    for (let s = 0; s < n; s++) { const a: Pt = [p[0] + (q[0] - p[0]) * s / n, p[1] + (q[1] - p[1]) * s / n], b: Pt = [p[0] + (q[0] - p[0]) * (s + 1) / n, p[1] + (q[1] - p[1]) * (s + 1) / n]; posts.push(a); segs.push({ a, b, side }); } });
  const levels: number[] = []; for (let y = 2.2; y < H - 0.05; y += 2.2) levels.push(y); levels.push(H);
  const top = levels[levels.length - 1];
  const planks = segs.filter(s => s.side === '+z' || s.side === '+x');
  const braces = segs.filter((_, i) => i % 2 === 0);
  const ladder: Pt = shape === 'rect' ? corners[2] : corners.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { H, posts, segs, levels, top, planks, braces, ladder };
}

/* ---------- 資材の山の種類（契約：まだ運んでいない資材から選ぶ。木材→lumber、石材→stone、袋物→sacks、金属→metal、その他→crated） ---------- */
const PILE: Record<string, string[]> = {
  lumber: ['twig', 'log', 'plank', 'charcoal', 'bark'],
  stone: ['cobble', 'granite', 'brick', 'flint', 'limestone', 'marble', 'basalt', 'firebrick'],
  sacks: ['sand', 'clay', 'thread', 'cloth', 'redpigment', 'plaster', 'cement', 'lime', 'quicklime', 'ash', 'leaves', 'grass', 'salt', 'soda', 'coke', 'gravel'],
  metal: ['iron', 'steel', 'copper', 'copperplate', 'wire', 'tin', 'bronze', 'aluminum', 'electromagnet', 'ironrod', 'pipe', 'bellows', 'generator'],
};
export function pileKind(item: string): string { for (const [k, l] of Object.entries(PILE)) if (l.includes(item)) return k; return 'crated'; }
