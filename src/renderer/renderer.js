(function(){
'use strict';
if(!window.px){document.body.innerHTML='<div style="color:#F43F5E;padding:40px;font-family:monospace">'+(window.i18n?window.i18n.t('app.error_no_px'):'ERROR: window.px unavailable.')+'</div>';return;}
const px=window.px;
// i18n shortcut — window.i18n is loaded by i18n.js before this script
const t=(key,vars)=>window.i18n?window.i18n.t(key,vars):key;
let allPacks=[],currentPack=null,isInstalling=false,isGameRunning=false,gameLogCb=null,gameCloseCb=null;
let runningGamePackId=null,runningGamePid=null;

function $(id){return document.getElementById(id);}
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(n){if(!n)return'0';if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'k';return String(n);}
function getLoaderDisplayName(loader){
  const raw = String(loader || '');
  const lower = raw.toLowerCase();
  const mapped = ({forge:'Forge',neoforge:'NeoForge',fabric:'Fabric',quilt:'Quilt',vanilla:'Vanilla'})[lower];
  if (mapped) return mapped;
  if (!raw) return '';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
function formatLoaderWithVersion(loader, version){
  const name=getLoaderDisplayName(loader);
  return version?`${name} ${version}`:name;
}
function normalizeInstalledMatchKey(value){
  return String(value||'')
    .toLowerCase()
    .replace(/\.(jar|zip|mrpack|json|toml|cfg|txt|properties|ini)$/i,'')
    .replace(/[^a-z0-9]+/g,'');
}
function prettifyContentName(rawName, rawFilename, type=''){
  const source = String(rawName || rawFilename || '').trim();
  if (!source) return '';
  let s = source.replace(/\.(jar|zip|mrpack|json|toml|cfg|txt|properties|ini)$/i,'');
  const likelyRaw = /[_-]/.test(s) || /\b(mc|minecraft|forge|neoforge|fabric|quilt)\b/i.test(s) || /\d+\.\d+/.test(s) || !/[A-ZÀ-Ý]/.test(s);
  if (!likelyRaw) return s;

  s = s
    .replace(/[+]/g,' ')
    .replace(/\b(mc|minecraft)\s*[0-9]+(?:\.[0-9]+){0,3}\b/ig,' ')
    .replace(/\b(forge|neoforge|fabric|quilt)\b/ig,' ')
    .replace(/\bv?[0-9]+(?:\.[0-9]+){1,3}(?:[-._]?(alpha|beta|rc)[-._]?\d*)?\b/ig,' ')
    .replace(/([a-z])([A-Z])/g,'$1 $2')
    .replace(/([a-zA-Z])(\d)/g,'$1 $2')
    .replace(/(\d)([a-zA-Z])/g,'$1 $2')
    .replace(/[_-]+/g,' ')
    .replace(/[.]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();

  const upperSet = new Set(['api','ui','ux','fps','gpu','cpu','dns','rpc','mc','rtx','xaero','emi','rei','jei','ftb','nvidium']);
  const titled = s.split(' ').map(w=>{
    const lower = w.toLowerCase();
    if (upperSet.has(lower)) return lower.toUpperCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ').trim();

  if (type === 'mod' && titled.length <= 2) return source;
  return titled || source;
}
function preprocessInstanceFiles(files){
  return (Array.isArray(files) ? files : []).map(f=>{
    const prettyName = prettifyContentName(f?.modrinthTitle || f?.name, f?.filename, f?.type);
    return { ...f, prettyName };
  });
}
function normalizeUuid(raw){
  const v=String(raw||'').replace(/-/g,'').toLowerCase();
  return /^[0-9a-f]{32}$/.test(v)?v:'';
}
function getAvatarUrls(profile){
  const urls=[];
  const uuid=normalizeUuid(profile?.id);
  if(uuid) urls.push(`https://crafatar.com/avatars/${uuid}?size=128&overlay`);
  const name=String(profile?.name||'').trim();
  if(name) urls.push(`https://minotar.net/helm/${encodeURIComponent(name)}/128`);
  return urls;
}
function setPlayerAvatar(el,profile){
  if(!el)return;
  const name=String(profile?.name||'').trim();
  const fallback=(name[0]||'?').toUpperCase();
  const key=`${profile?.id||''}|${name}|${Date.now()}`;
  el.dataset.avatarKey=key;
  el.textContent=fallback;
  el.querySelectorAll('.player-head').forEach(n=>n.remove());
  const urls=getAvatarUrls(profile);
  if(!urls.length)return;
  const img=document.createElement('img');
  img.className='player-head';
  img.alt='';
  img.decoding='async';
  let i=0;
  const tryNext=()=>{
    if(el.dataset.avatarKey!==key)return;
    if(i>=urls.length)return;
    img.src=urls[i++];
  };
  img.addEventListener('load',()=>{
    if(el.dataset.avatarKey!==key)return;
    el.textContent='';
    if(!img.isConnected)el.appendChild(img);
  });
  img.addEventListener('error',tryNext);
  tryNext();
}
async function copyToClipboard(text){
  const value=String(text||'');
  if(!value)return false;
  try{
    if(navigator?.clipboard?.writeText){
      await navigator.clipboard.writeText(value);
      return true;
    }
  }catch{}
  try{
    const ta=document.createElement('textarea');
    ta.value=value;
    ta.setAttribute('readonly','');
    ta.style.position='fixed';
    ta.style.opacity='0';
    document.body.appendChild(ta);
    ta.select();
    const ok=document.execCommand('copy');
    ta.remove();
    return !!ok;
  }catch{
    return false;
  }
}
const toastRoot=$('toast-root')||(()=>{const el=document.createElement('div');el.id='toast-root';document.body.appendChild(el);return el;})();
function notify(message,type='info',timeout=3400){
  if(!message)return;
  const toast=document.createElement('div');
  toast.className='toast toast-'+type;
  toast.setAttribute('role','status');
  const msg=document.createElement('div');
  msg.className='toast-msg';
  msg.textContent=String(message);
  const close=document.createElement('button');
  close.type='button';
  close.className='toast-close';
  close.textContent='×';
  close.setAttribute('aria-label','Close');
  const dismiss=()=>{
    if(toast.classList.contains('is-closing'))return;
    toast.classList.add('is-closing');
    setTimeout(()=>toast.remove(),160);
  };
  close.addEventListener('click',dismiss);
  toast.appendChild(msg);
  toast.appendChild(close);
  toastRoot.appendChild(toast);
  setTimeout(dismiss,Math.max(1400,timeout|0));
}
function notifyError(error){notify(t('error.generic')+': '+(error||t('error.unknown')),'error',4800);}

let _confirmResolver=null;
function closeConfirmDialog(answer=false){
  const overlay=$('confirm-overlay');
  if(overlay)overlay.style.display='none';
  const done=_confirmResolver;
  _confirmResolver=null;
  if(done)done(!!answer);
}
function showConfirmDialog({title='',message='',confirmText='',cancelText='',danger=false}={}){
  return new Promise(resolve=>{
    if(_confirmResolver){
      _confirmResolver(false);
      _confirmResolver=null;
    }
    const overlay=$('confirm-overlay');
    const titleEl=$('confirm-title');
    const msgEl=$('confirm-msg');
    const okBtn=$('confirm-ok');
    const cancelBtn=$('confirm-cancel');
    if(!overlay||!titleEl||!msgEl||!okBtn||!cancelBtn){
      resolve(false);
      return;
    }
    _confirmResolver=resolve;
    titleEl.textContent=title||t('dialog.confirm_title');
    msgEl.textContent=String(message||'');
    okBtn.textContent=confirmText||t('dialog.confirm');
    cancelBtn.textContent=cancelText||t('dialog.cancel');
    okBtn.classList.toggle('btn-confirm-danger',!!danger);
    overlay.style.display='flex';
    okBtn.focus();
  });
}

function playMainIdleHtml(){
  return '<svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M8 5v14l11-7z"/></svg> '+t('pack.play');
}
function playPackIdleHtml(){
  return '<svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18"><path d="M6 4l12 6-12 6z"/></svg> '+t('pack.play');
}
function setKillButtonState(btnId, visible, disabled = false, labelKey = 'pack.kill'){
  const btn=$(btnId);
  if(!btn)return;
  btn.style.display=visible?'inline-flex':'none';
  btn.disabled=disabled;
  const labelText=t(labelKey);
  btn.title=labelText;
  btn.setAttribute('aria-label', labelText);
  const label=btn.querySelector('span');
  if(label)label.textContent=labelText;
}
function syncPlayPanelControls(){
  const playBtn=$('btn-play');
  if(!playBtn)return;
  if(runningGamePackId){
    isGameRunning=true;
    playBtn.disabled=true;
    playBtn.innerHTML='● '+t('status.running');
    setKillButtonState('btn-kill', true, false, 'pack.kill');
  }else{
    isGameRunning=false;
    playBtn.disabled=false;
    playBtn.innerHTML=playMainIdleHtml();
    setKillButtonState('btn-kill', false, false, 'pack.kill');
  }
}
function syncPackHeroControls(){
  const playBtn=$('pack-play-hero');
  if(!playBtn)return;
  if(runningGamePackId){
    packIsRunning=true;
    playBtn.disabled=true;
    playBtn.innerHTML='● '+t('status.running');
    setKillButtonState('pack-kill-hero', true, false, 'pack.kill');
  }else{
    packIsRunning=false;
    playBtn.disabled=false;
    playBtn.innerHTML=playPackIdleHtml();
    setKillButtonState('pack-kill-hero', false, false, 'pack.kill');
  }
}

// Window controls
$('btn-min').addEventListener('click',()=>px.win.minimize());
$('btn-max').addEventListener('click',()=>px.win.maximize());
$('btn-close').addEventListener('click',()=>px.win.close());

// Navigation
function showPage(name){
  // Fermer la page dédiée modpack si elle est ouverte — on revient à la navigation normale
  if($('pack-page').classList.contains('open')) closePackPage();
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  $('page-'+name)?.classList.add('active');
  document.querySelectorAll('[data-page="'+name+'"]').forEach(b=>b.classList.add('active'));
  if(name==='library'){loadLibrary().catch(()=>{});}
  if(name==='browse' && mrState.firstLoad){mrState.firstLoad=false; mrSearch();}
  px.rpc?.setPage?.(name).catch?.(()=>{});
}
document.querySelectorAll('.nav-btn, .account-mini').forEach(btn=>{
  btn.addEventListener('click',()=>{
    if (!btn.dataset.page) return;
    if (btn.dataset.page === 'browse') {
      mrState.targetInstanceId = '';
      mrState.installedByType = null;
    }
    showPage(btn.dataset.page);
  });
});

// ── Library ──────────────────────────────────────────────────────────────────
async function loadLibrary(){allPacks=await px.library.list();applyLibraryFilter();}
function applyLibraryFilter(){
  const q=($('inp-search')?.value||'').toLowerCase().trim();
  renderLibrary(q?allPacks.filter(p=>p.name.toLowerCase().includes(q)||p.mcVersion.includes(q)||p.modloader.includes(q)):allPacks);
}
function renderLibrary(packs){
  const grid=$('lib-grid'),empty=$('lib-empty'),count=$('lib-count'),n=packs.length;
  count.textContent=n?(n===1?t('lib.count',{n}):t('lib.count_plural',{n})):t('lib.empty.title');
  if(n===0){grid.style.display='none';empty.style.display='flex';return;}
  grid.style.display='grid';empty.style.display='none';
  grid.innerHTML=packs.map(p=>{
    const badge={forge:'badge-forge',neoforge:'badge-neoforge',fabric:'badge-fabric',quilt:'badge-quilt',vanilla:'badge-vanilla'}[p.modloader]||'badge-vanilla';
    const loaderName=getLoaderDisplayName(p.modloader);
    const last=p.lastPlayed?new Date(p.lastPlayed).toLocaleDateString():t('pack.never_played');
    const initials=esc(p.name.substring(0,2).toUpperCase());
    const bannerContent = p.iconData
      ? `<img src="${esc(p.iconData)}" alt="" class="lib-banner-img" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`
      : `<div class="card-letter">${initials}</div>`;
    const foregroundIcon = p.iconData
      ? `<div class="card-foreground-icon">
  <img src="${esc(p.iconData)}" alt="" class="lib-foreground-img">
  <span class="card-foreground-fallback" style="display:none">${initials}</span>
</div>`
      : `<div class="card-foreground-icon"><span class="card-foreground-fallback">${initials}</span></div>`;
    return `<div class="modpack-card" data-id="${esc(p.id)}">
<div class="card-banner">${bannerContent}
${foregroundIcon}
<span class="card-badge ${badge}">${loaderName}</span>
<button class="card-del" data-del="${esc(p.id)}"><svg viewBox="0 0 14 14" fill="none"><path d="M2 3.5h10M5 3.5V2.5h4v1M3 3.5l.8 8h6.4l.8-8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
<button class="card-gear" data-settings="${esc(p.id)}" title="${t('lib.card.settings')}"><svg viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2"/><path d="M7 1.5v1M7 11.5v1M1.5 7h1M11.5 7h1M3.1 3.1l.7.7M10.2 10.2l.7.7M10.2 3.8l-.7.7M3.8 10.2l-.7.7" stroke-linecap="round"/></svg></button></div>
<div class="card-body"><div class="card-name" title="${esc(p.name)}">${esc(p.name)}</div>
<div class="card-version">v${esc(p.version)} · MC ${esc(p.mcVersion)}</div>
<div class="card-meta">
<div class="card-meta-item"><svg viewBox="0 0 14 14" fill="none"><path d="M7 1l6 3v6l-6 3L1 10V4z"/></svg>${p.totalMods} mods</div>
<div class="card-meta-item"><svg viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5"/><path d="M7 4v3l2 1.5"/></svg>${last}</div>
${p.failedMods>0?`<div class="card-meta-item" style="color:var(--orange)">⚠ ${p.failedMods}</div>`:''}
</div></div>
<div class="card-overlay"><button class="card-play-circle" data-play="${esc(p.id)}"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button></div>
</div>`;
  }).join('');
  grid.querySelectorAll('.lib-banner-img').forEach(img=>{
    img.addEventListener('error',()=>{img.style.display='none';},{once:true});
  });
  grid.querySelectorAll('.lib-foreground-img').forEach(img=>{
    img.addEventListener('error',()=>{
      img.style.display='none';
      const fb=img.parentElement?.querySelector('.card-foreground-fallback');
      if(fb)fb.style.display='flex';
    },{once:true});
  });
  grid.querySelectorAll('[data-play]').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();const pack=allPacks.find(p=>p.id===btn.dataset.play);if(pack)openPlayPanel(pack);});});
  grid.querySelectorAll('[data-del]').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();const pack=allPacks.find(p=>p.id===btn.dataset.del);if(pack)deleteModpack(pack);});});
  grid.querySelectorAll('[data-settings]').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();const pack=allPacks.find(p=>p.id===btn.dataset.settings);if(pack)openPackPage(pack);});});
}
async function deleteModpack(pack){
  const ok=await showConfirmDialog({
    title:t('dialog.confirm_title'),
    message:t('delete.confirm',{name:pack.name}),
    confirmText:t('dialog.delete'),
    danger:true,
  });
  if(!ok)return;
  await px.library.delete(pack.id);if(currentPack?.id===pack.id)closePlayPanel();await loadLibrary();
}
$('inp-search').addEventListener('input',()=>applyLibraryFilter());
setInterval(()=>{
  if($('page-library')?.classList.contains('active') && !isInstalling){
    loadLibrary().catch(()=>{});
  }
}, 5000);

// ── Import ────────────────────────────────────────────────────────────────────
async function doImport(){
  if(isInstalling)return;const filePath=await px.modpack.pickFile();if(!filePath)return;
  isInstalling=true;openInstallModal(filePath);const result=await px.modpack.import(filePath);isInstalling=false;
  if(!result.ok){showModalError(result.error);return;}
  $('modal-close-btn').style.display='block';await loadLibrary();notify(t('install.done'),'success',2600);
}
$('btn-import').addEventListener('click',doImport);$('btn-import-empty').addEventListener('click',doImport);

// ── Modal ─────────────────────────────────────────────────────────────────────
const STEPS=['java','modloader','mods','overrides'];
function openInstallModal(filePath){
  $('modal-title').textContent=t('install.modal_title_file',{file:filePath.split(/[\\/]/).pop()});
  $('modal-overlay').style.display='flex';$('modal-close-btn').style.display='none';$('modal-log').innerHTML='';
  STEPS.forEach(s=>{$('istep-'+s)?.setAttribute('class','istep');const d=$('istep-'+s+'-detail');if(d)d.textContent=t('install.preparing');const p=$('istep-'+s+'-pct');if(p)p.textContent='';});
}
$('modal-close-btn').addEventListener('click',()=>{$('modal-overlay').style.display='none';});
function updateStep(step,pct,detail){
  if(step==='done'){STEPS.forEach(s=>{const e=$('istep-'+s);if(e)e.className='istep s-done';});return;}
  if(!STEPS.includes(step))return;
  const el=$('istep-'+step);if(el)el.className='istep s-active';
  if(detail){const d=$('istep-'+step+'-detail');if(d)d.textContent=detail;}
  if(pct>=0){const p=$('istep-'+step+'-pct');if(p)p.textContent=pct>0?pct+'%':'';}
}
function appendLog(msg){
  if(!msg?.trim())return;const el=$('modal-log');const line=document.createElement('div');
  if(msg.includes('✅')||msg.includes('✓'))line.style.color='var(--green)';
  else if(msg.includes('❌')||msg.toLowerCase().includes('erreur'))line.style.color='var(--red)';
  else if(msg.includes('⚠'))line.style.color='var(--orange)';
  else if(msg.startsWith('  ')||msg.includes('['))line.style.color='var(--cyan)';
  line.textContent=msg;el.appendChild(line);if(el.children.length>400)el.removeChild(el.firstChild);el.scrollTop=el.scrollHeight;
}
function showModalError(msg){notifyError(msg);$('modal-close-btn').style.display='block';}

// ── Play panel ────────────────────────────────────────────────────────────────
let ppCurrentFilter='all', ppAllFiles=[];

function openPlayPanel(pack){
  currentPack=pack;
  const panel=$('play-panel');
  panel.classList.remove('closing');panel.style.display='flex';
  $('pp-avatar').textContent=(pack.name[0]||'?').toUpperCase();
  $('pp-name').textContent=pack.name;$('pp-meta').textContent='v'+pack.version;
  $('pp-mc').textContent=pack.mcVersion;
  $('pp-loader').textContent=formatLoaderWithVersion(pack.modloader,pack.modloaderVersion);
  $('pp-mods').textContent=pack.totalMods+(pack.failedMods>0?' (⚠ '+pack.failedMods+')':'');
  $('pp-played').textContent=pack.lastPlayed?new Date(pack.lastPlayed).toLocaleDateString():t('pack.never_played');
  const statusBox=$('game-status-box');
  statusBox.style.display='none';
  const logEl=$('game-log');logEl.style.display='none';logEl.innerHTML='';
  syncPlayPanelControls();
  if(runningGamePackId){
    statusBox.style.display='block';
    statusBox.style.background='var(--green-bg)';
    statusBox.style.color='var(--green)';
    statusBox.style.border='1px solid rgba(16,185,129,.3)';
    statusBox.textContent=t('status.minecraft_launched',{pid:runningGamePid||'?'});
  }
  // Toujours démarrer sur l'onglet Jouer
  ppSwitchTab('play');
  // Charger les fichiers en arrière-plan pour l'onglet Contenu
  ppLoadFiles(pack);
}

function closePlayPanel(){
  const panel=$('play-panel');
  if(panel.style.display==='none'||panel.classList.contains('closing'))return;
  panel.classList.add('closing');
  const fn=(e)=>{if(e.animationName==='slideOutRight'){panel.style.display='none';panel.classList.remove('closing');currentPack=null;panel.removeEventListener('animationend',fn);}};
  panel.addEventListener('animationend',fn);
}
$('pp-close').addEventListener('click',closePlayPanel);
$('pp-close').addEventListener('mouseover',function(){this.style.background='rgba(255,255,255,.07)';this.style.color='var(--text0)';});
$('pp-close').addEventListener('mouseout',function(){this.style.background='none';this.style.color='var(--text1)';});

// Onglets
function ppSwitchTab(name){
  document.querySelectorAll('.pp-tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name));
  $('pp-tab-play').style.display=name==='play'?'flex':'none';
  $('pp-tab-details').style.display=name==='details'?'flex':'none';
  // Montrer/cacher le bouton expand
  $('pp-expand-btn').style.display=name==='details'?'flex':'none';
}
document.querySelectorAll('.pp-tab').forEach(btn=>{
  btn.addEventListener('click',()=>ppSwitchTab(btn.dataset.tab));
});

// ── Fullscreen content overlay ────────────────────────────────────────────────
let coCurrentFilter='all';

$('pp-expand-btn').addEventListener('click',()=>openContentOverlay());
$('co-close').addEventListener('click',()=>closeContentOverlay());
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeContentOverlay();});

function openContentOverlay(){
  if(!currentPack||!ppAllFiles.length)return;
  $('co-title').textContent=currentPack.name;
  $('co-sub').textContent='v'+currentPack.version+' · MC '+currentPack.mcVersion+' · '+currentPack.modloader;
  coCurrentFilter='all';
  // Sync filter buttons to "Tous"
  document.querySelectorAll('[data-cofilter]').forEach(b=>b.classList.toggle('active',b.dataset.cofilter==='all'));
  $('co-search').value='';
  // Show/hide resolve button
  const numericPattern=/^\d+-\d+(\.jar)?$/;
  const hasNumeric=ppAllFiles.some(f=>numericPattern.test(f.filename||f.name));
  $('co-resolve-btn').style.display=hasNumeric?'flex':'none';
  renderOverlay();
  $('content-overlay').classList.add('open');
}

function closeContentOverlay(){
  $('content-overlay').classList.remove('open');
}

function renderOverlay(){
  const filter=coCurrentFilter;
  const search=($('co-search').value||'').toLowerCase().trim();
  const TYPE_COLORS={mod:'#8B5CF6',shader:'#F59E0B',resourcepack:'#3B82F6',config:'#64748B',other:'#334155'};
  const TYPE_LABELS={mod:'MOD',shader:'SHD',resourcepack:'RES',config:'CFG',other:'?'};

  const shown=ppAllFiles.filter(f=>{
    if(filter!=='all'&&f.type!==filter)return false;
    const viewName=String(f.prettyName||f.name||'').toLowerCase();
    if(search&&!viewName.includes(search)&&!(f.filename||'').toLowerCase().includes(search))return false;
    return true;
  });

  // Stats bar
  const counts={};
  ppAllFiles.forEach(f=>{counts[f.type]=(counts[f.type]||0)+1;});
  const statLabels={mod:t('pack.content.filter.mod'),shader:t('pack.content.filter.shader'),resourcepack:t('pack.content.filter.res'),config:t('pack.content.filter.config'),other:'?'};
  $('co-stats').innerHTML=Object.entries(counts).map(([t,n])=>
    `<div class="co-stat"><span class="co-stat-count">${n}</span><span>${statLabels[t]||t}</span></div>`
  ).join('')+`<div class="co-stat" style="margin-left:auto;color:var(--text2)">${shown.length} / ${ppAllFiles.length}</div>`;

  if(shown.length===0){$('co-grid').innerHTML='';$('co-empty').style.display='block';return;}
  $('co-empty').style.display='none';

  $('co-grid').innerHTML=shown.map(f=>{
    const color=TYPE_COLORS[f.type]||TYPE_COLORS.other;
    const label=TYPE_LABELS[f.type]||'?';
    const size=f.size?formatBytes(f.size):'';
    const modAttr=f.type==='mod'?` data-modname="${esc(f.prettyName||f.name)}" data-modfile="${esc(f.filename||f.name)}"`: '';
    return `<div class="co-file-card"${modAttr}>
<div class="co-file-icon" style="background:${color}22;color:${color}">${label}</div>
<div class="co-file-info">
<div class="co-file-name" title="${esc(f.prettyName||f.name)}">${esc(f.prettyName||f.name)}</div>
${f.filename&&f.filename!==(f.prettyName||f.name)?`<div class="co-file-meta">${esc(f.filename)}${size?' · '+size:''}</div>`
:size?`<div class="co-file-meta">${size}</div>`:''}
</div></div>`;
  }).join('');

  // Async icon enrichment for mods
  if(shown.some(f=>f.type==='mod')) enrichModIcons($('co-grid'));
}

// Filtres overlay
document.querySelectorAll('[data-cofilter]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('[data-cofilter]').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    coCurrentFilter=btn.dataset.cofilter;
    renderOverlay();
  });
});
$('co-search').addEventListener('input',()=>renderOverlay());

$('co-resolve-btn').addEventListener('click',async function(){
  if(!currentPack)return;
  this.textContent=t('pack.content.resolve_working');this.disabled=true;
  const result=await px.modpack.resolveNames(currentPack.id);
  this.disabled=false;
  if(result.ok){
    this.textContent=result.resolved>0?t('pack.content.resolve_done',{n:result.resolved}):t('pack.content.resolve_uptodate');
    this.style.color='var(--green)';this.style.borderColor='var(--green)';
    // Recharger fichiers
    await ppLoadFiles(currentPack);
    renderOverlay();
    setTimeout(()=>{this.style.display='none';},2000);
  } else {
    this.textContent=t('pack.content.resolve_error');
  }
});

// Filtres type fichiers
document.querySelectorAll('.pp-filter-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.pp-filter-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    ppCurrentFilter=btn.dataset.filter;
    ppRenderFiles();
  });
});
$('pp-file-search').addEventListener('input',()=>ppRenderFiles());

// Catégoriser un fichier par extension/dossier
function ppCategorizeFile(name, dir){
  const n=name.toLowerCase(), d=(dir||'').toLowerCase();
  if(d.includes('shader')||n.endsWith('.vsh')||n.endsWith('.fsh')||n.endsWith('.glsl'))return'shader';
  if(d.includes('resourcepack')||d.includes('resource_pack')||d.includes('texturepacks'))return'resourcepack';
  if(d.includes('config')||n.endsWith('.cfg')||n.endsWith('.toml')||n.endsWith('.json')&&d.includes('config'))return'config';
  if(n.endsWith('.jar'))return'mod';
  return'other';
}

const TYPE_COLORS={mod:'#8B5CF6',shader:'#F59E0B',resourcepack:'#3B82F6',config:'#64748B',other:'#334155'};
const TYPE_LABELS={mod:'MOD',shader:'SHD',resourcepack:'RES',config:'CFG',other:'?'};

async function ppLoadFiles(pack){
  ppAllFiles=[];
  $('pp-info-rows').innerHTML='';
  $('pp-resolve-row').style.display='none';
  const rows=[
    [t('pack.info.name'),pack.name],[t('pack.info.version'),'v'+pack.version],
    [t('pack.info.mc'),pack.mcVersion],[t('pack.info.loader'),formatLoaderWithVersion(pack.modloader,pack.modloaderVersion)],
    [t('pack.info.mods'),pack.totalMods],
  ];
  $('pp-info-rows').innerHTML=rows.map(([l,v])=>
    `<span class="pp-info-label">${esc(l)}</span><span class="pp-info-value" title="${esc(String(v))}">${esc(String(v))}</span>`
  ).join('');

  try {
    const files=await px.config.get('__instanceFiles__:'+pack.id);
    if(Array.isArray(files)){ppAllFiles=preprocessInstanceFiles(files);}
  } catch(e){ppAllFiles=[];}

  // Détecter les noms numériques (projectID-fileID.jar non résolus)
  const numericPattern=/^\d+-\d+(\.jar)?$/;
  const hasNumeric=ppAllFiles.some(f=>numericPattern.test(f.filename||f.name));
  if(hasNumeric) $('pp-resolve-row').style.display='flex';

  ppRenderFiles();
}

$('pp-resolve-btn').addEventListener('click',async function(){
  if(!currentPack)return;
  this.textContent=t('pack.content.resolve_working');this.disabled=true;
  const result=await px.modpack.resolveNames(currentPack.id);
  this.disabled=false;
  if(result.ok){
    this.textContent=result.resolved>0?t('pack.content.resolve_done',{n:result.resolved}):t('pack.content.resolve_uptodate');
    this.style.color='var(--green)';this.style.borderColor='var(--green)';
    // Recharger les fichiers pour afficher les nouveaux noms
    setTimeout(()=>ppLoadFiles(currentPack),400);
  } else {
    this.textContent=t('pack.content.resolve_error');
  }
});

function ppRenderFiles(){
  const filter=ppCurrentFilter;
  const search=($('pp-file-search').value||'').toLowerCase().trim();
  const list=$('pp-files-list');
  const empty=$('pp-files-empty');

  const shown=ppAllFiles.filter(f=>{
    if(filter!=='all'&&f.type!==filter)return false;
    const viewName = String(f.prettyName || f.name || '').toLowerCase();
    const fileName = String(f.filename || '').toLowerCase();
    if(search && !viewName.includes(search) && !fileName.includes(search))return false;
    return true;
  });

  if(shown.length===0){list.innerHTML='';empty.style.display='block';return;}
  empty.style.display='none';

  list.innerHTML=shown.map(f=>{
    const color=TYPE_COLORS[f.type]||TYPE_COLORS.other;
    const label=TYPE_LABELS[f.type]||'?';
    const size=f.size?formatBytes(f.size):'';
    return `<div class="pp-file-item">
<div class="pp-file-icon" style="background:${color}22;color:${color}">${label}</div>
<div class="pp-file-name" title="${esc(f.prettyName||f.name)}">${esc(f.prettyName||f.name)}</div>
${size?`<div class="pp-file-size">${size}</div>`:''}
</div>`;
  }).join('');
}

function formatBytes(b){
  if(b<1024)return b+'B';
  if(b<1048576)return(b/1024).toFixed(0)+'KB';
  return(b/1048576).toFixed(1)+'MB';
}

// ── Mod icon enrichment ───────────────────────────────────────────────────────
// Cache to avoid redundant API calls within a session
const _modIconCache = {};

async function enrichModIcons(container) {
  const cards = [...container.querySelectorAll('[data-modname]')];
  if (!cards.length) return;

  // Batch: collect unique mod names, skip cached ones
  const toFetch = [];
  const seen = new Set();
  for (const card of cards) {
    const name = card.dataset.modname;
    if (!seen.has(name) && !_modIconCache[name]) {
      seen.add(name);
      toFetch.push(name);
    }
  }

  // Fetch in batches of 8 to avoid hammering the API
  for (let i = 0; i < toFetch.length; i += 8) {
    const chunk = toFetch.slice(i, i + 8);
    await Promise.allSettled(chunk.map(async (modName) => {
      try {
        // Clean name: strip version numbers and common suffixes from jar filename
        const cleaned = modName
          .replace(/[-_][0-9]+\.[0-9]+.*/,'')
          .replace(/\.(jar|zip)$/i,'')
          .replace(/[-_](forge|fabric|neoforge|quilt|mc|minecraft).*/i,'')
          .trim();
        if (!cleaned || cleaned.length < 2) { _modIconCache[modName] = null; return; }

        const result = await px.modrinth.search({
          query: cleaned, type: 'mod', limit: 3, sort: 'relevance',
        });
        const hits = result?.hits || [];
        // Pick hit whose slug or title best matches
        const lc = cleaned.toLowerCase();
        const best = hits.find(h =>
          h.slug.toLowerCase() === lc ||
          h.title.toLowerCase() === lc ||
          h.title.toLowerCase().startsWith(lc)
        ) || (hits.length ? hits[0] : null);

        _modIconCache[modName] = best?.icon_url || null;
      } catch { _modIconCache[modName] = null; }
    }));

    // After each batch, update all matching cards in the container
    for (const card of cards) {
      const name = card.dataset.modname;
      const iconUrl = _modIconCache[name];
      if (!iconUrl) continue;
      const iconEl = card.querySelector('.co-file-icon, .pp-content-icon');
      if (iconEl && !iconEl.querySelector('img')) {
        const fallbackLabel = (iconEl.textContent || 'MOD').trim();
        iconEl.innerHTML = `<img src="${esc(iconUrl)}" alt="" class="mod-content-icon-img">`;
        iconEl.style.background = 'transparent';
        iconEl.style.padding = '0';
        const img = iconEl.querySelector('img');
        if (img) {
          img.addEventListener('error', () => {
            iconEl.textContent = fallbackLabel || 'MOD';
            iconEl.style.background = '';
            iconEl.style.padding = '';
          }, { once: true });
        }
      }
    }
  }
}

$('btn-play').addEventListener('click',async function(){
  if(!currentPack||isGameRunning)return;
  const btn=this;btn.disabled=true;btn.textContent=t('auth.logging_in');
  const result=await px.game.launch(currentPack.id);
  if(!result.ok){
    syncPlayPanelControls();
    const sb=$('game-status-box');sb.style.display='block';sb.style.background='var(--red-bg)';sb.style.color='var(--red)';sb.style.border='1px solid rgba(244,63,94,.3)';sb.textContent=t('modal.error_prefix')+' '+result.error;return;
  }
  isGameRunning=true;btn.disabled=false;btn.innerHTML='● '+t('status.running');
  runningGamePackId=currentPack.id;
  runningGamePid=result.pid||null;
  syncPlayPanelControls();
  syncPackHeroControls();
  const sb=$('game-status-box');sb.style.display='block';sb.style.background='var(--green-bg)';sb.style.color='var(--green)';sb.style.border='1px solid rgba(16,185,129,.3)';sb.textContent=t('status.minecraft_launched',{pid:result.pid});
  const logEl=$('game-log');logEl.style.display='block';
  gameLogCb=data=>{const l=document.createElement('div');l.textContent=data.replace(/\n$/,'');logEl.appendChild(l);if(logEl.children.length>500)logEl.removeChild(logEl.firstChild);logEl.scrollTop=logEl.scrollHeight;};
  gameCloseCb=({code})=>{
    isGameRunning=false;
    runningGamePackId=null;
    runningGamePid=null;
    if(gameLogCb){px.off('game:log',gameLogCb);gameLogCb=null;}
    if(gameCloseCb){px.off('game:closed',gameCloseCb);gameCloseCb=null;}
    syncPlayPanelControls();
    syncPackHeroControls();
    const s=$('game-status-box');
    if(s){
      s.style.display='block';
      s.style.background='var(--bg2)';
      s.style.color='var(--text1)';
      s.style.border='1px solid var(--border)';
      s.textContent=t('status.stopped_code',{code});
    }
    loadLibrary();
  };
  px.on('game:log',gameLogCb);px.on('game:closed',gameCloseCb);
});

// ── Pack Page ────────────────────────────────────────────────────────────────
$('btn-kill').addEventListener('click',async function(){
  if(!runningGamePackId)return;
  setKillButtonState('btn-kill',true,true,'pack.killing');
  setKillButtonState('pack-kill-hero',!!runningGamePackId,true,'pack.killing');
  const result=await px.game.kill();
  if(!result?.ok){
    setKillButtonState('btn-kill',true,false,'pack.kill');
    setKillButtonState('pack-kill-hero',!!runningGamePackId,false,'pack.kill');
    notifyError(result?.error||t('error.unknown'));
    return;
  }
  const sb=$('game-status-box');
  sb.style.display='block';
  sb.style.background='rgba(245,158,11,.1)';
  sb.style.color='var(--orange)';
  sb.style.border='1px solid rgba(245,158,11,.35)';
  sb.textContent=t('status.kill_sent');
});

let packPagePack = null;
let packPageFilter = 'all';
let packPageFiles = [];
let packLogPath = null;
let packIsRunning = false;
let packGameLogCb = null;
let packGameCloseCb = null;

const TYPE_COLORS_PP = {mod:'#8B5CF6',shader:'#F59E0B',resourcepack:'#3B82F6',config:'#64748B',other:'#334155'};
const TYPE_LABELS_PP = {mod:'MOD',shader:'SHD',resourcepack:'RES',config:'CFG',other:'?'};

async function openPackPage(pack) {
  packPagePack = pack;
  packIsRunning = !!runningGamePackId;
  packPageFilter = 'all';

  // Navigate tabs to first
  document.querySelectorAll('.pp-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.pptab === 'overview'));
  document.querySelectorAll('.pp-tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pptab-overview'));

  // Hero
  const heroImg = $('pack-hero-img');
  const displayName = pack.customName || pack.name;
  heroImg.style.backgroundImage = pack.iconData ? `url('${pack.iconData}')` : '';
  $('pack-hero-name').textContent = displayName;
  $('pack-hero-sub').textContent = `v${pack.version} · MC ${pack.mcVersion} · ${formatLoaderWithVersion(pack.modloader,pack.modloaderVersion)}`;

  // Icon element
  const iconEl = $('pack-icon-el');
  if (pack.iconData) {
    iconEl.innerHTML = `<img class="pp-hero-icon" src="${pack.iconData}" alt="">`;
  } else {
    iconEl.innerHTML = `<div class="pp-hero-icon-placeholder">${esc((displayName[0]||'?').toUpperCase())}</div>`;
  }

  // Stats
  $('pack-stat-mc').textContent = pack.mcVersion;
  $('pack-stat-loader').textContent = formatLoaderWithVersion(pack.modloader,pack.modloaderVersion);
  $('pack-stat-mods').textContent = pack.totalMods + (pack.failedMods > 0 ? ` (⚠ ${pack.failedMods})` : '');
  $('pack-stat-played').textContent = pack.lastPlayed ? new Date(pack.lastPlayed).toLocaleDateString() : t('pack.never_played');
  $('pack-stat-format').textContent = (pack.format || '?').toUpperCase();
  $('pack-stat-added').textContent = pack.addedAt ? new Date(pack.addedAt).toLocaleDateString() : '—';

  // Failed mods
  const failedList = $('pack-failed-list');
  if (pack.failedModsList?.length) {
    failedList.style.display = 'block';
    $('pack-failed-items').textContent = pack.failedModsList.map(f => `${f.dest || f.url} — ${f.error}`).join('\n');
  } else {
    failedList.style.display = 'none';
  }

  // Status/log reset
  const sb = $('pack-status-box');
  sb.style.display = 'none';
  const gl = $('pack-game-log');
  gl.style.display = 'none'; gl.innerHTML = '';
  syncPackHeroControls();
  if(runningGamePackId){
    sb.style.display='block';
    sb.style.background='var(--green-bg)';
    sb.style.color='var(--green)';
    sb.style.borderColor='rgba(16,185,129,.3)';
    sb.textContent=t('status.minecraft_launched',{pid:runningGamePid||'?'});
  }

  // Load content files
  packPageFiles = [];
  try {
    const files = await px.config.get('__instanceFiles__:' + pack.id);
    if (Array.isArray(files)) packPageFiles = preprocessInstanceFiles(files);
  } catch {}

  // Check numeric names
  const numericPat = /^\d+-\d+(\.jar)?$/;
  const hasNumeric = packPageFiles.some(f => numericPat.test(f.filename || f.name));
  $('pack-resolve-row').style.display = hasNumeric ? 'flex' : 'none';

  packRenderContent();

  // Settings tab pre-fill
  $('pack-custom-name').value = pack.customName || '';
  $('pack-notes').value = pack.notes || '';
  const packRamMax = _systemRamGB > 0 ? Math.max(1, Math.floor(_systemRamGB)) : 32;
  $('pack-ram').max = packRamMax;
  const packRam = pack.ram || 0;
  const safePackRam = Math.max(0, Math.min(packRam, packRamMax));
  $('pack-ram').value = safePackRam;
  $('pack-ram-val').textContent = safePackRam > 0 ? safePackRam + ' GB' : t('pack.settings.ram_global');
  const packRamSystemInfo = $('pack-ram-system-info');
  if (packRamSystemInfo && _systemRamGB) {
    packRamSystemInfo.textContent = t('pack.settings.ram_system', { n: _systemRamGB });
  }
  updatePackRamWarning(safePackRam);
  updatePackIconPreview(pack);

  // Load log files list
  packLoadLogFiles();

  // Show the page
  $('pack-page').classList.add('open');
}

function closePackPage() {
  $('pack-page').classList.remove('open');
  packPagePack = null;
  if (packGameLogCb) { px.off('game:log', packGameLogCb); packGameLogCb = null; }
  if (packGameCloseCb) { px.off('game:closed', packGameCloseCb); packGameCloseCb = null; }
}

// Back button
$('pack-back').addEventListener('click', () => {
  closePackPage();
  loadLibrary();
});

$('pack-add-content').addEventListener('click', async () => {
  if (!packPagePack) return;
  await openBrowseForInstance(packPagePack);
});

// Tab navigation
document.querySelectorAll('.pp-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.pp-nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.pp-tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    $('pptab-' + btn.dataset.pptab)?.classList.add('active');
  });
});

// ── Launch from pack page ─────────────────────────────────────────────────────
$('pack-play-hero').addEventListener('click', async function() {
  if (!packPagePack || packIsRunning) return;
  const btn = this;
  btn.disabled = true; btn.textContent = t('auth.logging_in');

  const result = await px.game.launch(packPagePack.id);
  if (!result.ok) {
    syncPackHeroControls();
    const sb = $('pack-status-box');
    sb.style.display = 'block'; sb.style.background = 'var(--red-bg)';
    sb.style.color = 'var(--red)'; sb.style.borderColor = 'rgba(244,63,94,.3)';
    sb.textContent = t('modal.error_prefix') + ' ' + result.error;
    return;
  }

  runningGamePackId = packPagePack.id;
  runningGamePid = result.pid || null;
  packIsRunning = true;
  syncPlayPanelControls();
  syncPackHeroControls();
  const sb = $('pack-status-box');
  sb.style.display = 'block'; sb.style.background = 'var(--green-bg)';
  sb.style.color = 'var(--green)'; sb.style.borderColor = 'rgba(16,185,129,.3)';
  sb.textContent = t('status.minecraft_launched',{pid:result.pid});

  // Switch to logs tab and show live log
  document.querySelectorAll('.pp-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.pptab === 'logs'));
  document.querySelectorAll('.pp-tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pptab-logs'));
  const liveSection = $('pack-live-log-section');
  const liveLog = $('pack-live-log');
  liveSection.style.display = 'block'; liveLog.innerHTML = '';

  packGameLogCb = data => {
    const lines = data.split('\n').filter(l => l.trim());
    lines.forEach(line => {
      const div = document.createElement('div');
      div.className = colorizeLogLine(line);
      div.textContent = line;
      liveLog.appendChild(div);
    });
    if (liveLog.children.length > 800) liveLog.removeChild(liveLog.firstChild);
    liveLog.scrollTop = liveLog.scrollHeight;
  };

  packGameCloseCb = ({ code }) => {
    packIsRunning = false;
    runningGamePackId = null;
    runningGamePid = null;
    if (packGameLogCb) { px.off('game:log', packGameLogCb); packGameLogCb = null; }
    if (packGameCloseCb) { px.off('game:closed', packGameCloseCb); packGameCloseCb = null; }
    syncPackHeroControls();
    syncPlayPanelControls();
    sb.textContent = t('status.stopped_code',{code});
    loadLibrary();
    // Reload log files list after game closes
    setTimeout(() => packLoadLogFiles(), 1000);
  };

  px.on('game:log', packGameLogCb);
  px.on('game:closed', packGameCloseCb);
});

// ── Content tab ───────────────────────────────────────────────────────────────
$('pack-kill-hero').addEventListener('click', async function() {
  if (!runningGamePackId) return;
  setKillButtonState('pack-kill-hero', true, true, 'pack.killing');
  setKillButtonState('btn-kill', true, true, 'pack.killing');
  const result = await px.game.kill();
  if (!result?.ok) {
    setKillButtonState('pack-kill-hero', true, false, 'pack.kill');
    setKillButtonState('btn-kill', !!runningGamePackId, false, 'pack.kill');
    notifyError(result?.error || t('error.unknown'));
    return;
  }
  const sb = $('pack-status-box');
  sb.style.display = 'block';
  sb.style.background = 'rgba(245,158,11,.1)';
  sb.style.color = 'var(--orange)';
  sb.style.borderColor = 'rgba(245,158,11,.35)';
  sb.textContent = t('status.kill_sent');
});

document.querySelectorAll('[data-packfilter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-packfilter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    packPageFilter = btn.dataset.packfilter;
    packRenderContent();
  });
});

$('pack-content-search').addEventListener('input', () => packRenderContent());

function packRenderContent() {
  const search = ($('pack-content-search').value || '').toLowerCase().trim();
  const shown = packPageFiles.filter(f => {
    if (packPageFilter !== 'all' && f.type !== packPageFilter) return false;
    const viewName = String(f.prettyName || f.name || '').toLowerCase();
    const fileName = String(f.filename || '').toLowerCase();
    if (search && !viewName.includes(search) && !fileName.includes(search)) return false;
    return true;
  });

  // Stats
  const counts = {};
  packPageFiles.forEach(f => { counts[f.type] = (counts[f.type] || 0) + 1; });
  const statLabels = {
    mod: t('pack.content.stats.mod'),
    shader: t('pack.content.stats.shader'),
    resourcepack: t('pack.content.stats.resourcepack'),
    config: t('pack.content.stats.config'),
    other: t('pack.content.stats.other'),
  };
  $('pack-content-stats').innerHTML = Object.entries(counts)
    .map(([t, n]) => `<span style="color:var(--text0);font-weight:600">${n}</span> ${statLabels[t] || t}`)
    .join(' &nbsp;·&nbsp; ') + (shown.length !== packPageFiles.length ? ` &nbsp;·&nbsp; <span style="color:var(--cyan)">${t('pack.content.stats.shown',{n:shown.length})}</span>` : '');

  const grid = $('pack-content-grid');
  const empty = $('pack-content-empty');

  if (shown.length === 0) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  grid.innerHTML = shown.map(f => {
    const color = TYPE_COLORS_PP[f.type] || TYPE_COLORS_PP.other;
    const label = TYPE_LABELS_PP[f.type] || '?';
    const size = f.size ? formatBytes(f.size) : '';
    const modAttr = f.type === 'mod' ? ` data-modname="${esc(f.prettyName||f.name)}" data-modfile="${esc(f.filename||f.name)}"` : '';
    return `<div class="pp-content-card"${modAttr}>
<div class="pp-content-icon" style="background:${color}22;color:${color}">${label}</div>
<div class="pp-content-main">
<div class="pp-content-name" title="${esc(f.prettyName||f.name)}">${esc(f.prettyName||f.name)}</div>
${f.filename && f.filename !== (f.prettyName||f.name) ? `<div class="pp-content-meta">${esc(f.filename)}${size ? ' · ' + size : ''}</div>` : size ? `<div class="pp-content-meta">${size}</div>` : ''}
</div></div>`;
  }).join('');

  if (shown.some(f => f.type === 'mod')) enrichModIcons(grid);
}

$('pack-resolve-btn').addEventListener('click', async function() {
  if (!packPagePack) return;
  this.textContent = t('pack.content.resolve_working'); this.disabled = true;
  const result = await px.modpack.resolveNames(packPagePack.id);
  this.disabled = false;
  if (result.ok) {
    this.textContent = result.resolved > 0 ? t('pack.content.resolve_done',{n:result.resolved}) : t('pack.content.resolve_uptodate');
    this.style.color = 'var(--green)'; this.style.borderColor = 'var(--green)';
    const files = await px.config.get('__instanceFiles__:' + packPagePack.id);
    if (Array.isArray(files)) packPageFiles = preprocessInstanceFiles(files);
    packRenderContent();
    setTimeout(() => { $('pack-resolve-row').style.display = 'none'; }, 2000);
  } else {
    this.textContent = t('pack.content.resolve_error');
  }
});

// ── Logs tab ──────────────────────────────────────────────────────────────────
async function packLoadLogFiles() {
  const logFiles = await px.logs.list(packPagePack.id);
  const container = $('pack-log-files');

  if (!logFiles.length) {
    container.innerHTML = '<span style="font-size:12px;color:var(--text2)">'+t('pack.logs.select')+'</span>';
    return;
  }

  const typeIcon = {
    latest: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13"><rect x="1" y="1" width="12" height="12" rx="1"/><path d="M3 5h8M3 8h5"/></svg>',
    fml:    '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13"><path d="M2 2h10v10H2zM5 2v10M2 6h8"/></svg>',
    crash:  '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13"><circle cx="7" cy="7" r="5"/><path d="M7 4v4M7 9.5v.5"/></svg>',
  };

  container.innerHTML = logFiles.map((lf, i) => {
    const icon = typeIcon[lf.type] || typeIcon.latest;
    const sizeStr = formatBytes(lf.size);
    return `<button class="pp-log-file-btn ${i === 0 ? 'active' : ''}" data-logpath="${esc(lf.path)}">
${icon} ${esc(lf.name)} <span style="font-size:10px;color:var(--text2);font-family:var(--mono)">${sizeStr}</span>
</button>`;
  }).join('');

  container.querySelectorAll('[data-logpath]').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('[data-logpath]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      packReadLog(btn.dataset.logpath);
    });
  });

  // Auto-load first
  if (logFiles.length) packReadLog(logFiles[0].path);
}

async function packReadLog(logPath) {
  packLogPath = logPath;
  const viewer = $('pack-log-viewer');
  viewer.innerHTML = '<div style="color:var(--text2);padding:20px;text-align:center">'+t('pack.logs.loading')+'</div>';
  const content = await px.logs.read(packPagePack.id, logPath);
  if (!content) { viewer.innerHTML = '<div style="color:var(--text2);padding:20px;text-align:center">'+t('pack.logs.read_error')+'</div>'; return; }

  const lines = content.split('\n');
  $('pack-log-lines').textContent = t('pack.logs.lines',{n:lines.length});

  // Build colored HTML
  const fragment = document.createDocumentFragment();
  lines.forEach(line => {
    if (!line) return;
    const div = document.createElement('div');
    div.className = colorizeLogLine(line);
    div.textContent = line;
    fragment.appendChild(div);
  });
  viewer.innerHTML = '';
  viewer.appendChild(fragment);
  viewer.scrollTop = viewer.scrollHeight;
}

function colorizeLogLine(line) {
  if (!line) return '';
  const u = line.toUpperCase();
  if (u.includes('[ERROR]') || u.includes('ERROR:') || u.includes('EXCEPTION') || u.includes('FATAL')) return 'log-ERROR';
  if (u.includes('[WARN]') || u.includes('WARNING')) return 'log-WARN';
  if (u.includes('[DEBUG]') || u.includes('DEBUG:')) return 'log-DEBUG';
  if (u.includes('✅') || u.includes('✓') || u.includes('SUCCESS') || u.includes('DONE')) return 'log-SUCCESS';
  if (u.includes('[INFO]') && (u.includes('LOADING') || u.includes('LOADED') || u.includes('REGISTERING'))) return 'log-LOADING';
  if (/\[[\w\s/-]+(?:THREAD|WORKER|POOL)/i.test(line)) return 'log-THREAD';
  if (u.includes('[INFO]')) return 'log-INFO';
  return 'log-INFO';
}

$('pack-log-copy').addEventListener('click', () => {
  const viewer = $('pack-log-viewer');
  const text = Array.from(viewer.children).map(d => d.textContent).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    const btn = $('pack-log-copy');
    btn.textContent = t('pack.logs.copied_button');
    setTimeout(() => { btn.innerHTML = '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13"><rect x="4" y="4" width="8" height="8" rx="1"/><path d="M2 10V2h8"/></svg> '+t('pack.logs.copy'); }, 1500);
  });
});

$('pack-log-clear').addEventListener('click', () => {
  $('pack-log-viewer').innerHTML = '';
  $('pack-log-lines').textContent = '';
});

// ── Settings tab ──────────────────────────────────────────────────────────────
function updatePackRamWarning(ramGB) {
  const warn = $('pack-ram-warning');
  if (!warn) return;
  if (!_systemRamGB || _systemRamGB === 0) { warn.style.display = 'none'; return; }
  if (!ramGB || ramGB <= 0) { warn.style.display = 'none'; return; }
  const ratio = ramGB / _systemRamGB;
  const leftGB = (_systemRamGB - ramGB).toFixed(1);
  if (ratio >= 0.9) {
    warn.style.display = 'block';
    warn.style.background = 'rgba(244,63,94,.1)';
    warn.style.borderColor = 'rgba(244,63,94,.4)';
    warn.style.color = 'var(--red)';
    warn.textContent = t('pack.settings.ram_warning_high', { left: leftGB });
  } else if (ratio >= 0.75) {
    warn.style.display = 'block';
    warn.style.background = 'rgba(245,158,11,.1)';
    warn.style.borderColor = 'rgba(245,158,11,.3)';
    warn.style.color = 'var(--orange)';
    warn.textContent = t('pack.settings.ram_warning_medium', { left: leftGB });
  } else {
    warn.style.display = 'none';
  }
}

$('pack-ram').addEventListener('input', function() {
  const max = parseInt(this.max, 10) || 32;
  const raw = parseInt(this.value, 10) || 0;
  const safe = Math.max(0, Math.min(raw, max));
  if (safe !== raw) this.value = String(safe);
  $('pack-ram-val').textContent = safe > 0 ? safe + ' GB' : t('pack.settings.ram_global');
  updatePackRamWarning(safe);
});

let packIconDataPending = null;

$('pack-icon-pick').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif';
  input.onchange = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      packIconDataPending = ev.target.result;
      const preview = $('pack-settings-icon');
      preview.innerHTML = `<img src="${packIconDataPending}" style="width:80px;height:80px;border-radius:14px;object-fit:cover">`;
    };
    reader.readAsDataURL(file);
  };
  input.click();
});

$('pack-icon-reset').addEventListener('click', () => {
  packIconDataPending = null;
  if (packPagePack) updatePackIconPreview({ iconData: null, name: packPagePack.name });
});

function updatePackIconPreview(pack) {
  const preview = $('pack-settings-icon');
  const src = packIconDataPending || pack.iconData;
  if (src) {
    preview.innerHTML = `<img src="${src}" style="width:80px;height:80px;border-radius:14px;object-fit:cover">`;
  } else {
    preview.textContent = (pack.customName || pack.name || '?')[0].toUpperCase();
  }
}

$('pack-save-settings').addEventListener('click', async function() {
  if (!packPagePack) return;
  this.disabled = true;

  const fields = {
    customName: $('pack-custom-name').value.trim() || null,
    notes:      $('pack-notes').value.trim(),
    ram:        (() => {
      const max = parseInt($('pack-ram').max, 10) || 32;
      const value = parseInt($('pack-ram').value, 10) || 0;
      return Math.max(0, Math.min(value, max));
    })(),
    iconData:   packIconDataPending !== null ? packIconDataPending : packPagePack.iconData,
  };

  const updated = await px.library.update(packPagePack.id, fields);
  if (updated) {
    packPagePack = { ...packPagePack, ...fields };
    // Refresh hero
    const displayName = fields.customName || packPagePack.name;
    $('pack-hero-name').textContent = displayName;
    if (fields.iconData) {
      $('pack-hero-img').style.backgroundImage = `url('${fields.iconData}')`;
      $('pack-icon-el').innerHTML = `<img class="pp-hero-icon" src="${fields.iconData}" alt="">`;
    }
    packIconDataPending = null;
  }

  this.disabled = false;
  $('pack-save-confirm').style.display = 'inline';
  setTimeout(() => { $('pack-save-confirm').style.display = 'none'; }, 2000);
});

$('pack-open-folder').addEventListener('click', () => {
  if (packPagePack?.gameDir) px.shell.open(packPagePack.gameDir);
});

$('pack-delete-btn').addEventListener('click', async () => {
  if (!packPagePack) return;
  const ok=await showConfirmDialog({
    title:t('dialog.confirm_title'),
    message:t('delete.confirm_full',{name:packPagePack.customName || packPagePack.name}),
    confirmText:t('dialog.delete'),
    danger:true,
  });
  if(!ok)return;
  await px.library.delete(packPagePack.id);
  closePackPage();
  await loadLibrary();
});

// ── Auth ──────────────────────────────────────────────────────────────────────
async function refreshAuth(){
  const profile=await px.auth.status();
  const cfg=await px.config.get('settings').catch(()=>null);
  const forceOffline=!!cfg?.forceOffline;
  if(profile){
    setPlayerAvatar($('acct-avatar'),profile);$('acct-name').textContent=profile.name;
    $('acct-status').textContent=forceOffline?t('status.offline'):t('status.online');
    $('acct-status').className=forceOffline?'acct-status offline':'acct-status online';
    $('auth-logged-out').style.display='none';$('auth-logged-in').style.display='block';
    setPlayerAvatar($('profile-avatar'),profile);$('profile-name').textContent=profile.name;$('profile-uuid').textContent=profile.id;
  }else{
    setPlayerAvatar($('acct-avatar'),null);$('acct-name').textContent=t('auth.not_connected');
    $('acct-status').textContent=t('status.offline');$('acct-status').className='acct-status offline';
    setPlayerAvatar($('profile-avatar'),null);
    $('auth-logged-out').style.display='block';$('auth-logged-in').style.display='none';
  }
}
$('btn-login').addEventListener('click',async function(){
  this.disabled=true;this.innerHTML='<div class="spinner" style="width:18px;height:18px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:8px"></div>'+t('auth.opening_browser');
  const pendingHint = $('auth-pending-hint');
  if (pendingHint) pendingHint.textContent = t('auth.browser_hint');
  const copyBtn = $('btn-copy-device-code');
  if (copyBtn) {
    copyBtn.style.display = 'none';
    copyBtn.dataset.code = '';
    copyBtn.textContent = t('auth.copy_code');
  }
  $('auth-pending-block').style.display='block';
  const result=await px.auth.login();
  this.disabled=false;this.innerHTML='<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18"><path d="M3 10h14M10 4l6 6-6 6"/></svg> '+t('profile.btn.login');
  $('auth-pending-block').style.display='none';
  if(result.ok){await refreshAuth();showPage('library');}else notifyError(result.error);
});
px.on('auth:browser-opening',()=>{$('auth-pending-label').textContent=t('auth.browser_opened');});
px.on('auth:device-code',(data={})=>{
  const code = String(data.userCode || '').trim();
  if (code) {
    $('auth-pending-label').textContent = t('auth.device_code_label', { code });
    const pendingHint = $('auth-pending-hint');
    if (pendingHint) pendingHint.textContent = t('auth.device_code_hint');
    const copyBtn = $('btn-copy-device-code');
    if (copyBtn) {
      copyBtn.style.display = 'inline-block';
      copyBtn.dataset.code = code;
      copyBtn.textContent = t('auth.copy_code');
    }
  }
});
px.on('auth:exchanging',()=>{$('auth-pending-label').textContent=t('auth.verifying_mc');});
$('btn-copy-device-code').addEventListener('click',async function(){
  const code = String(this.dataset.code || '').trim();
  if (!code) return;
  const ok = await copyToClipboard(code);
  if (ok) {
    this.textContent = '✓ ' + t('auth.copy_code');
    notify(t('auth.code_copied'),'success',1800);
    setTimeout(()=>{ this.textContent = t('auth.copy_code'); },1000);
  } else {
    notifyError(t('error.unknown'));
  }
});
$('btn-logout').addEventListener('click',async function(){
  const ok=await showConfirmDialog({
    title:t('dialog.confirm_title'),
    message:t('auth.logout_confirm'),
    confirmText:t('profile.btn.logout'),
  });
  if(!ok)return;
  await px.auth.logout();
  await refreshAuth();
});

// ── Settings ──────────────────────────────────────────────────────────────────
let _systemRamGB = 0;
let _lastUpdateState = null;

function getUpdateDisabledReasonMessage(message){
  const msg = String(message || '').trim();
  if (!msg) return t('error.unknown');

  const lower = msg.toLowerCase();
  if (lower.includes('electron-updater missing')) {
    return t('settings.update_reason_missing_module');
  }
  if (lower.includes('development mode')) {
    return t('settings.update_reason_dev_mode');
  }

  if (lower.startsWith('auto-update unavailable:')) {
    const cleaned = msg.replace(/^auto-update unavailable:\s*/i, '').trim();
    return cleaned || t('error.unknown');
  }
  if (lower.startsWith('auto-update unavailable')) {
    const match = msg.match(/\(([^)]+)\)/);
    if (match?.[1]) return match[1].trim();
  }

  return msg;
}

function renderUpdateState(state){
  const statusEl = $('update-status');
  const checkBtn = $('btn-check-updates');
  const installBtn = $('btn-update-install');
  const channelSel = $('inp-update-channel');
  if (!statusEl || !checkBtn || !installBtn || !channelSel) return;

  const st = state || {};
  _lastUpdateState = st;

  if (st.channel === 'stable' || st.channel === 'beta') {
    channelSel.value = st.channel;
  }

  const available = !!st.available && !!st.enabled;
  checkBtn.disabled = !available;
  installBtn.style.display = st.status === 'downloaded' ? 'inline-flex' : 'none';
  installBtn.disabled = st.status !== 'downloaded';

  if (!available) {
    statusEl.textContent = t('settings.update_status_disabled', { message: getUpdateDisabledReasonMessage(st.message) });
    return;
  }

  if (st.status === 'checking') {
    statusEl.textContent = t('settings.update_status_checking');
    return;
  }
  if (st.status === 'up_to_date') {
    statusEl.textContent = t('settings.update_status_up_to_date', { version: st.currentVersion || '?' });
    return;
  }
  if (st.status === 'downloading') {
    statusEl.textContent = t('settings.update_status_downloading', { percent: Math.max(0, Math.min(100, Math.round(st.progress || 0))) });
    return;
  }
  if (st.status === 'downloaded') {
    statusEl.textContent = t('settings.update_status_downloaded', { version: st.updateVersion || '?' });
    return;
  }
  if (st.status === 'error') {
    statusEl.textContent = t('settings.update_status_error', { message: st.message || t('error.unknown') });
    return;
  }

  statusEl.textContent = t('settings.update_status_idle');
}

async function initUpdaterUi(){
  if (!px.updates || typeof px.updates.getState !== 'function') return;
  const state = await px.updates.getState().catch(() => null);
  if (state) renderUpdateState(state);
}

async function loadSettings(){
  const cfg=await px.config.get('settings')||{};

  // ── i18n: init language from saved config ──────────────────────────────────
  if(window.i18n){
    await window.i18n.initI18n(cfg);
    // lib-count is dynamic; i18n static pass sets "lib.loading", so re-render library values after init.
    renderLibrary(allPacks);
    // Reflect saved language on the selector buttons
    const lang=window.i18n.getLang();
    document.querySelectorAll('.lang-btn').forEach(b=>{
      const active=b.dataset.lang===lang;
      b.style.border=active?'2px solid var(--violet)':'1px solid var(--border)';
      b.style.background=active?'rgba(139,92,246,.1)':'transparent';
      b.style.color=active?'var(--text0)':'var(--text1)';
      b.style.fontWeight=active?'700':'600';
    });
  }

  // Fetch real system RAM and adapt the slider
  try {
    const info = await px.system.ram();
    _systemRamGB = info.totalGB;
    const maxSlider = Math.max(4, Math.floor(_systemRamGB));
    $('inp-ram').max = maxSlider;
    $('ram-system-info').textContent = t('settings.ram_system',{n:_systemRamGB});
    const packRamInput = $('pack-ram');
    if (packRamInput) {
      packRamInput.max = Math.max(1, Math.floor(_systemRamGB));
      const packRamSystemInfo = $('pack-ram-system-info');
      if (packRamSystemInfo) packRamSystemInfo.textContent = t('pack.settings.ram_system', { n: _systemRamGB });
    }
  } catch {}

  const savedRam = cfg.ram || 4;
  $('inp-ram').value = savedRam;
  $('ram-val').textContent = savedRam + ' GB';
  updateRamWarning(savedRam);

  $('inp-username').value=cfg.username||'';$('inp-force-offline').checked=cfg.forceOffline||false;$('inp-cf-key').value=cfg.cfApiKey||'';
  if ($('inp-update-channel')) $('inp-update-channel').value = cfg.updateChannel === 'beta' ? 'beta' : 'stable';
  await initUpdaterUi();
  // Re-apply dynamic auth labels after i18n static pass.
  await refreshAuth();
}

function updateRamWarning(ramGB) {
  const warn = $('ram-warning');
  if (!warn) return;
  if (!_systemRamGB || _systemRamGB === 0) { warn.style.display='none'; return; }
  const ratio = ramGB / _systemRamGB;
  const leftGB = (_systemRamGB - ramGB).toFixed(1);
  if (ratio >= 0.9) {
    warn.style.display='block';
    warn.style.background='rgba(244,63,94,.1)';
    warn.style.borderColor='rgba(244,63,94,.4)';
    warn.style.color='var(--red)';
    warn.textContent=t('settings.ram_warning_high',{left:leftGB});
  } else if (ratio >= 0.75) {
    warn.style.display='block';
    warn.style.background='rgba(245,158,11,.1)';
    warn.style.borderColor='rgba(245,158,11,.3)';
    warn.style.color='var(--orange)';
    warn.textContent=t('settings.ram_warning_medium',{left:leftGB});
  } else {
    warn.style.display='none';
  }
}

$('inp-ram').addEventListener('input',function(){
  const v = parseInt(this.value);
  $('ram-val').textContent = v + ' GB';
  updateRamWarning(v);
});
async function saveAllSettings(){
  const lang=window.i18n?window.i18n.getLang():'fr';
  const updateChannel = $('inp-update-channel')?.value === 'beta' ? 'beta' : 'stable';
  await px.config.set('settings',{
    ram:parseInt($('inp-ram').value),
    username:$('inp-username').value.trim(),
    forceOffline:$('inp-force-offline').checked,
    cfApiKey:$('inp-cf-key').value.trim(),
    language:lang,
    updateChannel,
  });
  document.querySelectorAll('.save-confirm').forEach(c=>{c.style.display='inline';setTimeout(()=>{c.style.display='none';},2000);});
}
$('btn-save-settings').addEventListener('click',saveAllSettings);
$('btn-save-profile').addEventListener('click',saveAllSettings);
$('btn-open-dir').addEventListener('click',async function(){const p=await px.config.get('__dataPath__');if(p)px.shell.open(p);});
$('btn-check-updates').addEventListener('click', async function(){
  if (!px.updates || typeof px.updates.check !== 'function') return;
  this.disabled = true;
  const result = await px.updates.check().catch(() => ({ ok: false, error: t('error.unknown') }));
  this.disabled = false;
  if (!result?.ok && result?.error) notifyError(result.error);
});
$('btn-update-install').addEventListener('click', async function(){
  if (!px.updates || typeof px.updates.installNow !== 'function') return;
  const result = await px.updates.installNow().catch(() => ({ ok: false, error: t('error.unknown') }));
  if (!result?.ok && result?.error) notifyError(result.error);
});
// cf-link is re-attached by i18n.js applyTranslations after innerHTML update

// ── Language selector ─────────────────────────────────────────────────────────
document.querySelectorAll('.lang-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    if(!window.i18n)return;
    const lang=btn.dataset.lang;
    window.i18n.setLang(lang);
    // Update button styles
    document.querySelectorAll('.lang-btn').forEach(b=>{
      const active=b.dataset.lang===lang;
      b.style.border=active?'2px solid var(--violet)':'1px solid var(--border)';
      b.style.background=active?'rgba(139,92,246,.1)':'transparent';
      b.style.color=active?'var(--text0)':'var(--text1)';
      b.style.fontWeight=active?'700':'600';
    });
    // Re-render dynamic content
    renderLibrary(allPacks);
    if(currentPack)openPlayPanel(currentPack);
    updateRamWarning(parseInt($('inp-ram').value)||4);
    const ramSI=$('ram-system-info');
    if(ramSI&&_systemRamGB)ramSI.textContent=t('settings.ram_system',{n:_systemRamGB});
    const packRamInput = $('pack-ram');
    const packRamVal = $('pack-ram-val');
    if (packRamInput && packRamVal) {
      const max = _systemRamGB ? Math.max(1, Math.floor(_systemRamGB)) : (parseInt(packRamInput.max, 10) || 32);
      packRamInput.max = max;
      const safe = Math.max(0, Math.min(parseInt(packRamInput.value, 10) || 0, max));
      packRamInput.value = String(safe);
      packRamVal.textContent = safe > 0 ? safe + ' GB' : t('pack.settings.ram_global');
      const packRamSystemInfo = $('pack-ram-system-info');
      if (packRamSystemInfo && _systemRamGB) {
        packRamSystemInfo.textContent = t('pack.settings.ram_system', { n: _systemRamGB });
      }
      updatePackRamWarning(safe);
    }
    renderUpdateState(_lastUpdateState);
    // Re-run refreshAuth so acct-name/acct-status show correct translated strings
    refreshAuth();
    saveAllSettings().catch(()=>{});
  });
});
async function loadDataPath(){const p=await px.config.get('__dataPath__').catch(()=>null);if(p)$('data-path').textContent=p;}

// ── Modrinth Browser ──────────────────────────────────────────────────────────
const mrState={type:'modpack',page:0,limit:20,total:0,query:'',version:'',loader:'',sort:'relevance',firstLoad:true,loading:false,targetInstanceId:'',installedByType:null,needsRefresh:false,reqSeq:0};

function normalizeMrContentType(type){
  const t = String(type || '').toLowerCase();
  if (t === 'resource_pack') return 'resourcepack';
  if (t === 'shaderpack') return 'shader';
  return t;
}
function buildInstalledTypeIndex(files){
  const mk = ()=>({ projectIds:new Set(), keys:new Set() });
  const byType = { mod:mk(), shader:mk(), resourcepack:mk(), datapack:mk() };
  (Array.isArray(files) ? files : []).forEach(f=>{
    const t = normalizeMrContentType(f?.type);
    if (!byType[t]) return;
    const bucket = byType[t];
    const pid = String(f?.modrinthProjectId || '').trim();
    if (pid) bucket.projectIds.add(pid);
    [f?.name, f?.prettyName, f?.filename, f?.modrinthSlug, f?.modrinthTitle].forEach(v=>{
      const key = normalizeInstalledMatchKey(v);
      if (key) bucket.keys.add(key);
    });
  });
  return byType;
}
async function loadMrInstalledContentForTarget(packId){
  if (!packId) {
    mrState.installedByType = null;
    return;
  }
  try {
    const strict = await px.modrinth.getInstalledFiles(packId);
    const files = Array.isArray(strict?.files) ? strict.files : await px.config.get('__instanceFiles__:'+packId);
    const processed = preprocessInstanceFiles(files || []);
    mrState.installedByType = buildInstalledTypeIndex(processed);
  } catch {
    mrState.installedByType = null;
  }
}
function isMrHitAlreadyInstalled(hit){
  if (!mrState.targetInstanceId || !mrState.installedByType) return false;
  const type = normalizeMrContentType(hit?.project_type);
  if (!['mod','shader','resourcepack','datapack'].includes(type)) return false;
  const bucket = mrState.installedByType[type];
  if (!bucket) return false;
  const projectId = String(hit?.project_id || '').trim();
  if (projectId) {
    if (bucket.projectIds.has(projectId)) return true;
    // Ultra-strict mode: when we have at least one indexed project id for this type,
    // don't fallback to fuzzy name matching for mismatched ids.
    if (bucket.projectIds.size > 0) return false;
  }
  const keys = [
    normalizeInstalledMatchKey(hit?.title),
    normalizeInstalledMatchKey(hit?.slug),
  ].filter(Boolean);
  return keys.some(k => bucket.keys.has(k));
}
function markMrContentInstalled(project, projectType, filename){
  if (!mrState.targetInstanceId || !mrState.installedByType) return;
  const t = normalizeMrContentType(projectType);
  const bucket = mrState.installedByType[t];
  if (!bucket) return;
  const pid = String(project?.id || project?.project_id || '').trim();
  if (pid) bucket.projectIds.add(pid);
  [
    project?.title,
    project?.slug,
    filename,
    prettifyContentName(project?.title, filename, t),
  ].forEach(v=>{
    const key = normalizeInstalledMatchKey(v);
    if (key) bucket.keys.add(key);
  });
}

function mapInstanceLoaderToMrLoader(loader) {
  const normalized = String(loader || '').toLowerCase();
  return ['forge', 'neoforge', 'fabric', 'quilt'].includes(normalized) ? normalized : '';
}

function setMrType(type) {
  mrState.type = type;
  document.querySelectorAll('#mr-type-tabs [data-type]').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });
}

function setMrSelectValue(selectId, value) {
  const sel = $(selectId);
  if (!sel) return;
  const wanted = String(value || '');
  if (!wanted) {
    sel.value = '';
    return;
  }
  const exists = Array.from(sel.options).some(o => o.value === wanted);
  if (!exists) {
    const opt = document.createElement('option');
    opt.value = wanted;
    opt.textContent = wanted;
    sel.appendChild(opt);
  }
  sel.value = wanted;
}

async function openBrowseForInstance(pack) {
  if (!pack) return;
  const loaderFilter = mapInstanceLoaderToMrLoader(pack.modloader);
  const targetType = loaderFilter ? 'mod' : 'resourcepack';

  mrState.firstLoad = false;
  showPage('browse');
  mrState.targetInstanceId = pack.id || '';
  mrState.query = '';
  mrState.version = String(pack.mcVersion || '');
  mrState.loader = loaderFilter;
  mrState.page = 0;
  mrState.installedByType = null;
  const targetId = mrState.targetInstanceId;
  loadMrInstalledContentForTarget(targetId).then(()=>{
    if (mrState.targetInstanceId === targetId && $('page-browse')?.classList.contains('active')) {
      mrSearch();
    }
  }).catch(()=>{});
  setMrType(targetType);
  const searchInput = $('mr-search');
  if (searchInput) searchInput.value = '';
  setMrSelectValue('mr-version-filter', mrState.version);
  setMrSelectValue('mr-loader-filter', mrState.loader);
  mrSearch();
}

// Load MC versions dynamically from Modrinth API
async function loadMrVersions() {
  try {
    const versions = await px.modrinth.getGameVersions();
    if (!Array.isArray(versions) || versions.error) return;
    const sel = $('mr-version-filter');
    const current = sel.value;
    sel.innerHTML = '<option value="">'+t('browse.all_versions')+'</option>';
    versions.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = v;
      if (v === current) opt.selected = true;
      sel.appendChild(opt);
    });
    mrState.version = sel.value;
  } catch {}
}

// Type tabs
document.querySelectorAll('[data-type]').forEach(btn=>{
  btn.addEventListener('click',()=>{
    setMrType(btn.dataset.type);
    mrState.targetInstanceId = '';
    mrState.installedByType = null;
    mrState.page=0;
    mrSearch();
  });
});

// Search debounce
let mrSearchTimer=null;
$('mr-search').addEventListener('input',function(){
  clearTimeout(mrSearchTimer);
  mrSearchTimer=setTimeout(()=>{mrState.query=this.value;mrState.page=0;mrSearch();},250);
});
$('mr-version-filter').addEventListener('change',function(){mrState.version=this.value;mrState.page=0;mrSearch();});
$('mr-loader-filter').addEventListener('change',function(){mrState.loader=this.value;mrState.page=0;mrSearch();});
$('mr-sort-filter').addEventListener('change',function(){mrState.sort=this.value;mrState.page=0;mrSearch();});

async function mrSearch(){
  if(mrState.loading){mrState.needsRefresh=true;return;}
  mrState.loading=true;
  mrState.needsRefresh=false;
  const reqId=++mrState.reqSeq;
  $('mr-loading').style.display='flex';$('mr-grid').innerHTML='';$('mr-empty').style.display='none';$('mr-pagination').style.display='none';

  const result=await px.modrinth.search({
    query:mrState.query,type:mrState.type,
    offset:mrState.page*mrState.limit,limit:mrState.limit,
    gameVersion:mrState.version,
    loader:mrState.loader,
    sort:mrState.sort,
  });

  if(reqId!==mrState.reqSeq){mrState.loading=false;return;}
  mrState.loading=false;$('mr-loading').style.display='none';

  if(result.error||!result.hits){
    $('mr-empty').style.display='block';
    if(mrState.needsRefresh){mrState.needsRefresh=false;mrSearch();}
    return;
  }
  mrState.total=result.total_hits||0;

  if(result.hits.length===0){
    $('mr-empty').style.display='block';
    if(mrState.needsRefresh){mrState.needsRefresh=false;mrSearch();}
    return;
  }
  renderMrGrid(result.hits);
  renderMrPagination();
  if(mrState.needsRefresh){mrState.needsRefresh=false;mrSearch();}
}

function renderMrGrid(hits){
  const TYPE_LABELS={
    modpack:t('browse.type_label.modpack'),
    mod:t('browse.type_label.mod'),
    shader:t('browse.type_label.shader'),
    resourcepack:t('browse.type_label.resourcepack')
  };
  const TYPE_BADGES={modpack:'badge-modrinth',mod:'badge-mod',shader:'badge-shader',resourcepack:'badge-resourcepack'};
  $('mr-grid').innerHTML=hits.map(h=>{
    const label=TYPE_LABELS[h.project_type]||h.project_type;
    const badgeCls=TYPE_BADGES[h.project_type]||'badge-modrinth';
    const installed = isMrHitAlreadyInstalled(h);
    const canQuickAdd = h.project_type !== 'modpack';
    const quickAddBtn = canQuickAdd
      ? `<button class="mr-card-add" data-mrquick="1" data-project-id="${esc(h.project_id||h.slug)}" data-project-type="${esc(h.project_type||'')}" data-project-title="${esc(h.title||'')}" data-installed="${installed?'1':'0'}" ${installed?'disabled':''} title="${esc(t('browse.quick_add_title'))}" aria-label="${esc(t('browse.quick_add_title'))}">
<svg viewBox="0 0 14 14" fill="none"><path d="M7 3v8M3 7h8" stroke-linecap="round"/></svg>
</button>`
      : '';
    const iconHtml=h.icon_url
      ?`<img src="${esc(h.icon_url)}" alt="" loading="lazy" class="mr-icon-img">`
      :`<div style="width:56px;height:56px;border-radius:12px;background:linear-gradient(135deg,var(--violet),var(--cyan));display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#fff;position:relative;z-index:2">${esc((h.title||'?')[0].toUpperCase())}</div>`;
    const bgStyle=h.icon_url?`style="background-image:url('${esc(h.icon_url)}')"` :'';
    return `<div class="mr-card ${installed?'mr-card-installed':''}" data-project="${esc(h.project_id||h.slug)}" data-installed="${installed?'1':'0'}">
<div class="mr-card-img"><div class="mr-card-img-bg" ${bgStyle}></div>${iconHtml}</div>
<div class="mr-card-body">
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
<div class="mr-card-name">${esc(h.title)}</div>
<div class="mr-card-head-actions">
${quickAddBtn}
<span class="mr-badge ${badgeCls}">${label}</span>
</div>
</div>
<div class="mr-card-desc">${esc(h.description||'')}</div>
</div>
<div class="mr-card-footer">
<div class="mr-card-stats">
<div class="mr-card-stat"><svg viewBox="0 0 14 14" fill="none"><path d="M2 10l3-7 2 4 2-2 3 5" stroke-linecap="round" stroke-linejoin="round"/></svg>${fmt(h.downloads)}</div>
<div class="mr-card-stat"><svg viewBox="0 0 14 14" fill="none"><path d="M7 1l1.5 3 3.5.5-2.5 2.5.5 3.5L7 9l-3 1.5.5-3.5L2 4.5 5.5 4z"/></svg>${fmt(h.follows)}</div>
</div>
<span style="font-size:11px;color:var(--text2);font-family:var(--mono)">${(h.versions||[]).slice(-1)[0]||''}</span>
</div>
</div>`;
  }).join('');
  $('mr-grid').querySelectorAll('.mr-icon-img').forEach(img=>{
    img.addEventListener('error',()=>{img.style.display='none';},{once:true});
  });

  $('mr-grid').querySelectorAll('.mr-card-add[data-mrquick="1"]').forEach(btn=>{
    btn.addEventListener('click',async(e)=>{
      e.stopPropagation();
      if (btn.dataset.installed === '1') return;
      await quickAddFromMrCard(btn);
    });
  });

  $('mr-grid').querySelectorAll('[data-project]').forEach(card=>{
    if (card.dataset.installed === '1') return;
    card.addEventListener('click',()=>openMrDetail(card.dataset.project));
  });
}

function pickPreferredMrVersion(versions, projectType) {
  const list = (Array.isArray(versions) ? versions : []).filter(v => Array.isArray(v.files) && v.files.length > 0);
  if (!list.length) return null;

  const desiredMc = String(mrState.version || '');
  const desiredLoader = String(mrState.loader || '').toLowerCase();
  const loaderAgnostic = isLoaderAgnosticType(projectType);

  const scored = list.map(v => {
    let score = 0;
    const mcVersions = (v.game_versions || []).map(String);
    const loaders = (v.loaders || []).map(l => String(l).toLowerCase());
    const vType = String(v.version_type || '').toLowerCase();

    if (desiredMc) score += mcVersions.includes(desiredMc) ? 1000 : -220;
    if (desiredLoader && !loaderAgnostic) score += loaders.includes(desiredLoader) ? 500 : -140;
    if (vType === 'release') score += 60;
    else if (vType === 'beta') score += 30;
    else if (vType === 'alpha') score += 10;
    if (v.featured) score += 15;
    if (mcVersions.length) score += Math.min(mcVersions.length, 3);

    const dateScore = Date.parse(v.date_published || v.date_modified || 0);
    if (Number.isFinite(dateScore)) score += dateScore / 1e13;

    return { v, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.v || null;
}

async function quickAddFromMrCard(btn) {
  if (!btn || btn.disabled) return;
  if (btn.dataset.installed === '1') return;
  const projectId = btn.dataset.projectId;
  const projectType = String(btn.dataset.projectType || '').toLowerCase();
  const projectTitle = btn.dataset.projectTitle || projectId || '';
  if (!projectId || !projectType || projectType === 'modpack') return;

  btn.disabled = true;
  btn.classList.add('loading');
  const versions = await px.modrinth.getVersions(projectId).catch(() => null);
  btn.classList.remove('loading');
  btn.disabled = false;

  const selectedVersion = pickPreferredMrVersion(versions, projectType);
  if (!selectedVersion) {
    notify(t('mr.no_versions'),'error',2600);
    return;
  }

  await handleContentDownload(
    btn,
    { id: projectId, title: projectTitle, project_type: projectType },
    selectedVersion,
    projectType,
    { compactButton: true, preferredInstanceId: mrState.targetInstanceId || '' }
  );
}

function renderMrPagination(){
  const total=mrState.total,limit=mrState.limit,page=mrState.page;
  const pages=Math.ceil(total/limit);
  if(pages<=1){$('mr-pagination').style.display='none';return;}
  $('mr-pagination').style.display='flex';

  const maxButtons=7;
  let start=Math.max(0,page-3);
  let end=Math.min(pages-1,start+maxButtons-1);
  if(end-start<maxButtons-1)start=Math.max(0,end-maxButtons+1);

  let html=`<button class="mr-page-btn" id="mr-prev" ${page===0?'disabled':''}>‹</button>`;
  for(let i=start;i<=end;i++){
    html+=`<button class="mr-page-btn ${i===page?'current':''}" data-p="${i}">${i+1}</button>`;
  }
  html+=`<button class="mr-page-btn" id="mr-next" ${page>=pages-1?'disabled':''}>›</button>`;
  html+=`<span class="mr-page-info">${page*limit+1}–${Math.min((page+1)*limit,total)} / ${fmt(total)}</span>`;
  $('mr-pagination').innerHTML=html;

  $('mr-pagination').querySelectorAll('[data-p]').forEach(btn=>{
    btn.addEventListener('click',()=>{mrState.page=parseInt(btn.dataset.p);mrSearch();$('page-browse').scrollTop=0;});
  });
  $('mr-prev')?.addEventListener('click',()=>{if(mrState.page>0){mrState.page--;mrSearch();}});
  $('mr-next')?.addEventListener('click',()=>{mrState.page++;mrSearch();});
}

// Project detail
async function openMrDetail(projectId){
  $('mr-detail-overlay').style.display='flex';
  $('mr-detail-content').innerHTML='<div class="mr-loading"><div class="spinner"></div><span>'+t('mr.loading')+'</span></div>';
  $('mr-detail-title').textContent=t('mr.loading');

  const [project,versions]=await Promise.all([
    px.modrinth.getProject(projectId),
    px.modrinth.getVersions(projectId),
  ]);

  if(project.error){$('mr-detail-content').innerHTML='<p style="padding:20px;color:var(--red)">'+t('error.generic')+': '+esc(project.error)+'</p>';return;}

  $('mr-detail-title').textContent=project.title;

  const iconHtml=project.icon_url
    ?`<img class="mr-detail-icon" src="${esc(project.icon_url)}" alt="">`
    :`<div class="mr-detail-icon-placeholder">${esc((project.title||'?')[0].toUpperCase())}</div>`;

  const tagsHtml=(project.categories||[]).slice(0,5).map(t=>`<span class="mr-detail-tag">${esc(t)}</span>`).join('');

  const statsHtml=`<div class="mr-detail-stats">
<div class="mr-detail-stat"><span class="mr-detail-stat-val">${fmt(project.downloads)}</span><span class="mr-detail-stat-label">${t("browse.sort.downloads")}</span></div>
<div class="mr-detail-stat"><span class="mr-detail-stat-val">${fmt(project.followers)}</span><span class="mr-detail-stat-label">${t('mr.followers')}</span></div>
<div class="mr-detail-stat"><span class="mr-detail-stat-val">${(Array.isArray(versions)?versions:project.versions||[]).length}</span><span class="mr-detail-stat-label">${t('mr.versions')}</span></div>
</div>`;

  // Build versions list with filter controls
  const allVersions = Array.isArray(versions) ? versions : [];

  // Collect unique MC versions and loaders for filter dropdowns
  const mcVersionSet = new Set();
  const loaderSet = new Set();
  allVersions.forEach(v => {
    (v.game_versions||[]).forEach(gv => mcVersionSet.add(gv));
    (v.loaders||[]).forEach(l => loaderSet.add(l));
  });
  const mcVersionsSorted = [...mcVersionSet].sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  const loadersSorted = [...loaderSet].sort();
  const detailDefaultMc = (mrState.version && mcVersionSet.has(mrState.version)) ? mrState.version : '';
  const detailDefaultLoader = (mrState.loader && loaderSet.has(mrState.loader)) ? mrState.loader : '';

  const versionsSection = allVersions.length ? `
<div class="mr-versions-section">
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:10px;flex-wrap:wrap">
  <h4 style="margin:0">${t('mr.versions_count',{n:allVersions.length})}</h4>
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <select id="mr-dv-mc" class="mr-select" style="font-size:11px;padding:5px 8px;min-width:100px">
      <option value="">${t('mr.filter.all_mc')}</option>
      ${mcVersionsSorted.map(v=>`<option value="${esc(v)}"${v===detailDefaultMc?' selected':''}>${esc(v)}</option>`).join('')}
    </select>
    ${loadersSorted.length>1?`<select id="mr-dv-loader" class="mr-select" style="font-size:11px;padding:5px 8px;min-width:90px">
      <option value="">${t('mr.filter.all_loaders')}</option>
      ${loadersSorted.map(l=>`<option value="${esc(l)}"${l===detailDefaultLoader?' selected':''}>${esc(getLoaderDisplayName(l))}</option>`).join('')}
    </select>`:''}
  </div>
</div>
<div id="mr-dv-list">
${allVersions.map(v=>`
<div class="mr-version-item" data-mcv="${esc((v.game_versions||[]).join(','))}" data-loader="${esc((v.loaders||[]).join(','))}">
<div class="mr-version-info">
<div class="mr-version-name">${esc(v.name||v.version_number)} <span style="font-size:10px;padding:2px 7px;border-radius:10px;margin-left:6px;background:${v.version_type==='release'?'rgba(16,185,129,.15)':v.version_type==='beta'?'rgba(245,158,11,.15)':'rgba(139,92,246,.15)'};color:${v.version_type==='release'?'var(--green)':v.version_type==='beta'?'var(--orange)':'var(--violet)'}">${esc(v.version_type||'release')}</span></div>
<div class="mr-version-meta">${(v.game_versions||[]).slice(0,4).join(', ')}${(v.game_versions||[]).length>4?'…':''} · ${esc((v.loaders||[]).map(getLoaderDisplayName).join(', '))}</div>
</div>
<button class="mr-dl-btn" data-vid="${esc(v.id)}" data-pid="${esc(projectId)}" data-fname="${esc(v.files?.[0]?.filename||'download')}">
<svg viewBox="0 0 14 14" fill="none"><path d="M7 2v7M4 6l3 3 3-3" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h10" stroke-linecap="round"/></svg>
${t('mr.download.btn')}
</button>
</div>`).join('')}
</div>
</div>` : '<p style="color:var(--text2);font-size:13px">'+t('mr.no_versions')+'</p>';

  $('mr-detail-content').innerHTML=`
<div class="mr-detail-header">
${iconHtml}
<div class="mr-detail-meta">
<div class="mr-detail-title">${esc(project.title)}</div>
<div class="mr-detail-author">${t('browse.by')} ${esc(project.team||'')}</div>
<div class="mr-detail-tags">${tagsHtml}</div>
</div>
</div>
<div class="mr-detail-body">
<p class="mr-detail-desc">${esc(project.description||'')}</p>
${statsHtml}
${versionsSection}
</div>`;

  // Version filter logic
  function filterDetailVersions() {
    const mcv = $('mr-dv-mc')?.value||'';
    const ldr = $('mr-dv-loader')?.value||'';
    $('mr-dv-list')?.querySelectorAll('.mr-version-item').forEach(row=>{
      const rowMcv = row.dataset.mcv||'';
      const rowLdr = row.dataset.loader||'';
      const okMc = !mcv || rowMcv.split(',').includes(mcv);
      const okLdr = !ldr || rowLdr.split(',').includes(ldr);
      row.style.display = okMc && okLdr ? '' : 'none';
    });
  }
  $('mr-dv-mc')?.addEventListener('change', filterDetailVersions);
  $('mr-dv-loader')?.addEventListener('change', filterDetailVersions);
  filterDetailVersions();

  // Download buttons — intercept non-modpacks for instance picking
  $('mr-detail-content').querySelectorAll('.mr-dl-btn').forEach(btn=>{
    btn.addEventListener('click',async()=>{
      const projectType = project.project_type || mrState.type;
      const isModpack   = projectType === 'modpack';

      if (isModpack) {
        // Modpacks: direct download + import prompt (original flow)
        await handleModpackDownload(btn);
      } else {
        // Mods, shaders, resourcepacks → pick an instance first
        const versionObj = allVersions.find(v => v.id === btn.dataset.vid);
        await handleContentDownload(btn, project, versionObj, projectType);
      }
    });
  });
}

// ── Modpack download (original flow) ─────────────────────────────────────────
async function handleModpackDownload(btn) {
  btn.disabled=true;
  btn.innerHTML='<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></div>';
  const dataPath = await px.config.get('__dataPath__');
  const destDir  = dataPath ? dataPath+'/downloads' : '.';
  const result   = await px.modrinth.download({
    projectId: btn.dataset.pid, versionId: btn.dataset.vid,
    fileName: btn.dataset.fname, destDir,
  });
  if (result.ok) {
    btn.innerHTML=t('mr.downloaded'); btn.style.background='var(--green)';
    if (/\.(mrpack|zip)$/i.test(result.filename || '')) {
      $('mr-detail-overlay').style.display='none';
      isInstalling = true;
      openInstallModal(result.path);
      try {
        const r = await px.modpack.import({ filePath: result.path, cleanupSource: true });
        if (!r.ok) {
          showModalError(r.error);
        } else {
          $('modal-close-btn').style.display='block';
          await loadLibrary();
          notify(t('install.done'),'success',2600);
        }
      } finally {
        isInstalling = false;
      }
    }
  } else {
    btn.disabled=false;
    btn.innerHTML='<svg viewBox="0 0 14 14" fill="none"><path d="M7 2v7M4 6l3 3 3-3" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h10" stroke-linecap="round"/></svg> '+t('mr.retry');
    notifyError(result.error);
  }
}

// ── Instance picker for mods / shaders / resourcepacks ────────────────────────

// Subfolder inside the instance gameDir for each project type
const CONTENT_SUBDIR = {
  mod:          'mods',
  shader:       'shaderpacks',
  resourcepack: 'resourcepacks',
  datapack:     'datapacks',
};

const CONTENT_LABEL = {
  mod:          'inst_pick.type.mod',
  shader:       'inst_pick.type.shader',
  resourcepack: 'inst_pick.type.resourcepack',
  datapack:     'inst_pick.type.datapack',
};

const LOADER_COMPAT = {
  // Fabric/Quilt mods run on both
  fabric: ['fabric', 'quilt'],
  quilt:  ['fabric', 'quilt'],
  forge:  ['forge', 'neoforge'],
  neoforge: ['forge', 'neoforge'],
};

function isLoaderAgnosticType(projectType) {
  const type = (projectType || '').toLowerCase();
  return type === 'resourcepack' || type === 'resource_pack' || type === 'texturepack' ||
    type === 'shader' || type === 'shaderpack' || type === 'datapack';
}

function isVersionCompatible(entry, versionObj, projectType) {
  const loaderAgnostic = isLoaderAgnosticType(projectType);
  if (!versionObj) {
    return loaderAgnostic
      ? { ok: true }
      : { ok: false, reason: t('inst_pick.version_unknown') };
  }

  const vMcVersions = versionObj.game_versions || [];
  const vLoaders    = versionObj.loaders || [];

  // MC version check
  const mcOk = !vMcVersions.length || vMcVersions.includes(entry.mcVersion);

  // Loader check only applies to mods/plugins. Resource packs, shaders and datapacks are loader-agnostic.
  const entryLoader = (entry.modloader || '').toLowerCase();
  const compatLoaders = LOADER_COMPAT[entryLoader] || (entryLoader ? [entryLoader] : []);
  const isShaderLikeVersion = vLoaders.length === 0 || vLoaders.includes('iris') || vLoaders.includes('optifine');
  const loaderOk = loaderAgnostic ||
    isShaderLikeVersion ||
    !vLoaders.length ||
    vLoaders.some(l => compatLoaders.includes((l || '').toLowerCase()));

  if (!mcOk) return { ok: false, reason: t('inst_pick.require_mc',{versions:vMcVersions.slice(0,3).join(', ')}) };
  if (!loaderOk) return { ok: false, reason: t('inst_pick.require_loader',{loaders:vLoaders.join('/')}) };
  return { ok: true };
}

async function handleContentDownload(btn, project, versionObj, projectType, options = {}) {
  const typeLabel = t(CONTENT_LABEL[projectType] || 'inst_pick.type.file');
  const subdir    = CONTENT_SUBDIR[projectType] || 'mods';
  const preferredInstanceId = String(options.preferredInstanceId || '');
  const compactButton = !!options.compactButton;
  const instances = await px.library.list();

  if (!instances.length) {
    notify(t('inst_pick.no_instances'),'info',3600);
    return;
  }

  // Annotate each instance with compatibility
  const annotated = instances.map(inst => ({
    ...inst,
    compat: isVersionCompatible(inst, versionObj, projectType),
  }));

  let compatible   = annotated.filter(i => i.compat.ok);
  const incompatible = annotated.filter(i => !i.compat.ok);
  if (preferredInstanceId && compatible.length > 1) {
    compatible = compatible.sort((a, b) => {
      const aPref = a.id === preferredInstanceId ? 1 : 0;
      const bPref = b.id === preferredInstanceId ? 1 : 0;
      return bPref - aPref;
    });
  }

  // Show picker modal
  $('inst-pick-title').textContent = t('inst_pick.install_title');
  $('inst-pick-subtitle').textContent =
    t('inst_pick.install_where',{type:typeLabel})+'\n' +
    (versionObj ? `(${project.title} · MC ${(versionObj.game_versions||[]).slice(0,3).join(', ')||'?'})` : '');

  const list  = $('inst-pick-list');
  const empty = $('inst-pick-empty');

  if (!compatible.length && !incompatible.length) {
    list.innerHTML = ''; empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    const loaderColors = {
      forge:'rgba(178,96,44,.15)', neoforge:'rgba(211,138,60,.15)',
      fabric:'rgba(178,199,111,.15)', quilt:'rgba(178,111,199,.15)',
      vanilla:'rgba(148,163,184,.15)',
    };
    const loaderText = { forge:'#B2602C', neoforge:'#D38A3C', fabric:'#B2C76F', quilt:'#B26FC7', vanilla:'#CBD5E1' };

    const renderCard = (inst, compat) => {
      const lc   = inst.modloader?.toLowerCase() || '';
      const lbg  = loaderColors[lc]  || 'rgba(100,116,139,.15)';
      const ltxt = loaderText[lc]    || 'var(--text2)';
      const lname= getLoaderDisplayName(inst.modloader);
      const iconHtml = inst.iconData
        ? `<img src="${esc(inst.iconData)}" style="width:38px;height:38px;border-radius:10px;object-fit:cover">`
        : `<div class="inst-pick-icon" style="background:${lbg};color:${ltxt}">${esc((inst.name||'?').substring(0,2).toUpperCase())}</div>`;

      const incompClass = compat.ok ? '' : ' inst-pick-incompatible';
      const reasonTag   = compat.ok ? '' :
        `<span style="font-size:10px;color:var(--text2);margin-left:auto;flex-shrink:0">${esc(compat.reason)}</span>`;
      const currentTag = (compat.ok && preferredInstanceId && inst.id === preferredInstanceId)
        ? `<span style="font-size:10px;color:var(--cyan);margin-left:auto;flex-shrink:0">${t('inst_pick.current_instance')}</span>`
        : '';

      return `<div class="inst-pick-card${incompClass}" data-id="${esc(inst.id)}" data-compat="${compat.ok}" data-gamedir="${esc(inst.gameDir)}" data-subdir="${subdir}">
  ${iconHtml}
  <div style="flex:1;min-width:0">
    <div class="inst-pick-name">${esc(inst.customName||inst.name)}</div>
    <div class="inst-pick-meta">MC ${esc(inst.mcVersion)} · ${esc(formatLoaderWithVersion(inst.modloader,inst.modloaderVersion))}</div>
  </div>
  ${currentTag || reasonTag}
  <span class="inst-pick-badge" style="background:${lbg};color:${ltxt}">${esc(lname)}</span>
</div>`;
    };

    list.innerHTML =
      compatible.map(i => renderCard(i, i.compat)).join('') +
      (incompatible.length ? `
        <div style="font-size:11px;color:var(--text2);padding:10px 4px 4px;font-weight:600;letter-spacing:.5px;text-transform:uppercase">
          ${t('inst_pick.incompatible')}
        </div>` + incompatible.map(i => renderCard(i, i.compat)).join('') : '');
  }

  $('inst-pick-overlay').style.display = 'flex';

  // Wire up card clicks (only compatible ones)
  list.querySelectorAll('.inst-pick-card[data-compat="true"]').forEach(card => {
    card.addEventListener('click', async () => {
      // Close picker
      $('inst-pick-overlay').style.display = 'none';

      // Mark the original button as downloading
      btn.disabled = true;
      if (compactButton) {
        btn.classList.add('loading');
      } else {
        btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;display:inline-block"></div>';
      }

      const destDir = card.dataset.gamedir + '/' + card.dataset.subdir;
      const selectedPack = allPacks.find(p => p.id === card.dataset.id);
      const instName = selectedPack?.customName || selectedPack?.name || card.dataset.id;
      const effectiveProjectId = project?.id || btn.dataset.pid;
      const effectiveVersionId = versionObj?.id || btn.dataset.vid;
      const effectiveFileName = versionObj?.files?.[0]?.filename || btn.dataset.fname || 'download';

      const result = await px.modrinth.download({
        projectId: effectiveProjectId,
        versionId: effectiveVersionId,
        fileName:  effectiveFileName,
        destDir,
      });

      if (result.ok) {
        markMrContentInstalled(project, projectType, effectiveFileName);
        if (compactButton) {
          btn.classList.remove('loading');
          btn.disabled = true;
          btn.dataset.installed = '1';
          btn.closest('.mr-card')?.classList.add('mr-card-installed');
          btn.closest('.mr-card')?.setAttribute('data-installed','1');
          notify(t('browse.quick_add_done', { instance: instName }), 'success', 2400);
        } else {
          btn.innerHTML = `${t('mr.downloaded')} → ${esc(instName)}`;
          btn.style.background = 'var(--green)';
          btn.style.fontSize   = '11px';
        }
        await loadLibrary();
      } else {
        btn.disabled = false;
        if (compactButton) {
          btn.classList.remove('loading');
        } else {
          btn.innerHTML = '<svg viewBox="0 0 14 14" fill="none"><path d="M7 2v7M4 6l3 3 3-3" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11h10" stroke-linecap="round"/></svg> '+t('mr.retry');
        }
        notifyError(result.error);
      }
    });
  });
}

$('mr-detail-close').addEventListener('click',()=>{$('mr-detail-overlay').style.display='none';});
$('mr-detail-overlay').addEventListener('click',e=>{if(e.target===$('mr-detail-overlay'))$('mr-detail-overlay').style.display='none';});
$('inst-pick-close').addEventListener('click',()=>{$('inst-pick-overlay').style.display='none';});
$('inst-pick-cancel').addEventListener('click',()=>{$('inst-pick-overlay').style.display='none';});
$('inst-pick-overlay').addEventListener('click',e=>{if(e.target===$('inst-pick-overlay'))$('inst-pick-overlay').style.display='none';});
$('modal-overlay').addEventListener('click',e=>{if(e.target===$('modal-overlay'))$('modal-overlay').style.display='none';});
$('confirm-ok')?.addEventListener('click',()=>closeConfirmDialog(true));
$('confirm-cancel')?.addEventListener('click',()=>closeConfirmDialog(false));
$('confirm-close')?.addEventListener('click',()=>closeConfirmDialog(false));
$('confirm-overlay')?.addEventListener('click',e=>{if(e.target===$('confirm-overlay'))closeConfirmDialog(false);});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape' && $('confirm-overlay')?.style.display==='flex') closeConfirmDialog(false);
});

// ── IPC ───────────────────────────────────────────────────────────────────────
px.on('install:progress',({step,pct,detail})=>updateStep(step,pct,detail));
px.on('install:log',msg=>appendLog(msg));
px.on('install:error',msg=>showModalError(msg));
px.on('install:done',()=>{updateStep('done',100,t('install.done'));$('modal-close-btn').style.display='block';});
px.on('updates:status',state=>renderUpdateState(state));

// ── Icon fetch after import ───────────────────────────────────────────────────
// After a modpack is added to library, if it has no icon try to fetch one from Modrinth
px.on('install:done', async (entry) => {
  if (entry && !entry.iconData && entry.format !== 'custom') {
    try {
      const result = await px.modpack.fetchIcon({ format: entry.format, name: entry.name });
      if (result?.ok && result.iconUrl) {
        // Download the icon as base64 via fetch in renderer
        const resp = await fetch(result.iconUrl);
        const blob = await resp.blob();
        const reader = new FileReader();
        reader.onload = async (e) => {
          await px.library.update(entry.id, { iconData: e.target.result });
          // Refresh library silently
          loadLibrary();
        };
        reader.readAsDataURL(blob);
      }
    } catch {}
  }
});

// ── Create Instance ───────────────────────────────────────────────────────────
let ciLoader = 'fabric';
let ciMcVersionsLoaded = false;

function updateCiLoaderVersionVisibility(){
  const group=$('ci-loader-version-group');
  if(!group)return;
  group.style.display = ciLoader==='vanilla' ? 'none' : 'block';
}

function updateCiCreateButtonState(){
  const hasName = !!$('ci-name').value.trim();
  const hasMc = !!$('ci-mc-version').value;
  const hasLoaderVersion = ciLoader === 'vanilla' || !!$('ci-loader-version').value;
  $('ci-create').disabled = !(hasName && hasMc && hasLoaderVersion);
}

function openCreateInstanceModal() {
  ciLoader = 'fabric';
  document.querySelectorAll('.ci-loader-btn').forEach(b => b.classList.toggle('active', b.dataset.loader === ciLoader));
  $('ci-name').value = '';
  $('ci-mc-version').value = '';
  $('ci-loader-version').innerHTML = '<option value="">'+t('create.select_mc_first')+'</option>';
  $('ci-error').style.display = 'none';
  updateCiLoaderVersionVisibility();
  updateCiCreateButtonState();
  $('create-instance-overlay').style.display = 'flex';

  // Load MC versions once
  if (!ciMcVersionsLoaded) {
    loadCiMcVersions();
  }
}

async function loadCiMcVersions() {
  const sel = $('ci-mc-version');
  sel.innerHTML = '<option value="">'+t('create.loading')+'</option>';
  const versions = await px.instance.getMcVersions();
  if (!Array.isArray(versions)) {
    sel.innerHTML = '<option value="">'+t('create.load_error')+'</option>';
    return;
  }
  sel.innerHTML = '<option value="">'+t('create.select_version')+'</option>';
  versions.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    sel.appendChild(opt);
  });
  ciMcVersionsLoaded = true;
}

async function loadCiLoaderVersions() {
  const mcVersion = $('ci-mc-version').value;
  const loaderSel = $('ci-loader-version');
  if (!mcVersion) {
    loaderSel.innerHTML = '<option value="">'+t('create.select_mc_first')+'</option>';
    updateCiCreateButtonState();
    return;
  }

  if (ciLoader === 'vanilla') {
    loaderSel.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = 'vanilla';
    opt.textContent = t('create.vanilla_no_loader');
    opt.selected = true;
    loaderSel.appendChild(opt);
    updateCiCreateButtonState();
    return;
  }

  loaderSel.innerHTML = '<option value="">'+t('create.loading_loader_versions')+'</option>';
  updateCiCreateButtonState();

  const versions = await px.instance.getLoaderVersions(ciLoader, mcVersion);
  if (!Array.isArray(versions) || versions.length === 0) {
    loaderSel.innerHTML = '<option value="">'+t('create.no_versions')+'</option>';
    updateCiCreateButtonState();
    return;
  }
  loaderSel.innerHTML = '';
  versions.forEach((v, i) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    if (i === 0) opt.selected = true;
    loaderSel.appendChild(opt);
  });
  updateCiCreateButtonState();
}

$('ci-mc-version').addEventListener('change', loadCiLoaderVersions);
$('ci-name').addEventListener('input', updateCiCreateButtonState);
$('ci-loader-version').addEventListener('change', updateCiCreateButtonState);

document.querySelectorAll('.ci-loader-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ci-loader-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ciLoader = btn.dataset.loader;
    updateCiLoaderVersionVisibility();
    if ($('ci-mc-version').value) loadCiLoaderVersions();
    else updateCiCreateButtonState();
  });
});

$('btn-create-instance').addEventListener('click', openCreateInstanceModal);
$('create-instance-close').addEventListener('click', () => { $('create-instance-overlay').style.display='none'; });
$('ci-cancel').addEventListener('click', () => { $('create-instance-overlay').style.display='none'; });

$('ci-create').addEventListener('click', async () => {
  const name = $('ci-name').value.trim();
  const mcVersion = $('ci-mc-version').value;
  const loaderVersion = $('ci-loader-version').value;
  if (!name || !mcVersion) return;
  if (ciLoader !== 'vanilla' && !loaderVersion) return;

  $('create-instance-overlay').style.display = 'none';
  isInstalling = true;
  $('modal-title').textContent = t('create.modal_title',{name});
  $('modal-log').innerHTML = '';
  $('modal-close-btn').style.display = 'none';
  STEPS.forEach(s=>{$('istep-'+s)?.setAttribute('class','istep');const d=$('istep-'+s+'-detail');if(d)d.textContent=t('install.preparing');const p=$('istep-'+s+'-pct');if(p)p.textContent='';});
  $('modal-overlay').style.display = 'flex';

  const result = await px.instance.create({
    name,
    mcVersion,
    loader: ciLoader,
    loaderVersion: ciLoader === 'vanilla' ? '' : loaderVersion,
  });
  isInstalling = false;
  if (!result.ok) {
    showModalError(result.error);
  } else {
    $('modal-close-btn').style.display = 'block';
    await loadLibrary();
    notify(t('install.done'),'success',2600);
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot(){
  await refreshAuth();
  await loadLibrary();
  await loadSettings();
  await loadDataPath();
  await loadMrVersions();
  mrSearch();
  px.rpc?.setPage?.('library').catch?.(()=>{});
}
boot().catch(e=>console.error('[boot]',e));

})();
