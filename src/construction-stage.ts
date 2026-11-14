/* 街づくり：Muse の正式な工程別の見た目を受け取る口（2026-11-14 Claude）。
   正本は docs/construction/construction-assets.json の museFields（CONSTRUCTION-CONTRACT.md）。
   ・stageNodes：工程の番号（"0","1",…）ごとに、完成モデル（既存の structures.json の GLB）の中で表示するノード名の一覧。
     ある工程の施工中・施工後はその一覧を表示する。足場など建設中だけの部品は Scaffold_* で、完成した建物では必ず隠す。
   ・一覧に名前のあるノードは、その子孫ごと表示する（親の名前を書けば、まとめて出せる）。一覧にないメッシュは隠す。
     ContactShadow（接地影）は一覧になくても表示する（工程に関係しない）。
   ・まだ納品されていない建物（stageNodes が null）は、この口を使わない（ゲームは杭・資材の山・足場の仮表示のまま）。
   この関数は three.js に依存しない（テストで直接呼ぶ）。描画への適用は graphics-entry.ts の stagedBuildingType。 */
export type StageNodes = Record<string, string[]>;
export const SCAFFOLD = /^Scaffold_/;

/** 工程の状態から、表示に使う工程の番号を決める。null は「正式の見た目を出さない（予定地の杭だけ）」。
 *  phase：planned／supplying／constructing／completed。stage：施工が終わった工程の数（construction.js の inst.stage）。 */
export function stageKey(stageNodes: StageNodes | null | undefined, phase: string, stage: number, count: number): string | null {
  if (!stageNodes) return null;
  if (phase === 'completed') return 'done';
  const idx = phase === 'constructing' ? stage : stage - 1;   // 施工中はその工程の姿、搬入中・予定地は終わった工程の姿
  if (idx < 0) return null;
  const k = String(Math.min(idx, count - 1));
  return stageNodes[k] ? k : null;
}

/** 名前とその祖先の名前の並び（自分が先頭）から、表示するかを決める。key='done' は完成形（足場だけを隠す）。 */
export function stageVisible(chain: string[], key: string, stageNodes: StageNodes | null | undefined): boolean {
  if (chain.some(n => SCAFFOLD.test(n))) return key !== 'done' && !!stageNodes && chain.some(n => (stageNodes[key] || []).includes(n));
  if (key === 'done' || !stageNodes) return true;
  if (chain.includes('ContactShadow')) return true;
  const list = stageNodes[key] || [];
  return chain.some(n => list.includes(n));
}

/** 契約の検査：一覧の名前が GLB に実在し、工程の番号が 0〜count-1 にあり、最後の工程は完成形（足場以外の全部）を含むか。問題の文の一覧を返す。 */
export function checkStageNodes(stageNodes: StageNodes, nodeNames: string[], count: number): string[] {
  const out: string[] = [], names = new Set(nodeNames);
  for (const [k, list] of Object.entries(stageNodes)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= count) out.push(`工程の番号 ${k} が 0〜${count - 1} の外`);
    for (const n of list) if (!names.has(n)) out.push(`工程 ${k}：ノード ${n} が GLB にない`);
  }
  return out;
}
