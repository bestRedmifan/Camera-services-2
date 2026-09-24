const DB_NAME = "BarmaanCameraDB";
const DB_VERSION = 1;
const STORE_NAME = "media";
let db = null;
let stream = null;
let facingMode = "environment";
let mode = "photo";
let zoom = 1;
let recorder = null;
let chunks = [];
let recording = false;
let selectedId = null;
let photoEditId = null;
let videoEditId = null;
let drawing = false;
let drawEnabled = false;
let videoURL = null;
const $ = id => document.getElementById(id);
const cameraPage = $("cameraPage");
const homePage = $("homePage");
const deletedPage = $("deletedPage");
const preview = $("cameraPreview");
const message = $("cameraMessage");
const capture = $("captureButton");
const zoomRange = $("zoomRange");
const zoomValue = $("zoomValue");
const homeGrid = $("homeGrid");
const deletedGrid = $("deletedGrid");
const optionsModal = $("optionsModal");
const optionsContent = $("optionsContent");
const photoModal = $("photoEditorModal");
const videoModal = $("videoEditorModal");
const editPhoto = $("editPhoto");
const canvas = $("drawingCanvas");
const editVideo = $("editVideo");
const videoStart = $("videoStart");
const videoEnd = $("videoEnd");
const startValue = $("startValue");
const endValue = $("endValue");
const videoStatus = $("videoStatus");
function id() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now() + "_" + Math.random().toString(36).slice(2);
}
function openDB() {
  return new Promise((resolve,reject)=>{
    const r = indexedDB.open(DB_NAME,DB_VERSION);
    r.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORE_NAME)) {
        const s = d.createObjectStore(STORE_NAME,{keyPath:"id"});
        s.createIndex("deleted","deleted",{unique:false});
        s.createIndex("created","created",{unique:false});
      }
    };
    r.onsuccess = e => { db=e.target.result; resolve(db); };
    r.onerror = e => reject(e.target.error);
  });
}
function put(item) {
  return new Promise((resolve,reject)=>{
    const t=db.transaction(STORE_NAME,"readwrite");
    t.objectStore(STORE_NAME).put(item);
    t.oncomplete=()=>resolve();
    t.onerror=e=>reject(e.target.error);
  });
}
function get(idValue) {
  return new Promise((resolve,reject)=>{
    const r=db.transaction(STORE_NAME,"readonly").objectStore(STORE_NAME).get(idValue);
    r.onsuccess=()=>resolve(r.result);
    r.onerror=e=>reject(e.target.error);
  });
}
function all() {
  return new Promise((resolve,reject)=>{
    const r=db.transaction(STORE_NAME,"readonly").objectStore(STORE_NAME).getAll();
    r.onsuccess=()=>resolve(r.result);
    r.onerror=e=>reject(e.target.error);
  });
}
function remove(idValue) {
  return new Promise((resolve,reject)=>{
    const t=db.transaction(STORE_NAME,"readwrite");
    t.objectStore(STORE_NAME).delete(idValue);
    t.oncomplete=()=>resolve();
    t.onerror=e=>reject(e.target.error);
  });
}
function notify(text) {
  if (message) message.textContent=text;
}
function url(blob) {
  return URL.createObjectURL(blob);
}
function blobFromCanvas(c,type="image/jpeg",quality=.92) {
  return new Promise(resolve=>c.toBlob(resolve,type,quality));
}
async function startCamera() {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) {
    notify("Camera API is not supported.");
    return;
  }
  try {
    stream=await navigator.mediaDevices.getUserMedia({
      video:{facingMode:facingMode},
      audio:true
    });
    preview.srcObject=stream;
    await preview.play().catch(()=>{});
    applyZoom();
    notify(mode==="photo"?"Photo mode":"Video mode");
  } catch(e) {
    console.error(e);
    notify("Camera permission was denied or unavailable.");
  }
}
function stopCamera() {
  if (!stream) return;
  stream.getTracks().forEach(t=>t.stop());
  stream=null;
  if (preview) preview.srcObject=null;
}
function applyZoom() {
  zoom=Number(zoomRange?.value||zoom||1);
  if (zoomValue) zoomValue.textContent=zoom+"×";
  if (preview) preview.style.transform=`scale(${zoom})`;
}
$("switchCamera")?.addEventListener("click",async()=>{
  facingMode=facingMode==="environment"?"user":"environment";
  await startCamera();
});
$("photoMode")?.addEventListener("click",()=>{
  if (recording) return;
  mode="photo";
  capture.classList.remove("recording");
  notify("Photo mode");
});
$("videoMode")?.addEventListener("click",()=>{
  if (recording) return;
  mode="video";
  notify("Video mode");
});
zoomRange?.addEventListener("input",applyZoom);
capture?.addEventListener("click",()=>{
  if (mode==="photo") takePhoto();
  else recording?stopRecording():startRecording();
});
async function takePhoto() {
  if (!stream || !preview.videoWidth) {
    notify("Camera is not ready.");
    return;
  }
  const w=preview.videoWidth;
  const h=preview.videoHeight;
  const c=document.createElement("canvas");
  c.width=w;
  c.height=h;
  const ctx=c.getContext("2d");
  const sw=w/zoom;
  const sh=h/zoom;
  const sx=(w-sw)/2;
  const sy=(h-sh)/2;
  ctx.drawImage(preview,sx,sy,sw,sh,0,0,w,h);
  const blob=await blobFromCanvas(c);
  await put({
    id:id(),
    type:"photo",
    blob,
    created:Date.now(),
    deleted:false,
    edited:false
  });
  notify("Photo saved.");
  await renderHome();
}
function recorderType() {
  const types=[
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];
  return types.find(t=>MediaRecorder.isTypeSupported(t))||"";
}
function makeZoomStream() {
  if (!preview.videoWidth || !canvas) return stream;
  const c=document.createElement("canvas");
  const w=preview.videoWidth;
  const h=preview.videoHeight;
  c.width=w;
  c.height=h;
  const ctx=c.getContext("2d");
  let running=true;
  const draw=()=>{
    if (!running) return;
    const sw=w/zoom;
    const sh=h/zoom;
    ctx.drawImage(preview,(w-sw)/2,(h-sh)/2,sw,sh,0,0,w,h);
    requestAnimationFrame(draw);
  };
  draw();
  const output=c.captureStream(30);
  const audio=stream?.getAudioTracks?.()[0];
  if (audio) output.addTrack(audio);
  output._stopCanvas=()=>{running=false;};
  return output;
}
function startRecording() {
  if (!stream) {
    notify("Camera is not ready.");
    return;
  }
  if (!window.MediaRecorder) {
    notify("Video recording is not supported.");
    return;
  }
  chunks=[];
  let source=stream;
  if (zoom>1 && HTMLCanvasElement.prototype.captureStream) source=makeZoomStream();
  try {
    const type=recorderType();
    recorder=type?new MediaRecorder(source,{mimeType:type}):new MediaRecorder(source);
  } catch(e) {
    console.error(e);
    notify("Could not start recording.");
    return;
  }
  recorder.ondataavailable=e=>{
    if (e.data?.size) chunks.push(e.data);
  };
  recorder.onerror=e=>{
    console.error(e);
    notify("Recording error.");
  };
  recorder.onstop=async()=>{
    const blob=new Blob(chunks,{type:recorder.mimeType||"video/webm"});
    await saveVideoBlob(blob);
    if (source._stopCanvas) source._stopCanvas();
  };
  recorder.start(250);
  recording=true;
  capture.classList.add("recording");
  notify("Recording...");
}
function stopRecording() {
  if (!recorder || recorder.state==="inactive") return;
  recorder.stop();
  recording=false;
  capture.classList.remove("recording");
  notify("Saving video...");
}
async function saveVideoBlob(blob) {
  await put({
    id:id(),
    type:"video",
    blob,
    created:Date.now(),
    deleted:false,
    edited:false
  });
  notify("Video saved.");
  await renderHome();
}
function showPage(page) {
  [cameraPage,homePage,deletedPage].forEach(p=>p?.classList.remove("active"));
  page?.classList.add("active");
  if (page===cameraPage) startCamera();
  else if (!recording) stopCamera();
  if (page===homePage) renderHome();
  if (page===deletedPage) renderDeleted();
}
$("navCamera")?.addEventListener("click",()=>showPage(cameraPage));
$("navHome")?.addEventListener("click",()=>showPage(homePage));
$("navDeleted")?.addEventListener("click",()=>showPage(deletedPage));
$("openDeleted")?.addEventListener("click",()=>showPage(deletedPage));
$("backHome")?.addEventListener("click",()=>showPage(homePage));
async function renderHome() {
  if (!homeGrid) return;
  const items=(await all()).filter(x=>!x.deleted).sort((a,b)=>b.created-a.created);
  homeGrid.innerHTML="";
  if (!items.length) {
    homeGrid.innerHTML='<div class="empty">No photos or videos yet.</div>';
    return;
  }
  items.forEach(item=>homeGrid.appendChild(card(item,false)));
}
async function renderDeleted() {
  if (!deletedGrid) return;
  const items=(await all()).filter(x=>x.deleted).sort((a,b)=>b.created-a.created);
  deletedGrid.innerHTML="";
  if (!items.length) {
    deletedGrid.innerHTML='<div class="empty">Recently Deleted is empty.</div>';
    return;
  }
  items.forEach(item=>deletedGrid.appendChild(card(item,true)));
}
function card(item,deleted) {
  const box=document.createElement("article");
  box.className="media-card";
  const media=item.type==="photo"?document.createElement("img"):document.createElement("video");
  media.src=url(item.blob);
  media.dataset.objectUrl=media.src;
  if (item.type==="video") {
    media.controls=true;
    media.playsInline=true;
    media.preload="metadata";
  }
  box.appendChild(media);
  const info=document.createElement("div");
  info.className="media-info";
  info.textContent=item.type==="photo"?"📸 Photo":"🎥 Video";
  if (item.edited) info.textContent+=" • Edited";
  box.appendChild(info);
  const more=document.createElement("button");
  more.className="more-button";
  more.textContent="⋯";
  more.addEventListener("click",()=>openOptions(item,deleted));
  box.appendChild(more);
  return box;
}
function openOptions(item,deleted) {
  selectedId=item.id;
  optionsContent.innerHTML="";
  if (deleted) {
    option("♻️ Restore","restore-button",()=>restoreItem(item.id));
    option("🗑️ Delete permanently","danger-button",()=>permanentDelete(item.id));
  } else {
    option("⬇️ Download","",()=>downloadItem(item));
    option("📤 Share","",()=>shareItem(item));
    option("✏️ Edit","",()=>editItem(item));
    option("🗑️ Delete","danger-button",()=>trashItem(item.id));
  }
  optionsModal.classList.add("show");
}
function option(label,className,action) {
  const b=document.createElement("button");
  b.textContent=label;
  if (className) b.className=className;
  b.addEventListener("click",action);
  optionsContent.appendChild(b);
}
function closeOptions() {
  optionsModal?.classList.remove("show");
}
$("closeOptions")?.addEventListener("click",closeOptions);
async function downloadItem(item) {
  const u=url(item.blob);
  const a=document.createElement("a");
  a.href=u;
  a.download=item.type==="photo"?"barmaan-photo.jpg":"barmaan-video.webm";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(u),1500);
  closeOptions();
}
async function shareItem(item) {
  const name=item.type==="photo"?"barmaan-photo.jpg":"barmaan-video.webm";
  const file=new File([item.blob],name,{type:item.blob.type});
  try {
    if (navigator.canShare?.({files:[file]})) {
      await navigator.share({title:"Barmaan Camera",files:[file]});
    } else if (navigator.share) {
      await navigator.share({title:"Barmaan Camera",text:"Media from Barmaan Camera"});
    } else {
      notify("Sharing is not supported.");
    }
  } catch(e) {
    console.log("Share cancelled.",e);
  }
  closeOptions();
}
async function editItem(item) {
  closeOptions();
  if (item.type==="photo") openPhotoEditor(item);
  else openVideoEditor(item);
}
async function trashItem(idValue) {
  const item=await get(idValue);
  if (!item) return;
  item.deleted=true;
  await put(item);
  closeOptions();
  await renderHome();
  await renderDeleted();
  notify("Moved to Recently Deleted.");
}
async function restoreItem(idValue) {
  const item=await get(idValue);
  if (!item) return;
  item.deleted=false;
  await put(item);
  closeOptions();
  await renderHome();
  await renderDeleted();
  notify("Restored.");
}
async function permanentDelete(idValue) {
  if (!confirm("Delete this item permanently?")) return;
  await remove(idValue);
  closeOptions();
  await renderDeleted();
  notify("Deleted permanently.");
}
function openPhotoEditor(item) {
  photoEditId=item.id;
  drawEnabled=false;
  drawing=false;
  const u=url(item.blob);
  editPhoto.onload=()=>{
    resizeCanvas();
    URL.revokeObjectURL(u);
  };
  editPhoto.src=u;
  photoModal.classList.add("show");
}
function closePhotoEditor() {
  photoModal.classList.remove("show");
  photoEditId=null;
  drawEnabled=false;
  drawing=false;
  clearCanvas();
}
function resizeCanvas() {
  const rect=editPhoto.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const old=document.createElement("canvas");
  old.width=canvas.width;
  old.height=canvas.height;
  if (old.width && old.height) old.getContext("2d").drawImage(canvas,0,0);
  canvas.width=Math.round(rect.width);
  canvas.height=Math.round(rect.height);
  if (old.width && old.height) canvas.getContext("2d").drawImage(old,0,0,canvas.width,canvas.height);
}
function position(e) {
  const r=canvas.getBoundingClientRect();
  const p=e.touches?.[0]||e;
  return {
    x:(p.clientX-r.left)*(canvas.width/r.width),
    y:(p.clientY-r.top)*(canvas.height/r.height)
  };
}
function beginDraw(e) {
  if (!drawEnabled) return;
  drawing=true;
  const p=position(e);
  const c=canvas.getContext("2d");
  c.beginPath();
  c.moveTo(p.x,p.y);
  e.preventDefault();
}
function paint(e) {
  if (!drawing || !drawEnabled) return;
  const p=position(e);
  const c=canvas.getContext("2d");
  c.lineWidth=Number($("brushSize")?.value||6);
  c.lineCap="round";
  c.lineJoin="round";
  c.strokeStyle="#ffffff";
  c.lineTo(p.x,p.y);
  c.stroke();
  e.preventDefault();
}
function endDraw() {
  drawing=false;
}
canvas?.addEventListener("mousedown",beginDraw);
canvas?.addEventListener("mousemove",paint);
window.addEventListener("mouseup",endDraw);
canvas?.addEventListener("touchstart",beginDraw,{passive:false});
canvas?.addEventListener("touchmove",paint,{passive:false});
canvas?.addEventListener("touchend",endDraw);
$("drawButton")?.addEventListener("click",()=>{
  drawEnabled=true;
});
$("clearDrawing")?.addEventListener("click",clearCanvas);
function clearCanvas() {
  const c=canvas?.getContext("2d");
  if (c) c.clearRect(0,0,canvas.width,canvas.height);
}
$("textButton")?.addEventListener("click",()=>{
  const text=prompt("Enter text:");
  if (!text) return;
  const c=canvas.getContext("2d");
  c.font="32px Arial";
  c.textAlign="center";
  c.textBaseline="middle";
  c.lineWidth=5;
  c.strokeStyle="#000";
  c.fillStyle="#fff";
  c.strokeText(text,canvas.width/2,canvas.height/2);
  c.fillText(text,canvas.width/2,canvas.height/2);
});
$("cancelPhoto")?.addEventListener("click",closePhotoEditor);
$("savePhoto")?.addEventListener("click",savePhotoEdit);
async function savePhotoEdit() {
  if (!photoEditId) return;
  const item=await get(photoEditId);
  if (!item) return;
  const image=new Image();
  const u=url(item.blob);
  image.onload=async()=>{
    const out=document.createElement("canvas");
    out.width=image.naturalWidth;
    out.height=image.naturalHeight;
    const c=out.getContext("2d");
    c.drawImage(image,0,0);
    c.drawImage(canvas,0,0,out.width,out.height);
    item.blob=await blobFromCanvas(out);
    item.edited=true;
    await put(item);
    URL.revokeObjectURL(u);
    closePhotoEditor();
    await renderHome();
    notify("Edited photo saved.");
  };
  image.src=u;
}
function openVideoEditor(item) {
  videoEditId=item.id;
  videoStatus.textContent="Loading video...";
  if (videoURL) URL.revokeObjectURL(videoURL);
  videoURL=url(item.blob);
  editVideo.src=videoURL;
  editVideo.onloadedmetadata=()=>{
    const d=editVideo.duration;
    videoStart.min=0;
    videoStart.max=d;
    videoStart.value=0;
    videoEnd.min=0;
    videoEnd.max=d;
    videoEnd.value=d;
    startValue.textContent="0.00";
    endValue.textContent=d.toFixed(2);
    videoStatus.textContent="Choose the part to keep.";
  };
  videoModal.classList.add("show");
}
function closeVideoEditor() {
  videoModal.classList.remove("show");
  videoEditId=null;
  editVideo.pause();
  editVideo.removeAttribute("src");
  editVideo.load();
  if (videoURL) URL.revokeObjectURL(videoURL);
  videoURL=null;
}
$("cancelVideo")?.addEventListener("click",closeVideoEditor);
videoStart?.addEventListener("input",()=>{
  let s=Number(videoStart.value);
  let e=Number(videoEnd.value);
  if (s>=e) {
    s=Math.max(0,e-.01);
    videoStart.value=s;
  }
  startValue.textContent=s.toFixed(2);
});
videoEnd?.addEventListener("input",()=>{
  let s=Number(videoStart.value);
  let e=Number(videoEnd.value);
  if (e<=s) {
    e=Math.min(editVideo.duration,s+.01);
    videoEnd.value=e;
  }
  endValue.textContent=e.toFixed(2);
});
async function cutVideo(blob,start,end) {
  return new Promise((resolve,reject)=>{
    const source=url(blob);
    const v=document.createElement("video");
    v.src=source;
    v.muted=true;
    v.playsInline=true;
    v.preload="auto";
    v.onloadedmetadata=()=>{
      const captureStream=v.captureStream?.()||v.mozCaptureStream?.();
      if (!captureStream) {
        URL.revokeObjectURL(source);
        reject(new Error("Video cutting is not supported in this browser."));
        return;
      }
      const type=recorderType();
      let r;
      try {
        r=type?new MediaRecorder(captureStream,{mimeType:type}):new MediaRecorder(captureStream);
      } catch(e) {
        URL.revokeObjectURL(source);
        reject(e);
        return;
      }
      const out=[];
      r.ondataavailable=e=>{if(e.data?.size)out.push(e.data);};
      r.onerror=e=>{
        captureStream.getTracks().forEach(t=>t.stop());
        URL.revokeObjectURL(source);
        reject(e);
      };
      r.onstop=()=>{
        captureStream.getTracks().forEach(t=>t.stop());
        URL.revokeObjectURL(source);
        resolve(new Blob(out,{type:r.mimeType||"video/webm"}));
      };
      v.currentTime=start;
      v.onseeked=()=>{
        r.start(100);
        v.play().catch(reject);
      };
      v.ontimeupdate=()=>{
        if (v.currentTime>=end && r.state!=="inactive") {
          v.pause();
          r.stop();
        }
      };
    };
    v.onerror=()=>{
      URL.revokeObjectURL(source);
      reject(new Error("Could not load video."));
    };
  });
}
$("saveVideo")?.addEventListener("click",async()=>{
  if (!videoEditId) return;
  const start=Number(videoStart.value);
  const end=Number(videoEnd.value);
  if (!Number.isFinite(start)||!Number.isFinite(end)||end<=start) {
    videoStatus.textContent="Invalid range.";
    return;
  }
  videoStatus.textContent="Cutting video...";
  try {
    const item=await get(videoEditId);
    if (!item) throw new Error("Video not found.");
    const blob=await cutVideo(item.blob,start,end);
    item.blob=blob;
    item.edited=true;
    await put(item);
    videoStatus.textContent="Saved.";
    setTimeout(async()=>{
      closeVideoEditor();
      await renderHome();
      notify("Edited video saved.");
    },400);
  } catch(e) {
    console.error(e);
    videoStatus.textContent=e.message||"Video cutting failed.";
  }
});
optionsModal?.addEventListener("click",e=>{
  if (e.target===optionsModal) closeOptions();
});
photoModal?.addEventListener("click",e=>{
  if (e.target===photoModal) closePhotoEditor();
});
videoModal?.addEventListener("click",e=>{
  if (e.target===videoModal) closeVideoEditor();
});
document.addEventListener("keydown",e=>{
  if (e.key==="Escape") {
    closeOptions();
    closePhotoEditor();
    closeVideoEditor();
  }
});
document.addEventListener("visibilitychange",()=>{
  if (document.hidden && !recording) stopCamera();
  if (!document.hidden && cameraPage?.classList.contains("active")) startCamera();
});
window.addEventListener("resize",()=>{
  if (photoModal?.classList.contains("show")) resizeCanvas();
});
window.addEventListener("beforeunload",()=>{
  if (stream) stream.getTracks().forEach(t=>t.stop());
  if (videoURL) URL.revokeObjectURL(videoURL);
});
async function boot() {
try {
await openDB();
await renderHome();
await renderDeleted();
await startCamera();
} catch(e) {
console.error(e);
notify("Barmaan camera could not start.");
}
}
boot();
