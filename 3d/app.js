import { THREE, OrbitControls, BufferGeometryUtils, WebGLPathTracer, GradientEquirectTexture } from "./vendor.js";
import { makeTex } from "./tex.js";
/* Viewer-Konfiguration: kommt aus bauteile.xlsx (falls vorhanden), sonst aus den eingebetteten Startwerten */
const MODEL_URL="model.bin";
const XLSX_URL="bauteile.xlsx";
const fmt=(x,d=2)=>Number(x).toLocaleString("de-DE",{minimumFractionDigits:d,maximumFractionDigits:d});
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const num=v=>{if(v===""||v==null)return NaN;return typeof v==="number"?v:parseFloat(String(v).replace(",","."))};
const yes=(v,def=true)=>{const s=String(v??"").trim().toLowerCase();return s===""?def:!(s==="nein"||s==="n"||s==="0"||s==="false")};
const WIN=new Set(["fenster_eg","fenster_og","haustuer"]);

function objs(rows){if(!rows||!rows.length)return[];const h=rows[0].map(x=>String(x??"").trim());
  return rows.slice(1).filter(r=>r&&r.some(v=>v!==""&&v!=null)).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??""])));}
function cfgFromSheets(S){
  const P={};objs(S.Projekt).forEach(r=>P[String(r.Feld).trim()]=r.Wert);
  const CATS={};objs(S.Bauteile).forEach(r=>{const k=String(r["Schlüssel"]).trim();if(!k)return;
    const infos=[1,2,3].map(i=>[String(r["Info "+i]??"").trim(),typeof r["Wert "+i]==="number"?r["Wert "+i].toLocaleString("de-DE"):String(r["Wert "+i]??"").trim()]).filter(([a,b])=>a&&b);
    CATS[k]={n:String(r.Bezeichnung||k),grp:String(r.Gruppe||"Sonstiges"),d:String(r.Beschreibung||""),show:yes(r["Im Modell"]),on:yes(r["Beim Start an"]),
      click:yes(r.Anklickbar),mengen:yes(r["Maße & Mengen"]),auf:String(r.Aufbau||"").trim(),infos,win:WIN.has(k)};});
  const AUF={};objs(S.Aufbauten).forEach(r=>{const k=String(r["Schlüssel"]).trim();if(!k)return;
    AUF[k]={title:String(r.Titel||k),dir:String(r.Richtung||""),kon:String(r.Konstruktion||""),u:num(r["U-Wert W/m²K"]),phase:num(r["Phasenverschiebung h"]),
      gew:num(r["Gewicht kg/m²"]),feuchte:String(r.Feuchteschutz||""),quelle:String(r.Quelle||""),show:yes(r.Anzeigen),layers:[]};});
  objs(S.Schichten).map(r=>({a:String(r.Aufbau).trim(),pos:num(r.Pos),name:String(r.Schicht||""),d:num(r["Dicke mm"]),
      col:"#"+String(r.Farbe||"cccccc").replace("#","").trim(),vent:yes(r["Hinterlüftet"],false)}))
    .sort((x,y)=>(x.pos||0)-(y.pos||0)).forEach(l=>{if(AUF[l.a]&&l.d>=0)AUF[l.a].layers.push(l)});
  const KPI=objs(S.Kennzahlen).map(r=>({key:String(r["Schlüssel"]).trim(),label:String(r.Bezeichnung||""),show:yes(r.Anzeigen),val:String(r["Fester Wert"]??"").trim()}));
  return {P,CATS,AUF,KPI};
}
function loadConfig(){
  const fallback=()=>cfgFromSheets(JSON.parse(document.getElementById("defaults").textContent));
  if(!XLSX_URL||!window.XLSX)return Promise.resolve(fallback());
  return fetch(XLSX_URL,{cache:"no-cache"}).then(r=>{if(!r.ok)throw new Error(r.status);return r.arrayBuffer()}).then(buf=>{
    const wb=XLSX.read(buf,{type:"array"});const S={};
    wb.SheetNames.forEach(n=>S[n]=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1,defval:"",raw:true}));
    return cfgFromSheets(S);}).catch(err=>{console.warn("bauteile.xlsx nicht lesbar, nutze Startwerte:",err);return fallback();});
}
function loadModel(){
  const inl=document.getElementById("modelb64");
  if(inl)return Promise.resolve(Uint8Array.from(atob(inl.textContent.trim()),c=>c.charCodeAt(0)).buffer);
  return fetch(MODEL_URL).then(r=>{if(!r.ok)throw new Error("HTTP "+r.status);return r.arrayBuffer()});
}
const meta=JSON.parse(document.getElementById("meta").textContent);
Promise.all([loadModel(),loadConfig()]).then(([bin,cfg])=>main(bin,cfg))
  .catch(err=>{const l=document.getElementById("loading");if(l)l.textContent="Modell konnte nicht geladen werden ("+err.message+").";console.error(err)});

function main(bin,cfg){
const {P,CATS,AUF,KPI}=cfg;
if(P.Titel){document.getElementById("ptitle").textContent=P.Titel;document.title=P.Titel+" 3D";}
if(P.Untertitel!==undefined)document.getElementById("psub").textContent=P.Untertitel;
const known=k=>CATS[k]&&CATS[k].show;

/* ---------- Kennzahlen je Element ---------- */
meta.els.forEach(e=>{const b=e.bb;e.dx=b[3]-b[0];e.dy=b[4]-b[1];e.dz=b[5]-b[2];
  e.isSill=WIN.has(e.cat)&&e.dz<0.06;e.wW=Math.max(e.dx,e.dy);e.wA=e.isSill?0:e.wW*e.dz;});
const els=meta.els.filter(e=>!CATS[e.cat]||CATS[e.cat].show);
const byCat={};els.forEach(e=>(byCat[e.cat]=byCat[e.cat]||[]).push(e));
const sum=(cats,f)=>cats.flatMap(c=>byCat[c]||[]).reduce((s,e)=>s+f(e),0);
const allBy={};meta.els.forEach(e=>(allBy[e.cat]=allBy[e.cat]||[]).push(e));
const shell=allBy.aw_eg?.[0];const gfx=shell?shell.dx:meta.house[3]-meta.house[0],gfy=shell?shell.dy:meta.house[4]-meta.house[1];
const winA=["fenster_eg","fenster_og","haustuer"].flatMap(c=>allBy[c]||[]).reduce((s,e)=>s+e.wA,0);
const wallA=["aw_eg","aw_og","giebel"].flatMap(c=>allBy[c]||[]).reduce((s,e)=>s+e.area/2,0);
const lotEl=allBy.grundstueck?.[0];
const KV={grundstueck:lotEl?fmt(lotEl.dx*lotEl.dy,0)+" m²":"",grundflaeche:fmt(gfx*gfy,1)+" m²",fenster:fmt(winA,1)+" m²",aussenwand:fmt(wallA,0)+" m²",
  fensteranteil:fmt(winA/(wallA+winA)*100,0)+" %",clt:fmt((allBy.decke||[]).reduce((s,e)=>s+e.vol,0),1)+" m³",pv:(allBy.pv||[]).length+" Module"};
document.getElementById("kpis").innerHTML=KPI.filter(k=>k.show&&(k.val||KV[k.key])).map(k=>`<div class="kpi"><span>${esc(k.label)}</span><b>${esc(k.val||KV[k.key])}</b></div>`).join("");

/* ---------- three.js Szene (realistischer Look) ---------- */
const canvas=document.getElementById("c"),stage=document.getElementById("stage");
const MOBILE=matchMedia("(max-width:760px), (pointer:coarse)").matches;
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:"high-performance"});
renderer.setPixelRatio(Math.min(devicePixelRatio,MOBILE?1.5:2));
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.0;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.localClippingEnabled=true;
const cutPlane=new THREE.Plane(new THREE.Vector3(0,-1,0),99);const CLIP=[cutPlane];
const scene=new THREE.Scene();
const cam=new THREE.PerspectiveCamera(30,1,0.1,800);
const controls=new OrbitControls(cam,canvas);
controls.enableDamping=true;controls.dampingFactor=.12;controls.maxPolarAngle=Math.PI*.495;controls.minDistance=1.5;controls.maxDistance=160;controls.screenSpacePanning=true;

/* Himmel + Umgebungslicht (auch für den Foto-Modus) */
const sky=new GradientEquirectTexture(512);
sky.topColor.set(0x5d8fc9);sky.bottomColor.set(0xe9eef0);sky.exponent=2.4;sky.update();
scene.background=sky;
const pmrem=new THREE.PMREMGenerator(renderer);
scene.environment=pmrem.fromEquirectangular(sky).texture;scene.environmentIntensity=.9;
scene.fog=new THREE.Fog(0xdfe7ec,70,190);
const sun=new THREE.DirectionalLight(0xfff1dc,3.2);sun.position.set(18,26,12);
sun.castShadow=true;sun.shadow.mapSize.set(MOBILE?2048:4096,MOBILE?2048:4096);
sun.shadow.bias=-0.0004;sun.shadow.normalBias=0.025;scene.add(sun,sun.target);
const ANISO=renderer.capabilities.getMaxAnisotropy(),TEXSIZE=MOBILE?512:1024;
/* Wiese rund um das Grundstück */
const groundMat=new THREE.MeshStandardMaterial({color:0x8a9a68,roughness:1});
{const t=makeTex("lawn","#000",TEXSIZE,ANISO);groundMat.map=t.map.clone();groundMat.map.repeat.set(1/5,1/5);groundMat.map.needsUpdate=true;groundMat.color.set(0x98a283);}
const ground=new THREE.Mesh(new THREE.CircleGeometry(160,64).toNonIndexed(),groundMat);ground.rotation.x=-Math.PI/2;ground.position.y=-0.03;ground.receiveShadow=true;scene.add(ground);
{const p=ground.geometry.attributes.position,uv=new Float32Array(p.count*2);for(let i=0;i<p.count;i++){uv[i*2]=p.getX(i);uv[i*2+1]=p.getY(i);}ground.geometry.setAttribute("uv",new THREE.BufferAttribute(uv,2));}

const SECTION={aw_eg:0xd9a54f,aw_og:0xd9a54f,giebel:0xd9a54f,dach:0xd9a54f,fassade:0x8a6a45,decke:0xa18157,boden_og:0xcfcac2,bodenplatte:0x9b968c,iw_eg:0xe3c48a,iw_og:0xe3c48a};
const NOEDGE=new Set(["rinne","leuchte","haustuer","pv","grundstueck","terrasse","fassade","dach"]);
const FLATMERGE=new Set(["terrasse","grundstueck","garderobe","rinne"]);
const meshes=[],catColor={};
const edgeMat=new THREE.LineBasicMaterial({color:0x2a3338,transparent:true,opacity:.14,clippingPlanes:CLIP});
const HL=new THREE.MeshStandardMaterial({color:0x3fbf7f,emissive:0x1d6b45,roughness:.7,side:THREE.DoubleSide,clippingPlanes:CLIP,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
const HLF=HL.clone();HLF.side=THREE.FrontSide;HLF.clippingPlanes=CLIP;
const lum=h=>{const c=new THREE.Color(h);return .3*c.r+.59*c.g+.11*c.b};
const brownish=h=>{const c=new THREE.Color(h);return c.r>c.g&&c.g>=c.b&&c.r-c.b>.08};
/* Material je Bauteilkategorie und Farbgruppe aus der IFC */
const matCache={};
function mat(cat,hex,op){
  let kind="std";
  if(op<1)kind="glass";
  else if(cat==="fassade")kind="facade";
  else if(cat==="dach"&&lum(hex)<.15)kind="seam";
  else if(cat==="terrasse")kind=brownish(hex)?"deck":"fence";
  else if(cat==="grundstueck")kind="lawn";
  else if((cat==="bodenplatte"||cat==="boden_og")&&brownish(hex))kind="parquet";
  else if(cat==="pv"&&lum(hex)<.35)kind="pv";
  else if(cat==="rinne"||cat==="fallrohr"||cat==="leuchte")kind="metal";
  const k=kind+hex+op;if(matCache[k])return matCache[k];
  let m;
  if(kind==="glass")m=new THREE.MeshPhysicalMaterial({color:0xeef4f6,roughness:.03,metalness:0,transmission:1,thickness:.01,ior:1.5,side:THREE.DoubleSide});
  else if(kind==="metal")m=new THREE.MeshStandardMaterial({color:hex,roughness:.35,metalness:.7,side:THREE.DoubleSide});
  else if(kind!=="std"){const t=makeTex(kind,hex,TEXSIZE,ANISO);
    m=new THREE.MeshStandardMaterial({color:kind==="lawn"?0xbcc4a8:0xffffff,map:t.map,normalMap:t.normalMap,roughness:t.rough,metalness:t.metal,side:THREE.DoubleSide});
    if(t.normalMap)m.normalScale.set(.8,.8);}
  else m=new THREE.MeshStandardMaterial({color:hex,roughness:lum(hex)>.85?.92:.8,metalness:0,side:THREE.DoubleSide});
  m.clippingPlanes=CLIP;m.userData.kind=kind;m.polygonOffset=true;m.polygonOffsetFactor=1;m.polygonOffsetUnits=1;
  return matCache[k]=m;
}
/* Box-Projektion: UV in Metern aus der Flächenausrichtung */
function boxUV(g){const p=g.attributes.position,uv=new Float32Array(p.count*2),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),n=new THREE.Vector3();
  for(let i=0;i<p.count;i+=3){a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);n.subVectors(c,b).cross(a.clone().sub(b));
    const ax=Math.abs(n.x),ay=Math.abs(n.y),az=Math.abs(n.z);
    for(let j=0;j<3;j++){const x=p.getX(i+j),y=p.getY(i+j),z=p.getZ(i+j);let u,v;
      if(ay>=ax&&ay>=az){u=x;v=z}else if(ax>=az){u=z;v=y}else{u=x;v=y}uv[(i+j)*2]=u;uv[(i+j)*2+1]=v;}}
  g.setAttribute("uv",new THREE.BufferAttribute(uv,2));}
function keepGroups(src,dst){dst.clearGroups();src.groups.forEach(x=>dst.addGroup(x.start,x.count,x.materialIndex));return dst}
for(const e of els){
  const q16=new Int16Array(bin,e.p[0],e.p[1]*3),pos=new Float32Array(q16.length);for(let j=0;j<q16.length;j++)pos[j]=q16[j]*meta.q;
  const idx=e.i[2]===4?new Uint32Array(bin,e.i[0],e.i[1]):new Uint16Array(bin,e.i[0],e.i[1]);
  let g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.BufferAttribute(pos,3));g.setIndex(new THREE.BufferAttribute(idx,1));
  e.g.forEach((gr,k)=>g.addGroup(gr[0],gr[1],k));
  const smooth=e.merged&&!FLATMERGE.has(e.cat);
  g=smooth?keepGroups(g,BufferGeometryUtils.toCreasedNormals(g,Math.PI/5)):keepGroups(g,g.toNonIndexed());
  if(!smooth)g.computeVertexNormals();
  boxUV(g);
  const mats=e.g.map(gr=>mat(e.cat,gr[2],gr[3]));
  const m=new THREE.Mesh(g,mats);m.userData.el=e;m.userData.base=mats;m.userData.ptMats=mats;
  m.castShadow=e.cat!=="grundstueck";m.receiveShadow=true;
  const sec=SECTION[e.cat];
  if(sec!==undefined){const back=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:sec,side:THREE.BackSide,clippingPlanes:CLIP}));back.raycast=()=>{};back.userData.cap=true;m.add(back);
    m.userData.base=mats.map(x=>{const y=x.clone();y.side=THREE.FrontSide;y.clippingPlanes=CLIP;return y});m.material=m.userData.base;m.userData.hl=HLF;}
  if(!NOEDGE.has(e.cat)&&!e.merged&&e.i[1]<6000){const ed=new THREE.LineSegments(new THREE.EdgesGeometry(g,25),edgeMat);ed.raycast=()=>{};ed.userData.cap=true;m.add(ed);}
  const big=e.g.reduce((a,b)=>b[1]>a[1]?b:a);catColor[e.cat]=catColor[e.cat]||big[2];
  scene.add(m);meshes.push(m);
}
catColor.fenster_eg=catColor.fenster_og="#9fb8cc";
document.getElementById("loading").remove();

/* ---------- Kamera: immer perspektivisch ---------- */
const box=new THREE.Box3();meshes.forEach(m=>box.expandByObject(m));const bsz=box.getSize(new THREE.Vector3());
const ctr=box.getCenter(new THREE.Vector3());ctr.y=2.6;
{const r=Math.max(bsz.x,bsz.z)*.62;const sc=sun.shadow.camera;sc.left=-r;sc.right=r;sc.top=r;sc.bottom=-r;sc.near=1;sc.far=90;
 sun.target.position.set(ctr.x,0,ctr.z);sun.position.set(ctr.x+18,26,ctr.z+12);sc.updateProjectionMatrix();}
let az=-Math.PI/4,anim=null,viewDist=40;
const ELEV=.4;function viewPos(a,r){return new THREE.Vector3(ctr.x+r*Math.sin(a)*Math.cos(ELEV),ctr.y+r*Math.sin(ELEV),ctr.z+r*Math.cos(a)*Math.cos(ELEV))}
function setView(a,instant){az=a;const p=viewPos(az,viewDist);
  if(instant){cam.position.copy(p);controls.target.copy(ctr);controls.update();}else anim={from:cam.position.clone(),to:p,tFrom:controls.target.clone(),t:0};}
function resize(){const w=stage.clientWidth,h=stage.clientHeight;renderer.setSize(w,h,false);const asp=w/h;
  const ext=(bsz.x+bsz.z)*0.3536*(w<760?1.0:1.12);const vs=Math.max(ext/asp,ext*0.66);
  cam.aspect=asp;cam.updateProjectionMatrix();viewDist=vs/Math.tan(THREE.MathUtils.degToRad(15))*1.02;if(photo&&pt)pt.updateCamera();}
let photo=false,pt=null;
addEventListener("resize",resize);resize();setView(az,true);
document.getElementById("rotL").onclick=()=>setView(az-Math.PI/2);
document.getElementById("rotR").onclick=()=>setView(az+Math.PI/2);
document.getElementById("reset").onclick=()=>{setView(-Math.PI/4);setCut(99);};
/* ---------- Schnitthöhe ---------- */
const catOn={};Object.keys(byCat).forEach(k=>catOn[k]=CATS[k]?CATS[k].on:true);
const cutH=document.getElementById("cutH"),cutV=document.getElementById("cutV");
function setCut(h){cutPlane.constant=h;const off=h>7.3;cutH.value=off?7.4:h;cutV.textContent=off?"aus":fmt(h,2)+" m";
  document.querySelectorAll("[data-cut]").forEach(b=>b.classList.toggle("on",Math.abs(+b.dataset.cut-h)<.01));
  meshes.forEach(m=>m.visible=catOn[m.userData.el.cat]&&m.userData.el.bb[2]<h);photoDirty();}
cutH.oninput=()=>{const v=+cutH.value;setCut(v>=7.4?99:v)};
document.querySelectorAll("[data-cut]").forEach(b=>b.onclick=()=>setCut(+b.dataset.cut));

/* ---------- Foto-Modus: Path-Tracing ---------- */
const fBtn=document.getElementById("photo"),pBar=document.getElementById("pbar"),pText=document.getElementById("ptext"),pSave=document.getElementById("psave");
const PT_MAX=MOBILE?120:400;let ptScene=null,camMoved=false,saveReq=false,ptStart=0;
if(!window.ALLOW_SAVE)pSave.hidden=true;
controls.addEventListener("change",()=>{camMoved=true;});
/* Foto-Szene: je Material ein zusammengefasstes Netz, an der Schnitthöhe abgeschnitten (Path-Tracer kennt keine Clipping-Ebenen) */
function buildPTScene(){
  if(ptScene)ptScene.traverse(o=>{if(o.isMesh&&o.userData.tmp)o.geometry.dispose();});
  const s=new THREE.Scene();s.background=sky;s.environment=sky;s.environmentIntensity=scene.environmentIntensity;
  const l=sun.clone();const tg=sun.target.clone();l.target=tg;s.add(l,tg);
  const h=cutPlane.constant,clip=h<90,buckets=new Map();
  const bucket=m=>{let b=buckets.get(m);if(!b){b={p:[],n:[],u:[]};buckets.set(m,b);}return b;};
  const A=[0,0,0,0,0,0,0,0],B=[0,0,0,0,0,0,0,0],C=[0,0,0,0,0,0,0,0];
  const rd=(P,N,U,i,o)=>{o[0]=P.getX(i);o[1]=P.getY(i);o[2]=P.getZ(i);o[3]=N.getX(i);o[4]=N.getY(i);o[5]=N.getZ(i);o[6]=U.getX(i);o[7]=U.getY(i);return o;};
  const put=(b,v)=>{b.p.push(v[0],v[1],v[2]);b.n.push(v[3],v[4],v[5]);b.u.push(v[6],v[7]);};
  const lerp=(a,c,t)=>a.map((x,k)=>x+(c[k]-x)*t);
  const addMesh=(geom,mats,doClip)=>{const P=geom.attributes.position,N=geom.attributes.normal,U=geom.attributes.uv;
    const groups=geom.groups.length?geom.groups:[{start:0,count:P.count,materialIndex:0}];
    for(const gr of groups){const mat=Array.isArray(mats)?mats[gr.materialIndex]:mats;if(!mat)continue;const b=bucket(mat);
      for(let i=gr.start;i<gr.start+gr.count;i+=3){rd(P,N,U,i,A);rd(P,N,U,i+1,B);rd(P,N,U,i+2,C);
        if(!doClip||(A[1]<=h&&B[1]<=h&&C[1]<=h)){put(b,A);put(b,B);put(b,C);continue;}
        const t=[A.slice(),B.slice(),C.slice()],ins=t.map(v=>v[1]<=h);if(!ins.some(Boolean))continue;
        const poly=[];for(let j=0;j<3;j++){const a=t[j],c=t[(j+1)%3];if(ins[j])poly.push(a);if(ins[j]!==ins[(j+1)%3])poly.push(lerp(a,c,(h-a[1])/(c[1]-a[1])));}
        for(let j=1;j+1<poly.length;j++){put(b,poly[0]);put(b,poly[j]);put(b,poly[j+1]);}}}};
  addMesh(ground.geometry.clone().applyMatrix4(ground.matrixWorld),groundMat,false);
  for(const m of meshes){if(!m.visible)continue;addMesh(m.geometry,m.userData.ptMats,clip&&m.userData.el.bb[5]>h);}
  for(const [mat,b] of buckets){if(!b.p.length)continue;const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(b.p,3));g.setAttribute("normal",new THREE.Float32BufferAttribute(b.n,3));g.setAttribute("uv",new THREE.Float32BufferAttribute(b.u,2));
    const mm=new THREE.Mesh(g,mat);mm.userData.tmp=true;s.add(mm);}
  return s;}
function setPBar(t){pText.textContent=t;}
function startPhoto(){
  if(measuring)setMeasuring(false);select(null,null);
  photo=true;fBtn.classList.add("on");fBtn.setAttribute("aria-pressed","true");pBar.hidden=false;setPBar("Foto wird vorbereitet …");
  setTimeout(()=>{if(!photo)return;
    try{
      if(!pt){pt=new WebGLPathTracer(renderer);pt.tiles.set(MOBILE?3:2,MOBILE?3:2);pt.renderScale=MOBILE?.6:Math.min(1,1.5/renderer.getPixelRatio());
        pt.minSamples=2;pt.fadeDuration=250;pt.renderDelay=60;pt.bounces=6;pt.filteredGlossyFactor=.5;pt.dynamicLowRes=true;pt.lowResScale=.25;}
      ptScene=buildPTScene();pt.setScene(ptScene,cam);ptStart=performance.now();camMoved=false;
    }catch(err){console.error(err);stopPhoto();setPBar("");alertBar("Der Foto-Modus wird von diesem Gerät nicht unterstützt.");}
  },40);}
function stopPhoto(){photo=false;fBtn.classList.remove("on");fBtn.setAttribute("aria-pressed","false");pBar.hidden=true;}
function photoDirty(){if(photo&&pt){ptScene=buildPTScene();pt.setScene(ptScene,cam);}}
function alertBar(t){const b=document.getElementById("hint")||document.createElement("div");b.id="hint";b.textContent=t;b.style.display="block";stage.appendChild(b);setTimeout(()=>b.remove(),4000);}
fBtn.onclick=()=>photo?stopPhoto():startPhoto();
document.getElementById("pdone").onclick=stopPhoto;
pSave.onclick=()=>{saveReq=true;};
function photoFrame(){
  if(!ptScene){renderer.render(scene,cam);return;}
  if(camMoved){pt.updateCamera();camMoved=false;}
  if(pt.samples<PT_MAX)pt.renderSample();
  else if(saveReq){pt.renderSample();}
  const n=Math.floor(pt.samples);
  setPBar(n<PT_MAX?`Foto wird berechnet · ${n} von ${PT_MAX} Durchläufen · Kamera still halten`:`Foto fertig · ${PT_MAX} Durchläufe`);
  if(saveReq){saveReq=false;canvas.toBlob(b=>{if(!b)return;const a=document.createElement("a");a.href=URL.createObjectURL(b);
    a.download=(document.getElementById("ptitle").textContent||"haus").replace(/[^\wäöüß-]+/gi,"_")+"_foto.png";document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},2000);},"image/png");}
}
/* ---------- Bauteilliste (Reihenfolge wie in der Excel) ---------- */
const catsEl=document.getElementById("cats");let lastGrp="";
const order=[...Object.keys(CATS).filter(k=>byCat[k]),...Object.keys(byCat).filter(k=>!CATS[k])];
for(const k of order){const c=CATS[k]||{n:k,grp:"Sonstiges"};
  if(c.grp!==lastGrp){catsEl.insertAdjacentHTML("beforeend",`<div class="grp">${esc(c.grp)}</div>`);lastGrp=c.grp;}
  const n=byCat[k][0].merged?byCat[k][0].objs:(c.win?byCat[k].filter(e=>!e.isSill).length:byCat[k].length);
  const sw=SECTION[k]!==undefined&&/^#(f|e)/i.test(catColor[k]||"")?"#"+SECTION[k].toString(16).padStart(6,"0"):(catColor[k]||"#ccc");
  catsEl.insertAdjacentHTML("beforeend",`<div class="cat" tabindex="0" data-k="${k}"><input type="checkbox" ${catOn[k]?"checked":""} id="cb_${k}" aria-label="${esc(c.n)} anzeigen"><span class="sw" style="background:${sw}"></span><span>${esc(c.n)}</span><span class="n">${n}</span></div>`);}
catsEl.addEventListener("click",ev=>{const row=ev.target.closest(".cat");if(!row)return;const k=row.dataset.k;
  if(ev.target.tagName==="INPUT"){catOn[k]=ev.target.checked;setCut(cutPlane.constant);return;}select(null,k);});
catsEl.addEventListener("keydown",ev=>{if(ev.key==="Enter"){const row=ev.target.closest(".cat");if(row)select(null,row.dataset.k);}});
{const lt=document.getElementById("legendToggle"),lg=document.getElementById("legend");lt.onclick=()=>{const o=lg.classList.toggle("open");lt.setAttribute("aria-expanded",o);};}

/* ---------- Auswahl + Infokarte ---------- */

let selected=[];
function select(el,catKey){
  selected.forEach(m=>m.material=m.userData.base);selected=[];
  const k=catKey||el?.cat;document.querySelectorAll(".cat").forEach(r=>r.classList.toggle("sel",r.dataset.k===k));
  if(!k){document.getElementById("info").hidden=true;return;}
  meshes.forEach(m=>{const e=m.userData.el;if(el?e===el:e.cat===k){m.material=m.userData.hl||HL;selected.push(m);}});
  renderInfo(el,k);}
function svgCut(a){const W=300,H=70;const vis=a.layers.map(l=>Math.max(l.d,3));const tot=vis.reduce((s,d)=>s+d,0);let x=0;
  const rects=a.layers.map((l,i)=>{const w=vis[i]/tot*W;const r=`<rect x="${x.toFixed(1)}" y="8" width="${w.toFixed(1)}" height="${H-16}" fill="${esc(l.col)}" stroke="rgba(0,0,0,.25)" stroke-width=".6"/>`+(l.vent?`<rect x="${x.toFixed(1)}" y="8" width="${w.toFixed(1)}" height="${H-16}" fill="url(#hatch)"/>`:"");x+=w;return r}).join("");
  return `<svg class="cut" viewBox="0 0 ${W} ${H}" role="img" aria-label="Schnitt ${esc(a.title)}"><defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="rgba(0,0,0,.25)" stroke-width="1.4"/></pattern></defs>${rects}</svg>`;}
const AREA=new Set(["aw_eg","aw_og","giebel","iw_eg","iw_og","decke","boden_og","dach","bodenplatte","fassade"]);
const dl=a=>a.length?`<dl class="facts">${a.map(([x,y])=>`<dt>${esc(x)}</dt><dd>${esc(y)}</dd>`).join("")}</dl>`:"";
function renderInfo(el,k){
  const c=CATS[k]||{n:k,d:"",mengen:true,infos:[]},list=byCat[k]||[];const info=document.getElementById("info");info.hidden=false;
  const one=el&&!el.merged?el:(list.length===1&&!list[0].merged?list[0]:null);
  const mg=list.find(e=>e.merged);
  let html=`<div class="ititle">${esc(c.n)}${el&&list.length>1&&!el.merged&&!el.isSill?" · Einzelteil":""}</div><p class="isub">${esc(c.d)}</p>`;
  if(c.infos&&c.infos.length&&!(el&&el.isSill))html+=dl(c.infos.map(([a,b])=>[String(a),String(b)]));
  if(c.mengen){
    let facts=[];
    if(mg){facts.push(["Objekte",mg.objs+""],["Bereich (L × B)",fmt(mg.dx,1)+" × "+fmt(mg.dy,1)+" m"]);if(k==="terrasse")facts.push(["Fläche ca.",fmt(mg.dx*mg.dy,0)+" m² (Umriss)"]);}
    if(k==="grundstueck"&&list[0])facts.push(["Abmessung",fmt(list[0].dx,2)+" × "+fmt(list[0].dy,2)+" m"],["Fläche",fmt(list[0].dx*list[0].dy,1)+" m²"]);
    if(one&&k!=="grundstueck"){const e=one;
      if(c.win){facts.push(["Breite × Höhe",fmt(e.wW,2)+" × "+fmt(e.dz,2)+" m"]);if(e.isSill)facts.push(["Bauteil","Außenfensterbank"]);else facts.push(["Fläche",fmt(e.wA,2)+" m²"]);}
      else{facts.push(["Abmessung (L × B × H)",[e.dx,e.dy,e.dz].map(v=>fmt(v,2)).join(" × ")+" m"]);
        if(AREA.has(k))facts.push(["Bauteilfläche (eine Seite)",fmt(e.area/2,1)+" m²"]);
        if(e.vol>0.001)facts.push(["Volumen",fmt(e.vol,2)+" m³"]);}
      facts.push(["Unterkante / Oberkante",fmt(e.bb[2],2)+" / "+fmt(e.bb[5],2)+" m"]);}
    if(facts.length)html+=`<div class="sec">${one&&el&&list.length>1?"Dieses Bauteil":"Aus dem Modell"}</div>`+dl(facts);
    let total=[];
    if(list.length>1&&!mg){const real=list.filter(e=>!e.isSill);
      total.push(["Anzahl",c.win?real.length+" Stück":list.length+" Elemente"]);
      if(c.win)total.push(["Fläche gesamt",fmt(real.reduce((s,e)=>s+e.wA,0),2)+" m²"]);
      else if(AREA.has(k))total.push(["Fläche gesamt (eine Seite)",fmt(list.reduce((s,e)=>s+e.area/2,0),1)+" m²"]);
      if(k==="decke")total.push(["CLT-Volumen",fmt(list.reduce((s,e)=>s+e.vol,0),2)+" m³"]);
      if(k==="pv")total.push(["Modulgröße","1,76 × 1,13 m"],["Modulfläche",fmt(list.length*1.76*1.13,1)+" m²"]);
      if(k==="rinne"||k==="fallrohr")total.push(["Länge ca.",fmt(list.reduce((s,e)=>s+Math.max(e.dx,e.dy,k==="fallrohr"?e.dz:0),0),1)+" m"]);}
    if(total.length)html+=`<div class="sec">Alle ${esc(c.n)}</div>`+dl(total);
  }
  const a=AUF[c.auf];
  if(a&&a.show&&a.layers.length){const tot=a.layers.reduce((s,l)=>s+(l.d||0),0);
    html+=`<div class="sec">Schichtaufbau</div><div class="note" style="margin:0 0 4px">${esc(a.title)}${a.dir?", "+esc(a.dir):""}, gesamt ${fmt(tot/10,1)} cm</div>`+svgCut(a);
    html+=`<div class="layers">${a.layers.map(l=>`<div class="layer${l.vent?" vent":""}"><i style="background:${esc(l.col)}"></i><span>${esc(l.name)}</span><span class="d">${l.d<1?"Folie":fmt(l.d,l.d%1?1:0)+" mm"}</span></div>`).join("")}</div>`;
    const kv=[];if(a.kon)kv.push(["Konstruktion",a.kon]);if(!isNaN(a.phase))kv.push(["Phasenverschiebung",fmt(a.phase,1)+" h"]);
    if(!isNaN(a.gew))kv.push(["Flächengewicht",fmt(a.gew,0)+" kg/m²"]);if(a.feuchte)kv.push(["Feuchteschutz",a.feuchte]);
    if(!isNaN(a.u))html+=`<div class="uval"><span>U-Wert${a.quelle?`<small>${esc(a.quelle)}</small>`:""}</span><b>${fmt(a.u,3)} W/m²K</b></div>`;
    if(kv.length)html+=`<div style="margin-top:10px">${dl(kv)}</div>`;
    if(isNaN(a.u)&&a.quelle)html+=`<p class="note">Quelle: ${esc(a.quelle)}</p>`;
    if(a.layers.some(l=>l.vent))html+=`<p class="note">Schraffierte Schichten sind hinterlüftet und nicht wärmewirksam.</p>`;}
  document.getElementById("infoBody").innerHTML=html;info.scrollTop=0;}
document.getElementById("infoClose").onclick=()=>select(null,null);

/* ---------- Picking ---------- */
const ray=new THREE.Raycaster(),ptr=new THREE.Vector2(),tip=document.getElementById("tip");
const clickable=e=>!CATS[e.cat]||CATS[e.cat].click;
function pick(ev){const r=canvas.getBoundingClientRect();ptr.x=(ev.clientX-r.left)/r.width*2-1;ptr.y=-(ev.clientY-r.top)/r.height*2+1;
  ray.setFromCamera(ptr,cam);const hits=ray.intersectObjects(meshes.filter(m=>m.visible),false);
  const h=hits.find(h=>h.point.y<=cutPlane.constant+1e-3);return h&&clickable(h.object.userData.el)?h:null;}
let down=null;
canvas.addEventListener("pointerdown",e=>down={x:e.clientX,y:e.clientY});
canvas.addEventListener("pointerup",e=>{if(!down)return;const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y)>5;down=null;if(moved)return;
  if(measuring){measureClick(e);return;}
  const h=pick(e);if(h)select(h.object.userData.el);else select(null,null);});
canvas.addEventListener("pointermove",e=>{if(e.pointerType!=="mouse"||e.buttons)return;if(measuring){measureHover(e);return;}const h=pick(e);canvas.classList.toggle("hov",!!h);
  if(h){const el=h.object.userData.el;tip.hidden=false;tip.textContent=(CATS[el.cat]?.n||el.cat)+(el.isSill?" · Fensterbank":"");
    const r=stage.getBoundingClientRect();tip.style.left=(e.clientX-r.left)+"px";tip.style.top=(e.clientY-r.top)+"px";}else tip.hidden=true;});
canvas.addEventListener("pointerleave",()=>tip.hidden=true);
canvas.addEventListener("pointerdown",()=>document.getElementById("hint")?.remove(),{once:true});
/* ---------- Messen ---------- */
const mBtn=document.getElementById("measure"),mBar=document.getElementById("mbar"),mText=document.getElementById("mtext"),labelsEl=document.getElementById("mlabels");
const MCOL=0xd9532b;let measuring=false,mStart=null,liveLabel=null;const measures=[];
const mLineMat=new THREE.LineBasicMaterial({color:MCOL,depthTest:false,transparent:true});
const mPtMat=new THREE.PointsMaterial({color:MCOL,size:9,sizeAttenuation:false,depthTest:false,transparent:true});
function ptsObj(arr,mat){const o=new THREE.Points(new THREE.BufferGeometry().setFromPoints(arr),mat);o.renderOrder=999;o.frustumCulled=false;return o}
const cursorMat=new THREE.PointsMaterial({color:MCOL,size:11,sizeAttenuation:false,depthTest:false,transparent:true,opacity:.55});
const cursorPt=ptsObj([new THREE.Vector3()],cursorMat);cursorPt.visible=false;scene.add(cursorPt);
const startPt=ptsObj([new THREE.Vector3()],mPtMat);startPt.visible=false;scene.add(startPt);
const rubber=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]),new THREE.LineDashedMaterial({color:MCOL,dashSize:.12,gapSize:.08,depthTest:false,transparent:true}));
rubber.renderOrder=999;rubber.frustumCulled=false;rubber.visible=false;scene.add(rubber);
function mPoint(ev){const r=canvas.getBoundingClientRect();ptr.x=(ev.clientX-r.left)/r.width*2-1;ptr.y=-(ev.clientY-r.top)/r.height*2+1;
  ray.setFromCamera(ptr,cam);const h=ray.intersectObjects(meshes.filter(m=>m.visible),false).find(h=>h.point.y<=cutPlane.constant+1e-3);if(!h)return null;
  let p=h.point.clone(),snap=false;
  if(h.face){const pos=h.object.geometry.attributes.position;let best=12;
    for(const i of [h.face.a,h.face.b,h.face.c]){const v=new THREE.Vector3().fromBufferAttribute(pos,i);const s=v.clone().project(cam);
      const d=Math.hypot((s.x+1)/2*r.width-(ev.clientX-r.left),(1-s.y)/2*r.height-(ev.clientY-r.top));if(d<best){best=d;p=v;snap=true;}}}
  return {p,snap};}
function mLabelHtml(a,b){const d=a.distanceTo(b),dv=Math.abs(b.y-a.y),dh=Math.hypot(b.x-a.x,b.z-a.z);
  return `${fmt(d,2)} m`+(dv>.02&&dh>.02?`<small>waagerecht ${fmt(dh,2)} · senkrecht ${fmt(dv,2)}</small>`:"");}
function mkLabel(cls){const d=document.createElement("div");d.className="mlabel"+(cls?" "+cls:"");labelsEl.appendChild(d);return d}
function updBar(){mText.textContent=mStart?"Zweiten Punkt anklicken":(measures.length?measures.length+(measures.length>1?" Messungen":" Messung")+" · nächsten Punkt anklicken":"Ersten Punkt anklicken (Ecken rasten ein)");
  document.getElementById("mclear").hidden=!measures.length&&!mStart;}
function measureClick(e){const m=mPoint(e);if(!m)return;
  if(!mStart){mStart=m.p;startPt.geometry.setFromPoints([m.p]);startPt.visible=true;}
  else{const a=mStart,b=m.p;const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([a,b]),mLineMat);line.renderOrder=999;line.frustumCulled=false;
    const pts=ptsObj([a,b],mPtMat);scene.add(line,pts);const lab=mkLabel();lab.innerHTML=mLabelHtml(a,b);measures.push({a,b,line,pts,lab});
    mStart=null;startPt.visible=false;rubber.visible=false;if(liveLabel){liveLabel.remove();liveLabel=null;}}
  updBar();}
function measureHover(e){const m=mPoint(e);cursorPt.visible=!!m;if(!m){return;}
  cursorPt.geometry.setFromPoints([m.p]);cursorMat.size=m.snap?15:11;cursorMat.opacity=m.snap?.9:.55;
  if(mStart){rubber.geometry.setFromPoints([mStart,m.p]);rubber.computeLineDistances();rubber.visible=true;
    if(!liveLabel)liveLabel=mkLabel("live");liveLabel.innerHTML=mLabelHtml(mStart,m.p);liveLabel._a=mStart;liveLabel._b=m.p;}}
function clearMeasures(){measures.forEach(m=>{scene.remove(m.line,m.pts);m.line.geometry.dispose();m.pts.geometry.dispose();m.lab.remove();});measures.length=0;
  mStart=null;startPt.visible=false;rubber.visible=false;if(liveLabel){liveLabel.remove();liveLabel=null;}updBar();}
function setMeasuring(on){if(on&&photo)stopPhoto();measuring=on;mBtn.classList.toggle("on",on);mBtn.setAttribute("aria-pressed",on);mBar.hidden=!on;canvas.classList.toggle("measure",on);
  cursorPt.visible=false;tip.hidden=true;document.getElementById("hint")?.remove();
  if(on){select(null,null);updBar();}else{mStart=null;startPt.visible=false;rubber.visible=false;if(liveLabel){liveLabel.remove();liveLabel=null;}}}
mBtn.onclick=()=>setMeasuring(!measuring);
document.getElementById("mdone").onclick=()=>setMeasuring(false);
document.getElementById("mclear").onclick=clearMeasures;
addEventListener("keydown",e=>{if(e.key!=="Escape"||!measuring)return;if(mStart){mStart=null;startPt.visible=false;rubber.visible=false;if(liveLabel){liveLabel.remove();liveLabel=null;}updBar();}else setMeasuring(false);});
const _mv=new THREE.Vector3();
function placeLabels(){const w=canvas.clientWidth,h=canvas.clientHeight;
  const put=(el,a,b)=>{_mv.copy(a).add(b).multiplyScalar(.5).project(cam);const vis=_mv.z<1&&_mv.z>-1;el.style.display=vis?"":"none";
    if(vis){el.style.left=((_mv.x+1)/2*w)+"px";el.style.top=((1-_mv.y)/2*h)+"px";}};
  measures.forEach(m=>put(m.lab,m.a,m.b));if(liveLabel&&liveLabel._a)put(liveLabel,liveLabel._a,liveLabel._b);}
/* ---------- Vollbild ---------- */
{const fsBtn=document.getElementById("fs"),root=document.documentElement;
 const req=root.requestFullscreen||root.webkitRequestFullscreen,exit=document.exitFullscreen||document.webkitExitFullscreen;
 const cur=()=>document.fullscreenElement||document.webkitFullscreenElement;
 const can=!!(req&&(document.fullscreenEnabled||document.webkitFullscreenEnabled));
 const inFrame=(()=>{try{return window.self!==window.top}catch(e){return true}})();
 if(can||inFrame){fsBtn.hidden=false;
   fsBtn.onclick=()=>{
     if(can){if(cur()){exit&&exit.call(document);}else{try{const r=req.call(root);if(r&&r.catch)r.catch(()=>{if(inFrame)window.open(location.href,"_blank");});}catch(e){if(inFrame)window.open(location.href,"_blank");}}}
     else window.open(location.href,"_blank");};
   const upd=()=>{const on=!!cur();fsBtn.textContent=on?"Vollbild beenden":"Vollbild";fsBtn.classList.toggle("on",on);setTimeout(resize,60);};
   document.addEventListener("fullscreenchange",upd);document.addEventListener("webkitfullscreenchange",upd);}}
window.__v={meshes,cam,controls,setCut,get pt(){return pt},startPhoto,stopPhoto};

/* ---------- Loop ---------- */
setCut(99);
const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
function loop(){requestAnimationFrame(loop);
  if(anim){anim.t=Math.min(1,anim.t+(reduce?1:.07));const t=1-Math.pow(1-anim.t,3);
    const a=Math.atan2(anim.from.x-ctr.x,anim.from.z-ctr.z),b=Math.atan2(anim.to.x-ctr.x,anim.to.z-ctr.z);
    let d=b-a;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;const ang=a+d*t;
    const rh=Math.hypot(anim.from.x-ctr.x,anim.from.z-ctr.z)*(1-t)+Math.hypot(anim.to.x-ctr.x,anim.to.z-ctr.z)*t;
    cam.position.set(ctr.x+rh*Math.sin(ang),anim.from.y+(anim.to.y-anim.from.y)*t,ctr.z+rh*Math.cos(ang));
    controls.target.lerpVectors(anim.tFrom,ctr,t);if(anim.t>=1)anim=null;}
  controls.update();
  if(photo)photoFrame();else renderer.render(scene,cam);
  if(!photo&&(measures.length||liveLabel))placeLabels();
  labelsEl.style.visibility=photo?"hidden":"";}
loop();
}
