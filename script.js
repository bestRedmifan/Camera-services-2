const DB_NAME="BarmaanCameraDB",DB_VERSION=1,STORE_NAME="media";
let db=null,stream=null,facingMode="environment",mode="photo",zoom=1,recorder=null,chunks=[],recording=false,selectedId=null,photoEditId=null,videoEditId=null,drawing=false,drawEnabled=false,videoURL=null;
let rotateLock=false,lookEyes=false,lookEyesTimer=null,burstTimer=null,burstActive=false,stabilizerEnabled=false,trackingX=0,trackingY=0,targetTrackingX=0,targetTrackingY=0;
let horizonAngle=0,targetHorizonAngle=0,orientationListening=false,lookCanvas=null,lookContext=null,previousFrame=null,lookBusy=false,subjectConfidence=0;
let timerValue=0,timerRunning=false,timerCancel=false,recordingPaused=false;
let focusEnabled=false,focusMarker=null;
const $=id=>document.getElementById(id);
const cameraPage=$("cameraPage"),homePage=$("homePage"),deletedPage=$("deletedPage"),preview=$("cameraPreview"),message=$("cameraMessage"),capture=$("captureButton"),zoomRange=$("zoomRange"),zoomValue=$("zoomValue"),homeGrid=$("homeGrid"),deletedGrid=$("deletedGrid"),optionsModal=$("optionsModal"),optionsContent=$("optionsContent"),photoModal=$("photoEditorModal"),videoModal=$("videoEditorModal"),editPhoto=$("editPhoto"),canvas=$("drawingCanvas"),editVideo=$("editVideo"),videoStart=$("videoStart"),videoEnd=$("videoEnd"),startValue=$("startValue"),endValue=$("endValue"),videoStatus=$("videoStatus");
const rotateLockButton=$("rotateLock"),lookEyesButton=$("lookEyes"),lookEyesStatus=$("lookEyesStatus"),drawColor=$("drawColor"),textColor=$("textColor"),videoText=$("videoText"),videoTextStart=$("videoTextStart"),videoTextEnd=$("videoTextEnd"),videoTextStartValue=$("videoTextStartValue"),videoTextEndValue=$("videoTextEndValue");
function addCameraControls(){
if(!$("barmaanTimer")){
const wrap=document.createElement("div");wrap.id="barmaanTimer";
const select=document.createElement("select");select.id="timerSelect";
[["0","None"],["3","3 seconds"],["5","5 seconds"],["10","10 seconds"]].forEach(x=>{const o=document.createElement("option");o.value=x[0];o.textContent=x[1];select.appendChild(o)});
wrap.appendChild(select);
const pr=document.createElement("button");pr.id="pauseRecording";pr.textContent="Pause recording=PR";wrap.appendChild(pr);
const cwr=document.createElement("button");cwr.id="captureWhenRecording";cwr.textContent="Capture when recording=CWR";wrap.appendChild(cwr);
cameraPage?.appendChild(wrap);
pr.addEventListener("click",togglePauseRecording);
cwr.addEventListener("click",captureWhenRecording);
createFocusButton();
createFocusMarker();
}}
function id(){if(crypto.randomUUID)return crypto.randomUUID();return Date.now()+"_"+Math.random().toString(36).slice(2)}
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains(STORE_NAME)){const s=d.createObjectStore(STORE_NAME,{keyPath:"id"});s.createIndex("deleted","deleted",{unique:false});s.createIndex("created","created",{unique:false})}};r.onsuccess=e=>{db=e.target.result;resolve(db)};r.onerror=e=>reject(e.target.error)})}
function put(item){return new Promise((resolve,reject)=>{const t=db.transaction(STORE_NAME,"readwrite");t.objectStore(STORE_NAME).put(item);t.oncomplete=()=>resolve();t.onerror=e=>reject(e.target.error)})}
function get(idValue){return new Promise((resolve,reject)=>{const r=db.transaction(STORE_NAME,"readonly").objectStore(STORE_NAME).get(idValue);r.onsuccess=()=>resolve(r.result);r.onerror=e=>reject(e.target.error)})}
function all(){return new Promise((resolve,reject)=>{const r=db.transaction(STORE_NAME,"readonly").objectStore(STORE_NAME).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=e=>reject(e.target.error)})}
function remove(idValue){return new Promise((resolve,reject)=>{const t=db.transaction(STORE_NAME,"readwrite");t.objectStore(STORE_NAME).delete(idValue);t.oncomplete=()=>resolve();t.onerror=e=>reject(e.target.error)})}
function notify(text){if(message)message.textContent=text}
function url(blob){return URL.createObjectURL(blob)}
function blobFromCanvas(c,type="image/jpeg",quality=.92){return new Promise(resolve=>c.toBlob(resolve,type,quality))}
function getTimer(){return Number($("timerSelect")?.value||0)}
async function waitTimer(){
const seconds=getTimer();
if(!seconds)return true;
timerRunning=true;timerCancel=false;
for(let i=seconds;i>0;i--){
if(timerCancel){timerRunning=false;return false}
notify("Timer: "+i);
await new Promise(r=>setTimeout(r,1000));
}
timerRunning=false;notify("Go!");
return true;
}
function cancelTimer(){timerCancel=true}
async function timedPhoto(){
if(timerRunning)return false;
if(!(await waitTimer()))return false;
await takePhoto();
return true;
}
async function timedRecording(){
if(timerRunning)return false;
if(!(await waitTimer()))return false;
if(!recording)startRecording();
return true;
}
async function startCamera(){
stopCamera();
if(!navigator.mediaDevices?.getUserMedia){notify("Camera API is not supported.");return}
try{
stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:facingMode,width:{ideal:1920},height:{ideal:1080}},audio:true});
preview.srcObject=stream;await preview.play().catch(()=>{});applyZoom();
if(rotateLock)startOrientationTracking();
notify(mode==="photo"?"Photo mode":"Video mode");
if(lookEyes)startLookEyes();
}catch(e){console.error(e);notify("Camera permission was denied or unavailable.")}
}
function stopCamera(){
stopLookEyes();
if(!stream)return;
stream.getTracks().forEach(t=>t.stop());stream=null;
if(preview)preview.srcObject=null;
}
function applyZoom(){
zoom=Number(zoomRange?.value||zoom||1);
if(zoomValue)zoomValue.textContent=zoom+"×";
applyTrackingTransform();
}
function applyTrackingTransform(){
if(!preview)return;
const x=rotateLock?trackingX:0,y=rotateLock?trackingY:0,rotation=rotateLock?horizonAngle:0;
preview.style.transform=`translate(${x}px,${y}px) rotate(${rotation}deg) scale(${zoom})`;
preview.style.transformOrigin="center center";
}
function normalizeAngle(value){
if(!Number.isFinite(value))return 0;
while(value>180)value-=360;
while(value<-180)value+=360;
return value;
}
function startOrientationTracking(){
if(orientationListening)return;
if(!("DeviceOrientationEvent"in window)){notify("Digital Horizon Lock is not supported.");return}
try{
if(typeof DeviceOrientationEvent.requestPermission==="function"){
DeviceOrientationEvent.requestPermission().then(permission=>{if(permission==="granted"){window.addEventListener("deviceorientation",handleDeviceOrientation,true);orientationListening=true}}).catch(e=>console.error(e));
}else{window.addEventListener("deviceorientation",handleDeviceOrientation,true);orientationListening=true}
}catch(e){console.error(e)}
}
function stopOrientationTracking(){
if(orientationListening){window.removeEventListener("deviceorientation",handleDeviceOrientation,true);orientationListening=false}
targetHorizonAngle=0;horizonAngle=0;applyTrackingTransform();
}
function handleDeviceOrientation(e){
if(!rotateLock)return;
let angle=0;
const screenAngle=Number(screen.orientation?.angle??window.orientation??0),n=((screenAngle%360)+360)%360;
if(n===0)angle=Number(e.gamma)||0;else if(n===90)angle=Number(e.beta)||0;else if(n===180)angle=-(Number(e.gamma)||0);else if(n===270)angle=-(Number(e.beta)||0);else angle=Number(e.gamma)||0;
angle=normalizeAngle(angle);if(Math.abs(angle)>90)angle=0;targetHorizonAngle=-angle;
}
async function toggleRotateLock(){
if(!rotateLock){
rotateLock=true;stabilizerEnabled=true;startOrientationTracking();
if(rotateLockButton){rotateLockButton.textContent="🔓 Rotate Lock: ON";rotateLockButton.classList.add("active")}
notify("Digital Horizon Lock ON");
}else{
rotateLock=false;stabilizerEnabled=false;trackingX=0;trackingY=0;targetTrackingX=0;targetTrackingY=0;stopOrientationTracking();
if(rotateLockButton){rotateLockButton.textContent="🔒 Rotate Lock";rotateLockButton.classList.remove("active")}
notify("Digital Horizon Lock OFF");
}
applyTrackingTransform();
}
rotateLockButton?.addEventListener("click",toggleRotateLock);
function updateStabilizer(){
if(stabilizerEnabled){
horizonAngle+=normalizeAngle(targetHorizonAngle-horizonAngle)*.14;
trackingX+=(targetTrackingX-trackingX)*.12;
trackingY+=(targetTrackingY-trackingY)*.12;
applyTrackingTransform();
}else{
horizonAngle+=normalizeAngle(0-horizonAngle)*.14;
trackingX+=(0-trackingX)*.12;
trackingY+=(0-trackingY)*.12;
applyTrackingTransform();
}
requestAnimationFrame(updateStabilizer);
}
requestAnimationFrame(updateStabilizer);
function setupLookEngine(){
if(!lookCanvas){lookCanvas=document.createElement("canvas");lookCanvas.width=160;lookCanvas.height=120;lookContext=lookCanvas.getContext("2d",{willReadFrequently:true})}
return!!lookContext;
}
function getSubjectPosition(){
if(!preview||!preview.videoWidth||!preview.videoHeight)return null;
if(!setupLookEngine())return null;
const W=160,H=120;lookContext.drawImage(preview,0,0,W,H);
const frame=lookContext.getImageData(0,0,W,H).data;
if(!previousFrame){previousFrame=new Uint8ClampedArray(frame);return null}
let totalWeight=0,weightedX=0,weightedY=0,changedPixels=0;
for(let y=2;y<H-2;y+=2)for(let x=2;x<W-2;x+=2){
const i=(y*W+x)*4,r=frame[i],g=frame[i+1],b=frame[i+2],pr=previousFrame[i],pg=previousFrame[i+1],pb=previousFrame[i+2];
const difference=Math.abs(r-pr)+Math.abs(g-pg)+Math.abs(b-pb);
if(difference<35)continue;
const brightness=(r+g+b)/3;let weight=difference;
if(r>g*.85&&g>b*.75&&r>b*1.05)weight*=1.25;
if(brightness<20)weight*=.3;
if(brightness>248)weight*=.45;
weightedX+=x*weight;weightedY+=y*weight;totalWeight+=weight;changedPixels++;
}
previousFrame=new Uint8ClampedArray(frame);
if(changedPixels<12||totalWeight<800)return null;
const centerX=weightedX/totalWeight,centerY=weightedY/totalWeight,normalizedX=centerX/W,normalizedY=centerY/H;
subjectConfidence=Math.min(1,changedPixels/500);
return{x:normalizedX,y:normalizedY,confidence:subjectConfidence};
}
function createFocusButton(){
if($("focusButton"))return;
const b=document.createElement("button");
b.id="focusButton";
b.textContent="🎯 Focus";
cameraPage?.appendChild(b);
b.addEventListener("click",toggleFocus);
}
function createFocusMarker(){
if(focusMarker)return;
focusMarker=document.createElement("div");
focusMarker.id="focusMarker";
focusMarker.textContent="🎯";
focusMarker.style.cssText="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-size:42px;z-index:20;pointer-events:none;display:none;transition:left .12s ease,top .12s ease";
const parent=preview?.parentElement;
if(parent){
if(getComputedStyle(parent).position==="static")parent.style.position="relative";
parent.appendChild(focusMarker);
}
}
function updateFocusMarker(subject){
if(!focusMarker||!focusEnabled)return;
if(!subject){
focusMarker.style.display="none";
return;
}
focusMarker.style.display="block";
focusMarker.style.left=(subject.x*100)+"%";
focusMarker.style.top=(subject.y*100)+"%";
}
function toggleFocus(){
focusEnabled=!focusEnabled;
createFocusMarker();
const b=$("focusButton");
if(focusEnabled){
if(b){b.textContent="🎯 Focus: ON";b.classList.add("active")}
notify("Focus ON");
if(lookEyes)startLookEyes();
}else{
if(b){b.textContent="🎯 Focus";b.classList.remove("active")}
if(focusMarker)focusMarker.style.display="none";
targetTrackingX=0;
targetTrackingY=0;
notify("Focus OFF");
}
}
function followSubject(subject){
if(!subject){
targetTrackingX*=.94;
targetTrackingY*=.94;
updateFocusMarker(null);
return;
}
if(focusEnabled)updateFocusMarker(subject);
if(!focusEnabled)return;
const maxMove=Math.max(0,(zoom-1)*110);
targetTrackingX=(.5-subject.x)*maxMove;
targetTrackingY=(.5-subject.y)*maxMove;
targetTrackingX=Math.max(-maxMove,Math.min(maxMove,targetTrackingX));
targetTrackingY=Math.max(-maxMove,Math.min(maxMove,targetTrackingY));
if(zoom<2&&zoomRange){
const z=Math.min(2,Number(zoomRange.max)||2);
zoom=z;zoomRange.value=z;if(zoomValue)zoomValue.textContent=z+"×";
}
}
async function detectSubject(){
if(!lookEyes||!stream||!preview.videoWidth||lookBusy)return null;
lookBusy=true;
try{return getSubjectPosition()}catch(e){console.error(e);return null}finally{lookBusy=false}
}
async function lookEyesLoop(){
if(!lookEyes||!stream)return;
const subject=await detectSubject();
if(subject){
followSubject(subject);
if(mode==="photo"&&subject.confidence>.22){
if(!burstActive&&!timerRunning)await timedPhoto(),notify("👁️ Subject detected — photo taken.");
}else if(mode==="video"&&subject.confidence>.12){
if(!recording&&!timerRunning){await timedRecording();notify("👁️ Look Eyes — tracking.")}
}
}else{
targetTrackingX*=.92;
targetTrackingY*=.92;
if(focusEnabled)updateFocusMarker(null);
}
}
function startLookEyes(){
stopLookEyes();
if(!setupLookEngine()){if(lookEyesStatus)lookEyesStatus.textContent="Look Eyes: unavailable";notify("Look Eyes could not start.");return}
previousFrame=null;subjectConfidence=0;
if(lookEyesStatus)lookEyesStatus.textContent="Look Eyes: ON";
lookEyesTimer=setInterval(lookEyesLoop,220);
}
function stopLookEyes(){
if(lookEyesTimer){clearInterval(lookEyesTimer);lookEyesTimer=null}
previousFrame=null;subjectConfidence=0;lookBusy=false;targetTrackingX=0;targetTrackingY=0;
if(focusMarker)focusMarker.style.display="none";
if(lookEyesStatus)lookEyesStatus.textContent=lookEyes?"Look Eyes: ON":"Look Eyes: Off";
}
function toggleLookEyes(){
lookEyes=!lookEyes;
if(lookEyesButton){lookEyesButton.textContent=lookEyes?"👁️ Look Eyes: ON":"👁️ Look Eyes";lookEyesButton.classList.toggle("active",lookEyes)}
if(lookEyes){startLookEyes();notify("Look Eyes ON")}else{stopLookEyes();notify("Look Eyes OFF")}
}
lookEyesButton?.addEventListener("click",toggleLookEyes);
$("switchCamera")?.addEventListener("click",async()=>{facingMode=facingMode==="environment"?"user":"environment";await startCamera()});
$("photoMode")?.addEventListener("click",()=>{if(recording)return;mode="photo";capture.classList.remove("recording");notify("Photo mode");if(lookEyes)startLookEyes()});
$("videoMode")?.addEventListener("click",()=>{if(recording)return;mode="video";notify("Video mode");if(lookEyes)startLookEyes()});
zoomRange?.addEventListener("input",applyZoom);
async function startBurst(){
if(mode!=="photo"||burstActive)return;
burstActive=true;notify("Burst Photo...");
while(burstActive&&mode==="photo"&&stream){await takePhoto();await new Promise(resolve=>setTimeout(resolve,180))}
}
function stopBurst(){burstActive=false;notify("Burst stopped.")}
capture?.addEventListener("pointerdown",e=>{if(mode!=="photo")return;e.preventDefault();startBurst();try{capture.setPointerCapture(e.pointerId)}catch(_){}});
capture?.addEventListener("pointerup",e=>{if(mode!=="photo")return;e.preventDefault();stopBurst();try{capture.releasePointerCapture(e.pointerId)}catch(_){}});
capture?.addEventListener("pointercancel",()=>{if(mode==="photo")stopBurst()});
capture?.addEventListener("click",async()=>{if(mode==="photo"){if(!burstActive&&!timerRunning)await timedPhoto()}else{if(recording)stopRecording();else await timedRecording()}});
async function takePhoto(){
if(!stream||!preview.videoWidth){notify("Camera is not ready.");return}
const w=preview.videoWidth,h=preview.videoHeight,c=document.createElement("canvas");c.width=w;c.height=h;
const ctx=c.getContext("2d"),sw=w/zoom,sh=h/zoom;let sx=(w-sw)/2,sy=(h-sh)/2;
if(stabilizerEnabled&&zoom>1){sx=Math.max(0,Math.min(w-sw,(w/2)-(sw/2)-(trackingX*(w/Math.max(w,1)))));sy=Math.max(0,Math.min(h-sh,(h/2)-(sh/2)-(trackingY*(h/Math.max(h,1)))))}
const angle=rotateLock?horizonAngle*Math.PI/180:0;ctx.save();ctx.translate(w/2,h/2);ctx.rotate(angle);ctx.drawImage(preview,sx,sy,sw,sh,-sw/2,-sh/2,sw,sh);ctx.restore();
const blob=await blobFromCanvas(c);await put({id:id(),type:"photo",blob,created:Date.now(),deleted:false,edited:false});if(!burstActive)notify("Photo saved.");await renderHome();
}
function recorderType(){const types=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm"];return types.find(t=>MediaRecorder.isTypeSupported(t))||""}
function makeZoomStream(){
if(!preview.videoWidth||!HTMLCanvasElement.prototype.captureStream)return stream;
const c=document.createElement("canvas"),w=preview.videoWidth,h=preview.videoHeight;c.width=w;c.height=h;const ctx=c.getContext("2d");let running=true;
const draw=()=>{if(!running)return;const sw=w/zoom,sh=h/zoom;let sx=(w-sw)/2,sy=(h-sh)/2;
if(stabilizerEnabled&&zoom>1){sx=Math.max(0,Math.min(w-sw,(w/2)-(sw/2)-(trackingX*(w/Math.max(w,1)))));sy=Math.max(0,Math.min(h-sh,(h/2)-(sh/2)-(trackingY*(h/Math.max(h,1)))))}
const angle=rotateLock?horizonAngle*Math.PI/180:0;ctx.clearRect(0,0,w,h);ctx.save();ctx.translate(w/2,h/2);ctx.rotate(angle);ctx.drawImage(preview,sx,sy,sw,sh,-sw/2,-sh/2,sw,sh);ctx.restore();requestAnimationFrame(draw)};
draw();const output=c.captureStream(30),audio=stream?.getAudioTracks?.()[0];if(audio)output.addTrack(audio);output._stopCanvas=()=>{running=false};return output;
}
function startRecording(){
if(!stream){notify("Camera is not ready.");return}
if(!window.MediaRecorder){notify("Video recording is not supported.");return}
chunks=[];let source=stream;
if((zoom>1||rotateLock||stabilizerEnabled)&&HTMLCanvasElement.prototype.captureStream)source=makeZoomStream();
try{const type=recorderType();recorder=type?new MediaRecorder(source,{mimeType:type}):new MediaRecorder(source)}catch(e){console.error(e);notify("Could not start recording.");return}
recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data)};
recorder.onerror=e=>{console.error(e);notify("Recording error.")};
recorder.onstop=async()=>{const blob=new Blob(chunks,{type:recorder.mimeType||"video/webm"});await saveVideoBlob(blob);if(source._stopCanvas)source._stopCanvas()};
recorder.start(250);recording=true;recordingPaused=false;capture.classList.add("recording");updatePauseButton();notify("Recording...");
}
function stopRecording(){
if(!recorder||recorder.state==="inactive")return;
recorder.stop();recording=false;recordingPaused=false;capture.classList.remove("recording");updatePauseButton();notify("Saving video...");
}
function togglePauseRecording(){
if(!recording||!recorder)return;
if(recorder.state==="recording"){recorder.pause();recordingPaused=true;notify("Recording paused.");updatePauseButton()}
else if(recorder.state==="paused"){recorder.resume();recordingPaused=false;notify("Recording resumed.");updatePauseButton()}
}
function updatePauseButton(){const b=$("pauseRecording");if(b)b.textContent=recordingPaused?"Resume recording=PR":"Pause recording=PR"}
async function captureWhenRecording(){
if(!recording||recordingPaused||timerRunning)return;
if(!(await waitTimer()))return;
await takePhoto();
notify("📸 Photo captured while recording.");
}
async function saveVideoBlob(blob){
await put({id:id(),type:"video",blob,created:Date.now(),deleted:false,edited:false});notify("Video saved.");await renderHome();
}
function showPage(page){[cameraPage,homePage,deletedPage].forEach(p=>p?.classList.remove("active"));page?.classList.add("active");if(page===cameraPage)startCamera();else if(!recording)stopCamera();if(page===homePage)renderHome();if(page===deletedPage)renderDeleted()}
$("navCamera")?.addEventListener("click",()=>showPage(cameraPage));
$("navHome")?.addEventListener("click",()=>showPage(homePage));
$("navDeleted")?.addEventListener("click",()=>showPage(deletedPage));
$("openDeleted")?.addEventListener("click",()=>showPage(deletedPage));
$("backHome")?.addEventListener("click",()=>showPage(homePage));
async function renderHome(){
if(!homeGrid)return;
const items=(await all()).filter(x=>!x.deleted).sort((a,b)=>b.created-a.created);homeGrid.innerHTML="";
if(!items.length){homeGrid.innerHTML='<div class="empty">No photos or videos yet.</div>';return}
items.forEach(item=>homeGrid.appendChild(card(item,false)));
}
async function renderDeleted(){
if(!deletedGrid)return;
const items=(await all()).filter(x=>x.deleted).sort((a,b)=>b.created-a.created);deletedGrid.innerHTML="";
if(!items.length){deletedGrid.innerHTML='<div class="empty">Recently Deleted is empty.</div>';return}
for(const item of items){
const card=document.createElement("div");
card.className="media-card";
card.dataset.id=item.id;

const media=item.type==="photo"
?document.createElement("img")
:document.createElement("video");

media.src=url(item.blob);
media.className="media-thumb";
if(item.type==="video"){
media.controls=true;
media.preload="metadata";
}

card.appendChild(media);

const info=document.createElement("div");
info.className="media-info";

const title=document.createElement("div");
title.className="media-title";
title.textContent=item.name||`${item.type==="photo"?"Photo":"Video"} ${new Date(item.created).toLocaleString()}`;

const actions=document.createElement("div");
actions.className="media-actions";

const restoreBtn=document.createElement("button");
restoreBtn.textContent="Restore";
restoreBtn.addEventListener("click",async()=>{
await update(item.id,{deleted:false});
renderDeleted();
renderHome();
});

const deleteBtn=document.createElement("button");
deleteBtn.textContent="Delete Permanently";
deleteBtn.addEventListener("click",async()=>{
if(!confirm("Delete this item permanently?"))return;
await remove(item.id);
renderDeleted();
});

actions.appendChild(restoreBtn);
actions.appendChild(deleteBtn);
info.appendChild(title);
info.appendChild(actions);
card.appendChild(info);
deletedGrid.appendChild(card);
}
}
