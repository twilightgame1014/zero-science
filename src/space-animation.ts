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
// v6のノード一覧はMuse契約を正本とし、取得した組込枠を直接反映する。
export function visibleForSlots(name:string,installed:Record<string,number>,slots:Record<string,string[]>|undefined){
 if(!installed.structure||!slots)return false;
 if(slots.frame.includes(name))return !installed.skin;
 if(slots.propulsion.includes(name))return !!installed.propulsion;
 if(slots.capsule.includes(name))return !!installed.capsule;
 return slots.skin.includes(name)&&!!installed.skin;
}
