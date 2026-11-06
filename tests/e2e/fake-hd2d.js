(function(){
  const module={exports:{}}; const exports=module.exports;
  /*UTILS*/
  const U=module.exports;
  const cfgDefault={world:{size:120,terrainSegments:168,waterLevel:0.32,plateauCenter:{x:-20,z:20},plateauRadius:15,seed:1337},coordinates:{scale:1,origin:{x:0,y:0,z:0}},camera:{viewSize:26,pitchDegrees:50,yawDegrees:45,followDamping:5.5},character:{width:1.7,height:1.7,walkFps:9,idleFps:2}};
  class Vector3{constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} set(x,y,z){this.x=x;this.y=y;this.z=z;return this;} project(cam){ const p=cam.__project(this); this.x=p.x;this.y=p.y;this.z=p.z; return this; }}
  class Vector2{constructor(x=0,y=0){this.x=x;this.y=y;}}
  class Raycaster{constructor(){this.ray={origin:new Vector3(),direction:new Vector3()};} setFromCamera(ndc,cam){ cam.__ray(ndc,this.ray); }}
  const yaw=45*Math.PI/180, pitch=50*Math.PI/180;
  const R={x:Math.cos(yaw),y:0,z:-Math.sin(yaw)}, F={x:-Math.cos(pitch)*Math.sin(yaw),y:-Math.sin(pitch),z:-Math.cos(pitch)*Math.cos(yaw)};
  const UP={x:R.y*F.z-R.z*F.y, y:R.z*F.x-R.x*F.z, z:R.x*F.y-R.y*F.x};
  const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
  window.__FAKE={calls:[], resources:{}, structures:{}, effects:[], player:null, sprite:null, loop:true, inits:0, starts:0, stops:0};
  window.HD2D={ THREE:{Vector3,Vector2,Raycaster}, terrainHeight:U.terrainHeight, DEFAULT_CONFIG:cfgDefault, resolveConfig:(o)=>{ const c=JSON.parse(JSON.stringify(cfgDefault)); if(o) for(const k of Object.keys(o)) Object.assign(c[k],o[k]); return c; },
    initializeGraphics: async (el,opts)=>{ const FK=window.__FAKE; FK.inits++; FK.opts=opts; FK.sprite=opts.playerSpriteUrl;
      const c=document.createElement("canvas"); c.style.cssText="width:100%;height:100%;background:linear-gradient(#9cc,#6a6)"; el.appendChild(c);
      const cam={ target:{x:-20,y:0.6,z:20}, getWorldDirection(v){ v.set(F.x,F.y,F.z); return v; },
        __half(){ const r=el.getBoundingClientRect(); const hh=13; return {hw:hh*(r.width/r.height||1), hh}; },
        __project(v){ const t=this.target, d={x:v.x-t.x,y:v.y-t.y,z:v.z-t.z}, h=this.__half(); return {x:dot(d,R)/h.hw, y:dot(d,UP)/h.hh, z:0.5}; },
        __ray(ndc,ray){ const t=this.target,h=this.__half(); const ox=t.x+R.x*ndc.x*h.hw+UP.x*ndc.y*h.hh-F.x*60, oy=t.y+R.y*ndc.x*h.hw+UP.y*ndc.y*h.hh-F.y*60, oz=t.z+R.z*ndc.x*h.hw+UP.z*ndc.y*h.hh-F.z*60; ray.origin.set(ox,oy,oz); ray.direction.set(F.x,F.y,F.z); } };
      return {
        getCamera:()=>cam,
        setPlayerVisualState(s){ FK.player=JSON.parse(JSON.stringify(s)); cam.target={x:s.position.x,y:U.terrainHeight(s.position.x,s.position.z,cfgDefault),z:s.position.z}; },
        setWorldVisualState(s){ FK.world=s; }, setCameraTarget(){},
        updateResourceVisual(id,s){ if(s===null) delete FK.resources[id]; else FK.resources[id]=JSON.parse(JSON.stringify(s)); },
        addStructureVisual(id,type,pos,rot){ FK.structures[id]={type,pos,rot}; }, removeStructureVisual(id){ delete FK.structures[id]; },
        playVisualEffect(t,p){ FK.effects.push(t); }, async setPlayerSpriteSheet(u){ FK.sprite=u; },
        resizeGraphics(){}, disposeGraphics(){}, stopLoop(){ FK.loop=false; FK.stops++; }, startLoop(){ FK.loop=true; FK.starts++; } };
    } };
})();
