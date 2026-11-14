// ゲーム側の仮表示アダプター。Museのsrc/graphics・原本は変更しない。
import * as THREE from 'three';
import {updateSpaceModels} from './space-models';
export {spaceModelStatus} from './space-models';
type Site={x:number;z:number;y:number;rot:number;stage:number;phase:string;elapsed:number;installed:Record<string,number>;owned:Record<string,boolean>};
type Entry={root:THREE.Group;ship:THREE.Group;tower:THREE.Group;flame:THREE.Mesh;parts:THREE.Object3D[];suit:THREE.Group;sig:string};
const entries=new WeakMap<object,Entry>();
function box(parent:THREE.Object3D,w:number,h:number,d:number,x:number,y:number,z:number,color:number){
  const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:0.82}));m.position.set(x,y,z);m.castShadow=true;parent.add(m);return m;
}
function create():Entry{
  const root=new THREE.Group();root.name='SpaceSitePlaceholder';const ship=new THREE.Group();ship.name='rocket';root.add(ship);
  box(root,16,.5,16,0,.25,0,0x686d70);box(root,1.8,1.2,1,5,1,5,0x1d7f7b);
  const tower=new THREE.Group();tower.name='support-tower';root.add(tower);
  for(const x of [-5.5,-4])for(const z of [-.7,.7])box(tower,.18,17,.18,x,8.5,z,0x22364f);
  for(let y=1;y<17;y+=2)box(tower,1.7,.15,1.6,-4.75,y,0,0x8a8d90);
  box(tower,3.5,.18,1,-3.1,15,0,0x1d7f7b);
  const frame=new THREE.Group();frame.name='Frame_BodyLower';ship.add(frame);
  for(const x of [-1.1,1.1])for(const z of [-1.1,1.1])box(frame,.12,13,.12,x,7,z,0x8a8d90);
  const skin=new THREE.Mesh(new THREE.CylinderGeometry(1.4,1.5,13,12),new THREE.MeshStandardMaterial({color:0xe8dfc8,roughness:.86}));skin.position.y=7.5;skin.name='BodyLower';ship.add(skin);
  const capsule=new THREE.Mesh(new THREE.ConeGeometry(1.4,3,12),new THREE.MeshStandardMaterial({color:0xe8dfc8,roughness:.8}));capsule.position.y=15.5;capsule.name='Capsule';ship.add(capsule);
  const window=box(ship,.8,.65,.1,0,14.8,1.25,0x1d7f7b);window.name='PassengerWindow';
  const flame=new THREE.Mesh(new THREE.ConeGeometry(.8,3,10),new THREE.MeshBasicMaterial({color:0xf4c572,transparent:true,opacity:.8}));flame.rotation.z=Math.PI;flame.position.y=-.5;ship.add(flame);
  for(const [name,xyz]of Object.entries({Anchor_exhaust:[0,0,0],Anchor_hatch:[-1.2,15,0],Anchor_smoke_l:[-3,.5,0],Anchor_smoke_r:[3,.5,0]})){const a=new THREE.Object3D();a.name=name;a.position.set(...xyz as [number,number,number]);root.add(a);}
  const suit=new THREE.Group();suit.name='SpacesuitEquipmentPlaceholder';
  box(suit,.48,.5,.32,0,.65,0,0xe8dfc8);box(suit,.32,.38,.22,0,.73,-.3,0x22364f);
  const helmet=new THREE.Mesh(new THREE.SphereGeometry(.32,12,8),new THREE.MeshStandardMaterial({color:0xa4d5d1,roughness:.2,transparent:true,opacity:.35,depthWrite:false}));helmet.position.y=1.15;suit.add(helmet);
  return {root,ship,tower,flame,parts:[frame,skin,capsule,window],suit,sig:''};
}
export function syncSpaceVisual(gfx:any,site:Site|null,suited:any){
  let e=entries.get(gfx);if(!e){e=create();entries.set(gfx,e);gfx.getScene().add(e.root,e.suit);}
  e.root.visible=!!site;if(site){e.root.position.set(site.x,site.y,site.z);e.root.rotation.y=site.rot;
    e.parts[0].visible=!!site.installed.structure;e.parts[1].visible=!!site.installed.skin;e.parts[2].visible=!!site.installed.capsule;e.parts[3].visible=!!site.installed.capsule;
    const flying=['ascent','space','ending'].includes(site.phase);e.ship.position.y=flying?Math.min(55,Math.max(0,site.elapsed-10)*9):0;
    e.root.visible=!['space','ending'].includes(site.phase);e.flame.visible=['ignition','ascent'].includes(site.phase);
    e.tower.position.x=['retract','ignition','ascent'].includes(site.phase)?-Math.min(3,Math.max(0,site.elapsed-3)*1.5):0;
  }
  const formal=updateSpaceModels(gfx,site,(window as any).ASSETS?.spaceModels);if(formal)e.root.visible=false;
  e.suit.visible=false; // 正式8方向シートをUI側で切り替える。仮の立体服は使わない。
  /* 公開APIで搭乗中の絵だけ隠す。旧描画モジュールにも互換の経路を残す。 */
  const inside=!!site&&/^(boarded|countdown|retract|ignition|ascent|space|ending)$/.test(site.phase);
  if(typeof gfx.setPlayerVisible==='function')gfx.setPlayerVisible(!inside);
  else {const ch=gfx&&gfx.character&&gfx.character.group;if(ch&&ch.visible===inside)ch.visible=!inside;}
  if(e.suit.visible){const p=suited.position;e.suit.position.set(p.x,suited.y??0,p.z);}
}
