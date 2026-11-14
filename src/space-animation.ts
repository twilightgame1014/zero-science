// 表示専用のゲーム時刻。推進・飛行物理は扱わない。
export const FLIGHT={hatch:3,corridor:3.8,tower:5.3,mount:7.8,ignition:8.4,ascent:10,space:14,ending:18} as const;
export function flightPose(elapsed:number,active:boolean){
 const t=active?Math.max(0,elapsed):0;
 return {hatch:active?Math.min(.8,Math.max(0,t-FLIGHT.hatch)):.8,
 corridor:Math.min(1.5,Math.max(0,t-FLIGHT.corridor)),
 tower:Math.min(2.5,Math.max(0,t-FLIGHT.tower)),
 mount:Math.min(.6,Math.max(0,t-FLIGHT.mount)),
 rise:active?Math.min(70,Math.max(0,t-FLIGHT.ascent)*12):0};
}
/* 契約 v6（Muse ラウンド30）：組込枠ごとの表示ノード一覧。S1＝骨組み、S2＝＋推進、S3＝＋搭乗区画＋外装、S4＝全部。部分外装の S2 は使わない（v6 で廃止）。 */
export type SlotNodes={frame:string[];propulsion:string[];capsule:string[];skin:string[]};
export function slotOf(name:string,sn?:SlotNodes):'frame'|'propulsion'|'capsule'|'skin'|undefined{
 if(sn){for(const k of ['frame','propulsion','capsule','skin'] as const)if(sn[k].includes(name))return k;return undefined;}
 // 契約がないときだけ旧いノード名の判定
 return /^Frame_/.test(name)?'frame':/^(Propulsion|PropSkirt|Nozzle|Fin)/.test(name)?'propulsion':/^(Capsule|Hatch|Nose|Window|RCS)/.test(name)?'capsule':'skin';
}
/** 組み込んだ枠から、機体のメッシュを出すかを決める。骨組みは外装がないときだけ。 */
export function slotVisible(name:string,installed:Record<string,unknown>,sn?:SlotNodes){
 if(!installed.structure)return false;
 const slot=slotOf(name,sn);
 return slot==='frame'?!installed.skin:slot==='propulsion'?!!installed.propulsion:slot==='capsule'?!!installed.capsule:slot==='skin'?!!installed.skin:false;
}
