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
export function visibleAtStage(name:string,stage:number){
 if(stage===0)return false;
 if(stage===1)return /^Frame_/.test(name);
 if(stage===2)return /^(Propulsion|PropSkirt|Nozzle|NozzleInner|BodyLowerInsul|Skin_Lower_P[123]|Skin_Upper_P2|SeamRing_70|Frame_BodyLower|Frame_BodyUpper|Frame_TankUpper)(?:$|[_.])/.test(name);
 return !/^Frame_/.test(name);
}
