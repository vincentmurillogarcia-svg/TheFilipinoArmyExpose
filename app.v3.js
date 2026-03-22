/* ── CONSTANTS ── */
const DEFAULT_REACTIONS = ['👍','❤️','😮','😡','😢'];
let REACTIONS = [...DEFAULT_REACTIONS];
const AVATARS = ['👤','🧑','🕵️','👮','🦸','🧑‍💼','🧑‍🔬','🧑‍⚖️','🫡','🦹','⚡','🔥','🌟','🌊','🗡️','🛡️','🎭','🎯','🔮','⬡','🦅','🐉'];
const BANNER_COLORS = ['#0d4a6b','#0d4a4a','#4a0d4a','#4a0d0d','#3a3a0d','#3a0d3a','#0d3a0d','#3a2a0d','#1a1a2a','#2a1a0d'];
const AV_CLASSES = ['','av-var1','av-var2','av-var3','av-var4','av-var5'];

const ROLE_LEVEL = {guest:0, citizen:1, reporter:1, user:1, staff:2, developer:3};
function roleLevel(r){ return ROLE_LEVEL[r||'guest']||0; }
function canPost(r){ return roleLevel(r)>=1; }
function canModerate(r){ return roleLevel(r)>=2; }
function isDevRole(r){ return r==='developer'; }

const API = {
  async get(path){
    const r=await fetch('/api/'+path);
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  },
  async post(path,body){
    const r=await fetch('/api/'+path,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    if(!r.ok&&r.status!==401) throw new Error('HTTP '+r.status);
    return r.json();
  }
};

const S = {posts:[],comments:[],announcements:[],categories:[],reactions:{}};
const LV = {
  get(pid){
    try{ return JSON.parse(localStorage.getItem('sv')||'{}')[pid]||null } catch{ return null }
  },
  set(pid,dir){
    try{
      const v=JSON.parse(localStorage.getItem('sv')||'{}');
      if(dir===null) delete v[pid];
      else v[pid]=dir;
      localStorage.setItem('sv',JSON.stringify(v));
    } catch{}
  }
};

let curTab='all', curStatus='all', curUrg='low', tipUrg='low';
let mediaFiles=[];
let devPass='', devAuthed=false;
let currentUser=null;
let selectedBulk=new Set();
let _allUsersList=[];
let bulkPage=0;
const BULK_PER_PAGE=50;
const _tapMap={};
const _avatarImageCache={};

/* ── PAGINATION & LOAD STATE (declared early to avoid temporal dead zone) ── */
let _dataLoaded = false;
const MAX_MEDIA = 5;
const PAGE_SIZE = 20;
let _currentPage = 0;
let _allPosts = [];

function genId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g,"").slice(0,16);
  }
  return Date.now().toString(36)+Math.random().toString(36).slice(2,7);
}

function esc(s){
  if(s==null) return '';
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#x27;')
    .replace(/\//g,'&#x2F;');
}

function ago(ts){
  const s=Math.floor((Date.now()-new Date(ts))/1000);
  if(s<60) return s+'s ago';
  if(s<3600) return Math.floor(s/60)+'m ago';
  if(s<86400) return Math.floor(s/3600)+'h ago';
  return Math.floor(s/86400)+'d ago';
}

function fmtTs(ts){ return new Date(ts).toLocaleString([],{month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}); }

/* ── RENDER SIDEBAR CATEGORIES ── */
function renderSidebarCategories(){
  const el=document.getElementById('sidebar-categories'); if(!el)return;
  if(!S.categories||!S.categories.length){ el.innerHTML=''; return; }
  el.innerHTML=S.categories.map(c=>`<button class="sidebar-nav-item" onclick="setTabByCategory('${esc(c.id)}')"><div class="snav-ico">${esc(c.icon||'📋')}</div> ${esc(c.label)}</button>`).join('');
}

/* ── RENDER TAGS WIDGET ── */
function renderTagsWidget(){
  const el=document.getElementById('suggested-tags'); if(!el)return;
  const tagCounts={};
  S.posts.forEach(p=>(p.tags||[]).forEach(t=>{ tagCounts[t]=(tagCounts[t]||0)+1; }));
  const sorted=Object.entries(tagCounts).sort((a,b)=>b[1]-a[1]).slice(0,10);
  if(!sorted.length){ el.innerHTML='<div style="padding:8px;font-size:12px;color:var(--text3)">No tags yet</div>'; return; }
  el.innerHTML=sorted.map(([tag])=>`<span class="cloud-tag" onclick="setTagFilter('#${esc(tag)}')">#${esc(tag)}</span>`).join('');
}

/* ── DIVISION/BRANCH MANAGEMENT ── */
const DEFAULT_BRANCHES=['Barangay','Municipal','City','Provincial','Regional','National','DPWH','DILG','COMELEC','COA','DOJ','PNP','AFP','BIR','Other / Not Listed'];
let _branches=[...DEFAULT_BRANCHES];
function loadBranches(){
  try{ const b=JSON.parse(localStorage.getItem('sentinel_branches')||'null'); if(b&&Array.isArray(b)) _branches=b; } catch{}
  renderBranchList(); populateBranchSelect();
}
function saveBranches(){
  try{ localStorage.setItem('sentinel_branches',JSON.stringify(_branches)) } catch{}
  populateBranchSelect();
}
function renderBranchList(){
  const el=document.getElementById('branch-list'); if(!el)return;
  if(!_branches.length){ el.innerHTML='<div style="color:var(--text3);font-size:12px">No options. Add some above.</div>'; return; }
  el.innerHTML=_branches.map((b,i)=>`<div class="cat-list-item"><span class="cli-lbl">${esc(b)}</span><button class="cli-rm" onclick="removeBranch(${i})">✕</button></div>`).join('');
}
function addBranch(){
  const inp=document.getElementById('nb-lbl'); if(!inp)return;
  const val=inp.value.trim();
  if(!val){toast('Enter a name','err');return;}
  if(_branches.includes(val)){toast('Already exists','err');return;}
  _branches.push(val); saveBranches(); renderBranchList(); inp.value=''; toast('Branch added','ok');
}
function removeBranch(i){ _branches.splice(i,1); saveBranches(); renderBranchList(); }
function resetBranches(){ _branches=[...DEFAULT_BRANCHES]; saveBranches(); renderBranchList(); toast('Branches reset to defaults','ok'); }
function populateBranchSelect(){
  ['n-location','edit-location'].forEach(id=>{
    const sel=document.getElementById(id); if(!sel)return;
    const cur=sel.value;
    const isEdit=(id==='edit-location');
    sel.innerHTML=(isEdit?'<option value="">— Keep current —</option>':'<option value="">— Select Division/Branch —</option>')+_branches.map(b=>`<option value="${esc(b)}">${esc(b)}</option>`).join('');
    if(cur) sel.value=cur;
  });
}

function toast(msg,type='',icon=''){
  if(!icon){ if(type==='ok')icon='✅'; else if(type==='err')icon='❌'; else if(type==='dev')icon='🛡'; else icon='ℹ️'; }
  const t=document.createElement('div'); t.className='toast '+(type||'');
  t.innerHTML=`<span class="toast-icon">${esc(icon)}</span><span>${esc(msg)}</span>`;
  document.getElementById('toasts').appendChild(t);
  setTimeout(()=>{ t.style.animation='tOut .25s ease forwards'; setTimeout(()=>t.remove(),280); },3400);
}

function loading(on){ const el=document.getElementById('lb'); if(el)el.className=on?'load-bar on':'load-bar hidden'; }
function apiErr(show){ const el=document.getElementById('api-err'); if(el)el.className=show?'api-err show':'api-err'; }
function open_(id){ const el=document.getElementById(id); if(el){ el.classList.add('open'); document.body.classList.add('modal-open'); } }
function close_(id){
  const el=document.getElementById(id); if(!el)return;
  el.classList.remove('open');
  if(!document.querySelector('.overlay.open')) document.body.classList.remove('modal-open');
  document.querySelectorAll('.dev-quick-menu.open').forEach(m=>m.classList.remove('open'));
}

/* ── THEME ── */
function initTheme(){
  const dark=localStorage.getItem('theme')==='dark';
  document.body.classList.toggle('dark',dark);
  updateThemeBtn();
}
/* ── LANDING PAGE ── */
function landingTab(name,btn){
  document.querySelectorAll('.lf-tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.lf-pane').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('lp-'+name).classList.add('active');
  if(name==='register') buildEmojiGrid('land-emoji-grid','land-reg-emoji',null,'👤');
}

async function landingLogin(){
  const username=document.getElementById('land-user').value.trim();
  const password=document.getElementById('land-pass').value;
  if(!username||!password){toast('Fill in all fields','err');return;}
  loading(true);
  try{
    const res=await API.post('auth',{action:'login',username,password});
    if(res.ok){
      currentUser={username:res.username,displayName:res.displayName,role:res.role||'citizen',avatarEmoji:res.avatarEmoji||'👤',avatarUrl:res.avatarUrl||'',avatarImage:res.avatarImage||'',bio:res.bio||'',bannerColor:res.bannerColor||'#0d4a6b'};
      saveUser(currentUser);
      showMainApp();
      toast('Welcome back, '+(currentUser.displayName||currentUser.username)+'!','ok');
      if(res.needsProfileUpdate) setTimeout(()=>openWelcome(),800);
    } else toast(res.error||'Login failed','err');
  }catch(e){toast('Connection error','err');}
  loading(false);
}

async function landingRegister(){
  const username=document.getElementById('land-reg-user').value.trim();
  const password=document.getElementById('land-reg-pass').value;
  const pass2=document.getElementById('land-reg-pass2').value;
  const reason=document.getElementById('land-reg-reason').value.trim();
  const realName=document.getElementById('land-reg-realname').value.trim();
  const avatarEmoji=document.getElementById('land-reg-emoji').value||'👤';
  if(!username||!password){toast('Fill in required fields','err');return;}
  if(username.length<3){toast('Username must be 3+ characters','err');return;}
  if(!/^[a-z0-9_.-]+$/i.test(username)){toast('Username: letters, numbers, _ . - only','err');return;}
  if(password!==pass2){toast('Passwords do not match','err');return;}
  if(reason.length<10){toast('Provide a reason (10+ characters)','err');return;}
  loading(true);
  try{
    const res=await API.post('auth',{action:'register',username,password,reason,realName,avatarEmoji});
    if(res.pending){
      toast('Registration submitted! Await staff approval.','ok');
      setTimeout(()=>alert('✅ Registration submitted!\n\nStaff will review your application. You can log in once approved.'),400);
      landingTab('login',document.querySelectorAll('.lf-tab')[0]);
    } else toast(res.error||'Registration failed','err');
  }catch(e){toast('Connection error','err');}
  loading(false);
}

function continueAsGuest(){
  currentUser={username:'guest',displayName:'Guest',role:'guest',avatarEmoji:'👁',avatarUrl:'',avatarImage:'',bio:'',bannerColor:'#0d4a6b'};
  showMainApp();
  toast('Browsing as guest. Login to post & interact.','','👁');
}

function showMainApp(){
  document.getElementById('landing-screen').style.display='none';
  document.getElementById('main-app').style.display='block';
  if(currentUser.role!=='guest') saveUser(currentUser);
  renderAuthArea();
  renderSidebarUser();
  renderComposerBox();
  renderStaffSidebar();
  renderStatWidget();
  loadData();
}

/* ── AUTH ── */
function loadUserFromStorage(){
  try{
    const u=JSON.parse(localStorage.getItem('sentinel_user')||'null');
    if(u&&u.username){
      currentUser=u;
      showMainApp();
    } else {
      buildEmojiGrid('land-emoji-grid','land-reg-emoji',null,'👤');
    }
  }catch{
    buildEmojiGrid('land-emoji-grid','land-reg-emoji',null,'👤');
  }
}

function saveUser(u){ try{ if(u.role!=='guest')localStorage.setItem('sentinel_user',JSON.stringify(u)) }catch{} }

function logout(){
  if(!confirm('Are you sure you want to log out?')) return;
  currentUser=null;
  try{ localStorage.removeItem('sentinel_user') }catch{}
  document.getElementById('main-app').style.display='none';
  document.getElementById('landing-screen').style.display='flex';
  document.getElementById('land-user').value='';
  document.getElementById('land-pass').value='';
  toast('Logged out');
}

function renderAuthArea(){
  const el=document.getElementById('auth-area'); if(!el)return;
  if(currentUser&&currentUser.role!=='guest'){
    const avatarSrc=currentUser.avatarUrl||currentUser.avatarImage||'';
    const avatarHtml=avatarSrc ? `<img class="user-avatar-img" src="${esc(avatarSrc)}" alt="">` : `<span style="font-size:16px">${esc(currentUser.avatarEmoji||'👤')}</span>`;
    el.innerHTML=`
      <div class="user-dropdown" id="user-dropdown">
        <div class="user-badge" onclick="toggleUserDropdown()" title="Account menu">
          ${avatarHtml}
          <span class="ub-name">${esc(currentUser.displayName||currentUser.username)}</span>
          <span class="ub-dot"></span>
          <span style="font-size:9px;color:var(--text3)">▾</span>
        </div>
        <div class="user-dropdown-menu" id="udm">
          <div class="udm-header">
            <div class="udm-name">${esc(currentUser.displayName||currentUser.username)}</div>
            <div class="udm-role">@${esc(currentUser.username)}${currentUser.role&&currentUser.role!=='citizen'?' · '+currentUser.role.toUpperCase():''}</div>
          </div>
          <div class="udm-item" onclick="closeUserDropdown();openMyProfile()">👤 View Profile</div>
          <div class="udm-item" onclick="closeUserDropdown();openSettings()">⚙️ Settings</div>
          <div class="udm-sep"></div>
          <div class="udm-item danger" onclick="closeUserDropdown();logout()">✕ Log Out</div>
        </div>
      </div>`;
  } else if(currentUser&&currentUser.role==='guest'){
    el.innerHTML=`<button class="btn-auth" onclick="openAuth()">👁 Guest <span style="font-size:10px;opacity:.7">— Login</span></button>`;
  } else {
    el.innerHTML=`<button class="btn-auth" onclick="openAuth()">👤 Login</button>`;
  }
  updatePostingAsDisplay();
}

function renderSidebarUser(){
  const el=document.getElementById('sidebar-user-area'); if(!el)return;
  if(!currentUser||currentUser.role==='guest'){
    el.innerHTML=`<div style="padding:10px 8px"><button class="btn btn-primary" style="width:100%" onclick="openAuth()">👁 Sign In</button></div>`;
    return;
  }
  const avatarSrc=currentUser.avatarUrl||currentUser.avatarImage||'';
  const avatarHtml=avatarSrc ? `<img src="${esc(avatarSrc)}" alt="">` : esc(currentUser.avatarEmoji||'👤');
  el.innerHTML=`<div class="sidebar-user-chip" onclick="openMyProfile()">
    <div class="sidebar-av">${avatarHtml}</div>
    <div><div class="sidebar-username">${esc(currentUser.displayName||currentUser.username)}</div>
    <div style="font-size:12px;color:var(--text3)">@${esc(currentUser.username)}</div></div>
  </div>`;
}

function renderComposerBox(){
  const box=document.getElementById('composer-box'); if(!box)return;
  if(!currentUser||currentUser.role==='guest'){ box.style.display='none'; return; }
  box.style.display='block';
  const av=document.getElementById('composer-av'); if(!av)return;
  const avatarSrc=currentUser.avatarUrl||currentUser.avatarImage||'';
  if(avatarSrc) av.innerHTML=`<img src="${esc(avatarSrc)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
  else av.textContent=currentUser.avatarEmoji||'👤';
}

function renderStaffSidebar(){
  const showStaff=canModerate(currentUser?.role);
  const showDev=isDevRole(currentUser?.role);
  document.getElementById('staff-sidebar-divider').style.display=showStaff?'block':'none';
  document.getElementById('staff-sidebar-lbl').style.display=showStaff?'block':'none';
  document.getElementById('snav-staff').style.display=showStaff?'flex':'none';
  document.getElementById('snav-dev').style.display=showDev?'flex':'none';
}

function renderStatWidget(){
  const show=canModerate(currentUser?.role);
  const w=document.getElementById('stats-widget'); if(w) w.style.display=show?'block':'none';
}

function toggleUserDropdown(){ const menu=document.getElementById('udm'); if(menu)menu.classList.toggle('open'); }
function closeUserDropdown(){ const menu=document.getElementById('udm'); if(menu)menu.classList.remove('open'); }
document.addEventListener('click',e=>{ if(!e.target.closest('#user-dropdown'))closeUserDropdown(); });

function openAuth(){
  document.querySelectorAll('.auth-tab').forEach((t,i)=>t.classList.toggle('active',i===0));
  document.querySelectorAll('.auth-pane').forEach((p,i)=>p.classList.toggle('active',i===0));
  open_('m-auth');
}

function authTab(name,btn){
  document.querySelectorAll('.auth-tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.auth-pane').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('ap-'+name).classList.add('active');
  if(name==='register') buildEmojiGrid('reg-emoji-grid','ar-emoji',null,(document.getElementById('ar-emoji')||document.getElementById('reg-emoji'))?.value||'👤');
}

async function doLogin(){
  const username=(document.getElementById('au-user')||document.getElementById('login-user'))?.value?.trim()||'';
  const password=(document.getElementById('au-pass')||document.getElementById('login-pass'))?.value||'';
  if(!username||!password){toast('Fill in all fields','err');return;}
  loading(true);
  try{
    const res=await API.post('auth',{action:'login',username,password});
    if(res.ok){
      currentUser={username:res.username,displayName:res.displayName,role:res.role||'citizen',avatarEmoji:res.avatarEmoji||'👤',avatarUrl:res.avatarUrl||'',avatarImage:res.avatarImage||'',bio:res.bio||'',bannerColor:res.bannerColor||'#0d4a6b'};
      saveUser(currentUser);
      renderAuthArea(); renderSidebarUser(); renderComposerBox(); renderStaffSidebar(); renderStatWidget();
      close_('m-auth');
      toast('Welcome back, '+(currentUser.displayName||currentUser.username)+'!','ok');
      if(res.needsProfileUpdate) setTimeout(()=>openWelcome(),800);
    } else toast(res.error||'Login failed','err');
  }catch(e){toast('Connection error','err');}
  loading(false);
}

async function doRegister(){
  const gv=(a,b)=>(document.getElementById(a)||document.getElementById(b))?.value||'';
  const username=gv('ar-user','reg-user').trim();
  const password=gv('ar-pass','reg-pass');
  const pass2=gv('ar-pass2','reg-pass2');
  const reason=gv('ar-reason','reg-reason').trim();
  const realName=gv('ar-realname','reg-realname').trim();
  const avatarEmoji=gv('ar-emoji','reg-emoji')||'👤';
  if(!username||!password){toast('Fill in required fields','err');return;}
  if(username.length<3){toast('Username must be 3+ characters','err');return;}
  if(!/^[a-z0-9_.-]+$/i.test(username)){toast('Username: letters, numbers, _ . - only','err');return;}
  if(password!==pass2){toast('Passwords do not match','err');return;}
  if(reason.length<10){toast('Provide a reason (10+ chars)','err');return;}
  loading(true);
  try{
    const res=await API.post('auth',{action:'register',username,password,reason,realName,avatarEmoji});
    if(res.pending){toast('Submitted! Await staff approval.','ok'); close_('m-auth');}
    else toast(res.error||'Registration failed','err');
  }catch(e){toast('Connection error','err');}
  loading(false);
}

/* ── WELCOME / PROFILE SETUP ── */
function openWelcome(){
  // Support both old (welcome-dname) and new (w-name) HTML field IDs
  const sv=(id,v)=>{const el=document.getElementById(id);if(el)el.value=v;};
  sv('welcome-dname',currentUser.displayName||''); sv('w-name',currentUser.displayName||'');
  sv('welcome-bio',currentUser.bio||''); sv('w-bio',currentUser.bio||'');
  buildEmojiGrid('welcome-emoji-grid','welcome-emoji','welcome-av-preview',currentUser.avatarEmoji||'👤');
  buildEmojiGrid('w-emoji-grid','w-emoji','w-av-preview',currentUser.avatarEmoji||'👤');
  buildColorSwatches('welcome-colors','welcome-color',currentUser.bannerColor||'#0d4a6b');
  buildColorSwatches('w-color-swatches','w-banner-color',currentUser.bannerColor||'#0d4a6b');
  open_('m-welcome');
}

async function saveWelcome(){
  const gv=(ids,fb='')=>{for(const id of ids){const el=document.getElementById(id);if(el&&el.value!==undefined)return el.value.trim();}return fb;};
  const dname=gv(['w-name','welcome-dname'])||currentUser?.displayName||'';
  const bio=gv(['w-bio','welcome-bio']);
  const avatarEmoji=gv(['w-emoji','welcome-emoji'])||currentUser?.avatarEmoji||'👤';
  const bannerColor=gv(['w-banner-color','welcome-color'])||currentUser?.bannerColor||'#0d4a6b';
  const avatarUrl=_avatarImageCache['welcome']||'';
  loading(true);
  try{
    const res=await API.post('auth',{action:'updateProfile',username:currentUser.username,password:'__skip__',displayName:dname||currentUser.displayName,bio,avatarEmoji,bannerColor,avatarUrl,avatarImage:''});
    if(res.ok){
      currentUser={...currentUser,displayName:res.displayName,role:res.role,avatarEmoji:res.avatarEmoji,avatarUrl:res.avatarUrl||'',avatarImage:'',bio:res.bio,bannerColor:res.bannerColor};
      saveUser(currentUser); renderAuthArea(); renderSidebarUser(); renderComposerBox(); close_('m-welcome'); toast('Profile saved!','ok');
    } else toast(res.error||'Failed to save','err');
  }catch(e){toast('Error saving profile','err');}
  loading(false);
}

function skipWelcome(){ close_('m-welcome'); toast('Update profile anytime in Settings'); }

/* ── SETTINGS ── */
function openSettings(){
  if(!currentUser||currentUser.role==='guest'){openAuth();return;}
  // Support both old and new HTML field IDs
  const sv=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val;};
  sv('s-name',currentUser.displayName||''); sv('set-dname',currentUser.displayName||'');
  sv('s-bio',currentUser.bio||''); sv('set-bio',currentUser.bio||'');
  sv('s-cur-pass',''); sv('s-new-pass','');
  sv('set-cur-pw',''); sv('set-new-pw',''); sv('set-new-pw2','');
  sv('set-current-uname',currentUser.username||'');
  sv('set-new-uname',''); sv('set-uname-pw','');
  buildEmojiGrid('s-emoji-grid','s-emoji','s-av-emoji-preview',currentUser.avatarEmoji||'👤');
  buildEmojiGrid('set-emoji-grid','set-emoji','set-av-preview',currentUser.avatarEmoji||'👤');
  buildColorSwatches('s-color-swatches','s-banner-color',currentUser.bannerColor||'#0d4a6b');
  buildColorSwatches('set-colors','set-color',currentUser.bannerColor||'#0d4a6b');
  const existingAvatar=currentUser.avatarUrl||currentUser.avatarImage||'';
  if(existingAvatar){
    ['s-avatar-preview','set-img-preview'].forEach(id=>{const img=document.getElementById(id);if(img){img.src=existingAvatar;img.style.display='block';}});
  }
  _avatarImageCache['settings']='';
  open_('m-settings');
}

async function saveProfile(){
  if(!currentUser)return;
  const gv=(ids,fb='')=>{for(const id of ids){const el=document.getElementById(id);if(el&&el.value!==undefined)return el.value.trim();}return fb;};
  const body={action:'updateProfile',username:currentUser.username,password:'__profile_only__',
    displayName:gv(['s-name','set-dname'])||currentUser.displayName,
    bio:gv(['s-bio','set-bio']),
    avatarEmoji:gv(['s-emoji','set-emoji'])||currentUser.avatarEmoji||'👤',
    bannerColor:gv(['s-banner-color','set-color'])||currentUser.bannerColor||'#0d4a6b',
    avatarUrl:_avatarImageCache['settings']||currentUser.avatarUrl||'',avatarImage:''};
  loading(true);
  try{
    const res=await API.post('auth',body);
    if(res.ok){
      currentUser={...currentUser,displayName:res.displayName,avatarEmoji:res.avatarEmoji,avatarUrl:res.avatarUrl||'',avatarImage:'',bio:res.bio,bannerColor:res.bannerColor};
      saveUser(currentUser); renderAuthArea(); renderSidebarUser(); renderComposerBox(); toast('Profile saved!','ok'); render();
    } else toast(res.error||'Failed','err');
  }catch(e){toast('Error','err');}
  loading(false);
}

async function changePassword(){
  if(!currentUser)return;
  // Support both old (set-cur-pw) and new (s-cur-pass) HTML field IDs
  const gv=(a,b)=>(document.getElementById(a)||document.getElementById(b))?.value||'';
  const curPw=gv('s-cur-pass','set-cur-pw');
  const newPw=gv('s-new-pass','set-new-pw');
  // New settings modal has no confirm field; old modal used set-new-pw2
  const newPw2=gv('set-new-pw2','s-new-pass'); // fallback to same as newPw if no confirm field
  if(!curPw){toast('Enter current password','err');return;}
  if(!newPw||newPw.length<6){toast('New password must be 6+ chars','err');return;}
  loading(true);
  try{
    const res=await API.post('auth',{action:'changePassword',username:currentUser.username,password:curPw,newPassword:newPw});
    if(res.ok){
      ['s-cur-pass','s-new-pass','set-cur-pw','set-new-pw','set-new-pw2'].forEach(id=>{
        const el=document.getElementById(id); if(el)el.value='';
      });
      toast('Password changed!','ok');
    } else toast(res.error||'Failed','err');
  }catch(e){toast('Error','err');}
  loading(false);
}

async function changeUsername(){
  if(!currentUser)return;
  const newUname=(document.getElementById('set-new-uname')||document.getElementById('s-new-uname'))?.value?.trim()||'';
  const pw=(document.getElementById('set-uname-pw')||document.getElementById('s-uname-pw'))?.value||'';
  if(!newUname){toast('Enter new username','err');return;}
  if(!pw){toast('Enter your password','err');return;}
  if(newUname.length<3){toast('Username must be 3+ chars','err');return;}
  if(!/^[a-z0-9_.-]+$/i.test(newUname)){toast('Letters, numbers, _ . - only','err');return;}
  loading(true);
  try{
    const res=await API.post('auth',{action:'changeUsername',username:currentUser.username,password:pw,newUsername:newUname.toLowerCase()});
    if(res.ok){currentUser={...currentUser,username:newUname.toLowerCase()};saveUser(currentUser);[document.getElementById('set-current-uname'),document.getElementById('s-current-uname')].forEach(el=>{if(el)el.value=currentUser.username;});document.getElementById('set-new-uname').value='';document.getElementById('set-uname-pw').value='';toast('Username changed to @'+currentUser.username,'ok');}
    else toast(res.error||'Failed','err');
  }catch(e){toast('Error','err');}
  loading(false);
}

/* ── AVATAR IMAGE UPLOAD ── */
const CLOUDINARY_CLOUD_NAME='drfv0uzbo';
const CLOUDINARY_UPLOAD_PRESET='sentinel_avatars';
const CLOUDINARY_MEDIA_PRESET='sentinel_avatars';

async function handleAvatarUpload(input,imgPreviewId,emojiPreviewId,emojiInputId,gridId){
  const file=input.files[0]; if(!file)return;
  if(file.size>5*1024*1024){toast('Image must be under 5MB','err');return;}
  const key=imgPreviewId.includes('welcome')?'welcome':'settings';
  toast('Uploading...','');
  try{
    const fd=new FormData(); fd.append('file',file); fd.append('upload_preset',CLOUDINARY_UPLOAD_PRESET);
    const res=await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,{method:'POST',body:fd});
    const data=await res.json();
    if(!data.secure_url) throw new Error('Upload failed');
    _avatarImageCache[key]=data.secure_url;
    const imgEl=document.getElementById(imgPreviewId); const emojiEl=document.getElementById(emojiPreviewId);
    if(imgEl){ imgEl.src=data.secure_url; imgEl.style.display='block'; }
    if(emojiEl) emojiEl.style.display='none';
    toast('Photo uploaded!','ok');
  }catch(e){toast('Upload failed','err');}
}

/* ── EMOJI / COLOR PICKERS ── */
function buildEmojiGrid(gridId,inputId,previewId,current){
  const grid=document.getElementById(gridId); if(!grid)return;
  grid.innerHTML=AVATARS.map(e=>`<div class="emoji-opt${e===current?' selected':''}" data-emoji="${esc(e)}" onclick="selectEmoji('${esc(gridId)}','${esc(inputId)}','${esc(previewId)}','${esc(e)}')">${esc(e)}</div>`).join('');
  const inp=document.getElementById(inputId); if(inp)inp.value=current;
  const prev=document.getElementById(previewId); if(prev){prev.textContent=current;prev.style.display='flex';}
}

function selectEmoji(gridId,inputId,previewId,emoji){
  document.querySelectorAll('#'+CSS.escape(gridId)+' .emoji-opt').forEach(e=>e.classList.remove('selected'));
  const el=document.querySelector('#'+CSS.escape(gridId)+' [data-emoji="'+CSS.escape(emoji)+'"]');
  if(el) el.classList.add('selected');
  const inp=document.getElementById(CSS.escape(inputId)); if(inp)inp.value=emoji;
  const prev=document.getElementById(CSS.escape(previewId));
  if(prev){prev.textContent=emoji;prev.style.display='flex';}
  const key=gridId.includes('welcome')?'welcome':'settings';
  _avatarImageCache[key]='';
  const imgKey=gridId.includes('welcome')?'welcome-img-preview':'set-img-preview';
  const imgEl=document.getElementById(CSS.escape(imgKey)); if(imgEl)imgEl.style.display='none';
}

function buildColorSwatches(containerId,inputId,current){
  const c=document.getElementById(containerId); if(!c)return;
  c.innerHTML=BANNER_COLORS.map(col=>`<div class="cswatch${col===current?' selected':''}" style="background:${col}" data-color="${esc(col)}" onclick="selectColor('${esc(containerId)}','${esc(inputId)}','${esc(col)}')"></div>`).join('');
  const inp=document.getElementById(inputId); if(inp)inp.value=current;
}

function selectColor(containerId,inputId,color){
  document.querySelectorAll('#'+CSS.escape(containerId)+' .cswatch').forEach(s=>s.classList.remove('selected'));
  const el=document.querySelector('#'+CSS.escape(containerId)+' [data-color="'+CSS.escape(color)+'"]');
  if(el) el.classList.add('selected');
  const inp=document.getElementById(CSS.escape(inputId)); if(inp)inp.value=color;
}

/* ── PROFILE MODAL ── */
function openMyProfile(){ if(currentUser&&currentUser.role!=='guest') openProfile(currentUser.username); }

async function openProfile(username){
  if(!username)return;
  const pTitle=document.getElementById('prof-modal-title');if(pTitle)pTitle.textContent='User Profile';
  document.getElementById('prof-modal-body').innerHTML='<div style="text-align:center;padding:40px;color:var(--text3);font-size:13px">Loading...</div>';
  open_('m-profile');
  try{
    const res=await API.get('profile/'+username.toLowerCase());
    if(!res.ok){document.getElementById('prof-modal-body').innerHTML='<div style="text-align:center;padding:40px;color:var(--text3)">User not found.</div>';return;}
    const u=res.user; const posts=res.posts||[];
    const joined=u.createdAt?fmtTs(u.createdAt):'Unknown';
    const avatarHtml=(u.avatarUrl||u.avatarImage) ? `<img src="${esc(u.avatarUrl||u.avatarImage)}" style="width:100%;height:100%;object-fit:cover" alt="">` : `<span style="font-size:28px">${esc(u.avatarEmoji||'👤')}</span>`;
    const postsHtml=posts.length ? posts.map(p=>`<div class="prof-post-item" onclick="close_('m-profile');setTimeout(()=>openDetail('${esc(p.id)}'),200)"><div class="ppi-title">${esc(p.title)}</div><div class="ppi-meta">${esc(p.category)} · ${ago(p.timestamp)} · ▲${p.votes||0}</div></div>`).join('') : '<div style="font-size:12px;color:var(--text3);padding:8px 0">No public posts.</div>';
    document.getElementById('prof-modal-body').innerHTML=`
      <div class="prof-banner" style="background:${esc(u.bannerColor||'#0d4a6b')}">
        <div class="prof-avatar-wrap">${avatarHtml}</div>
      </div>
      <div class="prof-info">
        <div style="display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap">
          <div><div class="prof-name">${esc(u.displayName||u.username)} ${roleBadgeHtml(u.role)}</div><div class="prof-username">@${esc(u.username)}</div></div>
          ${currentUser&&currentUser.username===u.username?'<button class="btn btn-ghost btn-xs" style="margin-left:auto" onclick="close_(\'m-profile\');openSettings()">✏️ Edit Profile</button>':''}
        </div>
        ${u.bio?`<div class="prof-bio">${esc(u.bio)}</div>`:''}
        <div class="prof-stats">
          <div class="pstat"><strong>${res.postCount||0}</strong>REPORTS</div>
          <div class="pstat"><strong>${joined}</strong>JOINED</div>
        </div>
        <div class="prof-posts-title">PUBLIC REPORTS</div>
        ${postsHtml}
      </div>`;
  }catch(e){document.getElementById('prof-modal-body').innerHTML='<div style="text-align:center;padding:40px;color:var(--text3)">Error loading profile.</div>';}
}

function roleBadgeHtml(role){
  if(!role||role==='citizen') return '';
  const map={reporter:'rb-reporter',staff:'rb-staff',developer:'rb-developer'};
  const cls=map[role]||'rb-citizen';
  return `<span class="role-badge ${cls}">${esc(role.toUpperCase())}</span>`;
}

/* ── TIP MODAL ── */
function openTip(){
  // Support both old and new HTML field IDs
  const sv=(id)=>{const el=document.getElementById(id);if(el)el.value='';};
  sv('tip-title'); sv('tip-desc'); sv('tip-contact');
  sv('t-summary'); sv('t-body'); sv('t-contact');
  setTipUrg('low'); tipUrg='low';
  open_('m-tip');
}
function setTipUrg(v){
  tipUrg=v==='medium'?'med':v;
  // Support both old tip-u-X id style and new data-urg style
  ['low','med','high'].forEach(u=>{const b=document.getElementById('tip-u-'+u);if(b)b.className='ubtn'+(u===tipUrg?' s'+(u==='low'?'l':u==='med'?'m':'h'):'');});
}
async function submitTip(){
  // Support both old field IDs (tip-title/tip-desc) and new HTML IDs (t-summary/t-body)
  const gv=(ids)=>{for(const id of ids){const el=document.getElementById(id);if(el&&el.value.trim())return el.value.trim();}return '';};
  const title=gv(['tip-title','t-summary']);
  const description=gv(['tip-desc','t-body']);
  const contact=gv(['tip-contact','t-contact']);
  if(!title||!description){toast('Title and description required','err');return;}
  loading(true);
  try{
    const res=await API.post('tips',{title,description,urgency:tipUrg,contact});
    if(res.ok){close_('m-tip');toast('Tip submitted! Staff will review it.','ok');}
    else toast(res.error||'Failed to submit','err');
  }catch(e){toast('Error submitting tip','err');}
  loading(false);
}

/* ── NOTIFICATIONS ── */
let _notifs=[];
try{_notifs=JSON.parse(localStorage.getItem('sentinel_notifs')||'[]')}catch{}
function renderNotifBadge(){
  const unread=_notifs.filter(n=>!n.read).length;
  const badge=document.getElementById('notif-badge');
  if(badge){badge.textContent=unread;badge.classList.toggle('show',unread>0);}
  const mbadge=document.getElementById('mbn-notif-badge');
  if(mbadge){mbadge.textContent=unread;mbadge.classList.toggle('show',unread>0);}
}
function renderNotifList(){
  const el=document.getElementById('np-list'); if(!el)return;
  if(!_notifs.length){el.innerHTML='<div class="np-empty">No notifications yet</div>';return;}
  el.innerHTML=_notifs.slice(0,20).map(n=>`<div class="np-item${n.read?'':' unread'}" onclick="markNotifRead('${esc(n.id)}')">
    <span class="np-icon">${esc(n.icon||'📋')}</span>
    <div class="np-content"><div class="np-msg">${esc(n.msg)}</div><div class="np-time">${ago(n.ts)}</div></div>
  </div>`).join('');
}
function addNotif(msg,icon='📋',type='info'){
  const n={id:genId(),msg,icon,type,ts:new Date().toISOString(),read:false};
  _notifs.unshift(n); _notifs=_notifs.slice(0,50);
  try{localStorage.setItem('sentinel_notifs',JSON.stringify(_notifs))}catch{}
  renderNotifBadge();
}
function markNotifRead(id){
  _notifs=_notifs.map(n=>n.id===id?{...n,read:true}:n);
  try{localStorage.setItem('sentinel_notifs',JSON.stringify(_notifs))}catch{}
  renderNotifBadge(); renderNotifList();
}
function clearNotifs(){_notifs=[];try{localStorage.setItem('sentinel_notifs','[]')}catch{}renderNotifBadge();renderNotifList();}
function toggleNotifPanel(){
  const p=document.getElementById('notif-panel'); if(!p)return;
  const opening=!p.classList.contains('open');
  p.classList.toggle('open',opening);
  if(opening){renderNotifList();_notifs.forEach(n=>n.read=true);try{localStorage.setItem('sentinel_notifs',JSON.stringify(_notifs))}catch{}renderNotifBadge();}
}
function closeNotifPanel(){ const p=document.getElementById('notif-panel'); if(p)p.classList.remove('open'); }

function checkSmartNotifs(posts,comments,announcements,reactions){
  if(!currentUser||currentUser.role==='guest') return;
  const lastCheck=parseInt(localStorage.getItem('sentinel_last_check')||'0');
  const now=Date.now();
  if(!lastCheck){localStorage.setItem('sentinel_last_check',now);return;}
  const newAnn=announcements.filter(a=>new Date(a.timestamp)>lastCheck);
  newAnn.forEach(a=>addNotif('New announcement: '+a.title,'📢','ann'));
  if(currentUser){
    const myPosts=posts.filter(p=>p.authorUsername===currentUser.username);
    myPosts.forEach(p=>{
      const newComments=comments.filter(c=>c.postId===p.id&&new Date(c.timestamp)>lastCheck);
      newComments.forEach(c=>addNotif(`${c.displayName||c.author||'Someone'} commented on "${p.title}"`,'💬','comment'));
    });
  }
  localStorage.setItem('sentinel_last_check',now);
}

/* ── DOUBLE-TAP TO LIKE ── */
function onCardTap(postId,event){
  const now=Date.now();
  if(_tapMap[postId]&&now-_tapMap[postId]<380){
    delete _tapMap[postId];
    if(!currentUser||currentUser.role==='guest'){toast('Login to react','err');openAuth();return;}
    doReact(postId,'👍');
    const anim=document.createElement('div'); anim.className='like-anim'; anim.textContent='👍';
    anim.style.left=(event.clientX-20)+'px'; anim.style.top=(event.clientY-20)+'px';
    document.body.appendChild(anim); setTimeout(()=>anim.remove(),700);
  } else { _tapMap[postId]=now; }
}

/* ── REACTIONS ── */
function getUserReaction(postId){
  if(!currentUser||!S.reactions[postId]) return null;
  for(const emoji of REACTIONS){ const list=S.reactions[postId][emoji]||[]; if(list.includes(currentUser.username)) return emoji; }
  return null;
}
function getReactionCount(postId,emoji){ return (S.reactions[postId]&&S.reactions[postId][emoji])?S.reactions[postId][emoji].length:0; }
function reactionBarHtml(postId){
  const userReact=getUserReaction(postId);
  return REACTIONS.map(e=>{
    const count=getReactionCount(postId,e);
    const active=(userReact===e)?'active':'';
    return `<button class="rbtn ${active}" onclick="doReact('${esc(postId)}','${esc(e)}')">${esc(e)}<span class="rc">${count||0}</span></button>`;
  }).join('');
}
async function doReact(postId,emoji){
  if(!currentUser||currentUser.role==='guest'){toast('Login to react','err');openAuth();return;}
  try{
    const res=await API.post('reactions',{postId,emoji,username:currentUser.username});
    if(res.ok){
      if(!S.reactions[postId]) S.reactions[postId]={};
      S.reactions[postId]=res.reactions||S.reactions[postId];
      const bar=document.querySelector(`[data-reaction-bar="${CSS.escape(postId)}"]`);
      if(bar) bar.innerHTML=reactionBarHtml(postId);
    }
  }catch(e){toast('Error reacting','err');}
}

/* ── TABS ── */
function renderTabs(){
  const all=S.posts.length;
  const tabs=[{id:'all',label:'All',count:all},...S.categories.map(c=>({id:c.id,label:(c.icon?c.icon+' ':'')+c.label,count:S.posts.filter(p=>p.category===c.id).length}))];
  document.getElementById('nav-tabs').innerHTML=tabs.map(t=>`<button class="nav-tab${curTab===t.id?' active':''}" onclick="setTab('${esc(t.id)}')">${esc(t.label)}<span class="tab-count">${t.count}</span></button>`).join('');
}
function setTab(id){curTab=id; render(); renderTabs();}
function setTabByCategory(id){curTab=id; render(); sidebarNavActive();}
function setSt(v,btn){
  curStatus=v;
  document.querySelectorAll('.filter-chip').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  render();
}
function onSearch(){
  const q=document.getElementById('search-input').value.trim();
  render();
}
function clearSearch(){
  const inp=document.getElementById('search-input'); if(inp){inp.value='';updateSearchClear();render();}
}
function updateSearchClear(){
  const inp=document.getElementById('search-input');
  const btn=document.getElementById('search-clear');
  if(btn) btn.classList.toggle('visible',!!(inp&&inp.value));
}
function setTagFilter(tag){
  const inp=document.getElementById('search-input'); if(inp){inp.value=tag.replace('#','');updateSearchClear();render();}
}
function navTabSwitch(name,btn){
  document.querySelectorAll('.nav-tab-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(name==='home'){curTab='all';curStatus='all';render();}
  else if(name==='trending'){curStatus='all';curTab='all';render();}
}
function sidebarNav(name,btn){
  document.querySelectorAll('.sidebar-nav-item').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(name==='home'){curTab='all';curStatus='all';render();}
}
function sidebarNavActive(){
  document.querySelectorAll('.sidebar-nav-item').forEach(b=>b.classList.remove('active'));
}

/* ── ANNOUNCEMENTS ── */
function renderAnnouncements(){
  document.getElementById('ann-container').innerHTML=(S.announcements||[]).map((a,i)=>`
    <div class="announcement">
      <span class="ann-ico">📢</span>
      <div class="ann-body">
        <div class="ann-badge">ANNOUNCEMENT · ${ago(a.timestamp)}</div>
        <div class="ann-title">${esc(a.title)}</div>
        <div class="ann-content">${esc(a.content)}</div>
      </div>
      <button class="ann-dismiss" onclick="this.closest('.announcement').remove()">✕</button>
    </div>`).join('');
}

function populateCatSelect(id){
  const sel=document.getElementById(id); if(!sel)return;
  sel.innerHTML=S.categories.map(c=>`<option value="${esc(c.id)}">${esc(c.icon)} ${esc(c.label)}</option>`).join('');
}

/* ── RIGHT SIDEBAR WIDGETS ── */
function renderTrendingWidget(){
  const el=document.getElementById('trending-list'); if(!el)return;
  const tagCounts={};
  S.posts.forEach(p=>(p.tags||[]).forEach(t=>{tagCounts[t]=(tagCounts[t]||0)+1;}));
  const sorted=Object.entries(tagCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  if(!sorted.length){el.innerHTML='<div style="padding:14px;text-align:center;font-size:12px;color:var(--text3)">No tags yet</div>';return;}
  el.innerHTML=sorted.map(([tag,count],i)=>`<div class="trending-item" onclick="setTagFilter('#${esc(tag)}')">
    <div class="ti-rank${i<3?' top':''}">${i+1}</div>
    <div class="ti-body">
      <div class="ti-tag">#${esc(tag)}</div>
      <div class="ti-count">${count} report${count!==1?'s':''}</div>
    </div>
    ${i===0?'<span style="font-size:9px;font-weight:800;color:var(--primary);font-family:var(--font-mono);letter-spacing:.05em;border:1px solid var(--primary-glow);padding:2px 6px;border-radius:8px">HOT</span>':''}
  </div>`).join('');
}

function renderTopReportersWidget(){
  const el=document.getElementById('top-reporters-list'); if(!el)return;
  const counts={};
  S.posts.forEach(p=>{if(p.authorUsername&&!p.anonymous) counts[p.authorUsername]=(counts[p.authorUsername]||0)+1;});
  const sorted=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,4);
  if(!sorted.length){el.innerHTML='<div style="padding:14px;text-align:center;font-size:12px;color:var(--text3)">No reporters yet</div>';return;}
  const avGrads=['linear-gradient(135deg,#f093fb,#f5576c)','linear-gradient(135deg,#4facfe,#00f2fe)','linear-gradient(135deg,#43e97b,#38f9d7)','linear-gradient(135deg,#fa709a,#fee140)'];
  el.innerHTML=sorted.map(([uname,count],i)=>{
    const post=S.posts.find(p=>p.authorUsername===uname);
    const name=post?.displayName||uname;
    const initial=name ? name[0].toUpperCase() : '?';
    return `<div class="top-reporter-item" onclick="openProfile('${esc(uname)}')">
      <div class="tr-av" style="background:${avGrads[i%4]};position:relative">
        ${initial}
        <div style="position:absolute;bottom:-3px;right:-3px;width:14px;height:14px;background:var(--green);border-radius:50%;border:2px solid var(--surface);display:flex;align-items:center;justify-content:center;font-size:7px;color:#fff;font-weight:800">✓</div>
      </div>
      <div style="flex:1;min-width:0">
        <div class="tr-name">${esc(name)}</div>
        <div class="tr-count">${count} report${count!==1?'s':''}</div>
      </div>
      <button style="font-size:11px;font-weight:700;padding:4px 10px;border:1.5px solid var(--border2);border-radius:20px;background:none;color:var(--text2);cursor:pointer;flex-shrink:0;transition:all .15s" onmouseover="this.style.borderColor='var(--primary)';this.style.color='var(--primary)'" onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--text2)'" onclick="event.stopPropagation();toast('Follow feature coming soon','')">Follow</button>
    </div>`;
  }).join('');
}

function renderStatNumbers(){
  if(!canModerate(currentUser?.role)) return;
  const el=id=>document.getElementById(id);
  if(el('rs-total')) el('rs-total').textContent=S.posts.length;
  if(el('rs-verified')) el('rs-verified').textContent=S.posts.filter(p=>p.status==='verified').length;
  if(el('rs-urgent')) el('rs-urgent').textContent=S.posts.filter(p=>p.urgency==='high').length;
}

/* ── RENDER FEED (paginated version below in MOBILE IMPROVEMENTS section) ── */

function catLabel(id){const c=S.categories.find(x=>x.id===id);return c?c.icon+' '+c.label:id;}
function statusHtml(s){
  const m={verified:{cls:'sp-v',lbl:'✅ Verified'},reviewing:{cls:'sp-r',lbl:'🔍 Reviewing'},unverified:{cls:'sp-u',lbl:'◈ Unverified'}};
  const x=m[s]||m.unverified; return `<span class="sp ${x.cls}">${x.lbl}</span>`;
}
function urgencyHtml(u){
  const m={high:`<span style="color:var(--primary);font-family:'JetBrains Mono',monospace;font-size:9px;border:1px solid rgba(232,55,44,.3);padding:2px 6px;border-radius:10px;background:var(--primary-lt)">▲ URGENT</span>`,med:`<span style="color:var(--amber);font-family:'JetBrains Mono',monospace;font-size:9px">◈ MEDIUM</span>`,low:''};
  return m[u]||'';
}



function toggleReactPanel(postId){
  if(!currentUser||currentUser.role==='guest'){toast('Login to react','err');openAuth();return;}
  const panel=document.getElementById('react-panel-'+CSS.escape(postId));
  if(panel) panel.style.display=panel.style.display==='none'?'flex':'none';
}

function sharePost(id){
  const url=location.origin+location.pathname+'?post='+id;
  if(navigator.share){navigator.share({title:'SENTINEL Report',url}).catch(()=>{});}
  else{navigator.clipboard.writeText(url).then(()=>toast('Link copied!','ok')).catch(()=>toast('Copy: '+url,''));}
}

/* ── OPEN NEW REPORT ── */
function openNew(){
  if(!currentUser||currentUser.role==='guest'){
    toast('Login to file a report','err');openAuth();return;
  }
  const n=document.getElementById('login-required-notice');
  const b=document.getElementById('report-form-body');
  if(n) n.style.display='none';
  if(b) b.style.display='block';
  populateCatSelect('n-cat'); curUrg='low'; populateBranchSelect();
  // Reset urgency buttons to Low
  document.querySelectorAll('.ubtn[data-urg]').forEach(b=>b.classList.remove('sl','sm','sh'));
  const defUrgBtn=document.querySelector('.ubtn[data-urg="low"]'); if(defUrgBtn)defUrgBtn.classList.add('sl');
  const sv=(id)=>{const el=document.getElementById(id);if(el)el.value='';};
  sv('n-title'); sv('n-body'); sv('n-content');
  sv('n-officials'); sv('n-location'); sv('n-tags');
  // Reset officials list
  const ol=document.getElementById('n-officials-list');if(ol)ol.innerHTML='';
  const hid=document.getElementById('n-officials');if(hid)hid.value='[]';
  // Reset anon toggle
  const anonChk=document.getElementById('n-anon-chk');if(anonChk)anonChk.checked=false;
  const anonLbl=document.getElementById('n-anon-lbl');if(anonLbl)anonLbl.innerHTML='Post <strong>Publicly</strong>';
  mediaFiles=[]; renderPreviews();
  updatePostingAsDisplay();
  open_('m-new');
}

function setUrg(ctx,btn,v){
  // Handles both: setUrg('new',this,'high') from HTML AND setUrg('low') from code
  let urgVal;
  if(v!==undefined){
    urgVal=v; // 3-arg HTML call
  } else {
    urgVal=ctx||'low'; // 1-arg code call
    btn=null;
  }
  // Normalise 'medium' -> 'med' for internal use but keep 'high'/'low' as-is
  const normUrg=urgVal==='medium'?'med':urgVal;
  if(ctx==='tip'){
    tipUrg=normUrg;
  } else {
    curUrg=normUrg;
  }
  // Deactivate all urgency buttons in the same parent form
  const parentForm = btn ? btn.closest('.modal,.mbody,.lf-pane') : null;
  const scope = parentForm || document;
  scope.querySelectorAll('.ubtn[data-urg]').forEach(b=>{
    b.classList.remove('sl','sm','sh');
  });
  // Activate the clicked button
  if(btn){
    const cls=normUrg==='low'?'sl':normUrg==='med'||normUrg==='medium'?'sm':'sh';
    btn.classList.add(cls);
  }
  // Legacy: also update old-style ID-based buttons if they exist
  ['low','med','high'].forEach(u=>{
    const b=document.getElementById('u-'+u);
    if(b) b.className='ubtn'+(u===normUrg?' s'+(u==='low'?'l':u==='med'?'m':'h'):'');
  });
}
function updatePostingAsDisplay(){
  const el=document.getElementById('posting-as-display'); if(!el)return;
  if(!currentUser||currentUser.role==='guest'){el.textContent='— Login to post';return;}
  el.textContent='Posting as: '+(currentUser.displayName||currentUser.username);
}

/* ── MEDIA UPLOAD (see MAX_MEDIA version below) ── */

function toBase64(file){return new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(file);});}

function renderPreviews(){
  const grid=document.getElementById('n-prev-grid')||document.getElementById('n-prev'); if(!grid)return;
  if(!mediaFiles.length){grid.style.display='none';return;}
  grid.style.display='flex';
  grid.innerHTML=mediaFiles.map((m,i)=>{
    if(m.type==='image') return`<div class="pthumb"><img src="${m.url||m.data}" alt=""><button class="pthumb-rm" onclick="removeMedia(${i})">✕</button></div>`;
    return`<div class="paudio">🎵<span>AUDIO</span><button class="pthumb-rm" onclick="removeMedia(${i})">✕</button></div>`;
  }).join('');
}

function removeMedia(i){mediaFiles.splice(i,1);renderPreviews();}

/* ── SUBMIT POST ── */
async function submitPost(){
  if(!currentUser||currentUser.role==='guest'){toast('Login required','err');return;}
  const title=(document.getElementById('n-title')?.value||'').trim();
  // Support both n-content (old) and n-body (new HTML)
  const content=(document.getElementById('n-body')?.value||document.getElementById('n-content')?.value||'').trim();
  const anonChk=document.getElementById('n-anon-chk')||document.getElementById('n-anon');
  const anon=anonChk?anonChk.checked:false;
  if(!title||!content){toast('Title and content are required','err');return;}
  // Tags: support comma-separated or space/hash separated
  const rawTags=(document.getElementById('n-tags')?.value||'');
  const tags=rawTags.split(/[,\s]+/).map(t=>t.replace(/^#/,'')).filter(Boolean);
  // Officials: support both JSON array (new) and plain string (old)
  let officialsVal='';
  const offHid=document.getElementById('n-officials');
  if(offHid&&offHid.value&&offHid.value!=='[]'){
    try{const arr=JSON.parse(offHid.value);officialsVal=Array.isArray(arr)?arr.join(', '):offHid.value;}catch{officialsVal=offHid.value;}
  }
  // Location: support both select (new) and text input (old)
  const locationVal=(document.getElementById('n-location')?.value||'').trim();
  const body={
    id:genId(),title,content,
    category:document.getElementById('n-cat')?.value||'other',
    urgency:curUrg,
    officials:officialsVal,
    location:locationVal,
    tags,media:mediaFiles,
    anonymous:anon,
    author:anon?'Anonymous':(currentUser.displayName||currentUser.username),
    displayName:anon?'Anonymous':(currentUser.displayName||currentUser.username),
    authorUsername:anon?null:currentUser.username,
    timestamp:new Date().toISOString()
  };
  const sbtn=document.getElementById('submit-btn')||document.getElementById('n-submit-btn');if(sbtn)sbtn.disabled=true; loading(true);
  try{
    const res=await API.post('posts',body);
    if(res.ok){
      ['n-title','n-body','n-content','n-tags'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
      const ol=document.getElementById('n-officials-list');if(ol)ol.innerHTML='';
      const hid=document.getElementById('n-officials');if(hid)hid.value='[]';
      mediaFiles=[]; renderPreviews();
      close_('m-new'); toast('Report submitted!','ok'); addNotif('Your report was submitted','📋','info'); await loadData();
    } else toast(res.error||'Error submitting','err');
  }catch(e){toast('Error submitting report','err');}
  if(sbtn)sbtn.disabled=false; loading(false);
}

/* ── CHAR COUNTER ── */
function updateCount(inputId,countId,max){
  const inp=document.getElementById(inputId); const ct=document.getElementById(countId);
  if(!inp||!ct)return;
  const len=inp.value.length;
  ct.textContent=len+'/'+max;
  ct.style.color=len>max*0.9?'var(--primary)':len>max*0.7?'var(--amber)':'var(--text3)';
}

/* ── DETAIL MODAL ── */
async function openDetail(postId){
  const p=S.posts.find(x=>x.id===postId); if(!p)return;
  const dId=document.getElementById('d-id');if(dId)dId.textContent='Report #'+postId.slice(0,8).toUpperCase();
  const cmts=S.comments.filter(c=>c.postId===postId);
  const histHtml=(p.statusHistory||[]).length?`<div class="status-timeline"><div class="stl-title">STATUS HISTORY</div><div class="stl-track">${p.statusHistory.map(h=>`<div class="stl-item stl-${esc(h.status||'unverified')}"><div class="stl-dot"></div><div><div class="stl-label">${esc((h.status||'UNVERIFIED').toUpperCase())}</div><div class="stl-time">${fmtTs(h.timestamp)}</div></div></div>`).join('')}</div></div>`:'';
  const cmtsHtml=cmts.length?cmts.map(c=>`<div class="ci">
    <div class="ci-avatar"><span>${esc(c.avatarEmoji||'👤')}</span></div>
    <div class="ci-body">
      <div class="cmeta"><span class="cuser" onclick="openProfile('${esc(c.authorUsername||'')}')">@${esc(c.displayName||c.author||'Anonymous')}</span><span class="ctime">${ago(c.timestamp)}</span>${canModerate(currentUser?.role)?`<button class="btn btn-xs btn-danger" onclick="staffDeleteComment('${esc(c.id)}','${esc(postId)}')">✕ Del</button>`:''}
      </div>
      <div class="ctxt">${esc(c.text)}</div>
    </div>
  </div>`).join(''):'<div style="font-size:13px;color:var(--text3);padding:8px 0">No comments yet.</div>';

  const canComment=canPost(currentUser?.role);
  const commentFormHtml=!p.locked&&canComment?`<div class="cform">
    <textarea id="cmt-txt-${CSS.escape(postId)}" placeholder="Write a comment…"></textarea>
    <div class="cfoot">
      <label class="atog"><input type="checkbox" id="cmt-anon-${CSS.escape(postId)}"><div class="atrack"></div><div class="albl">Anonymous</div></label>
      <button class="btn btn-primary btn-sm" onclick="submitComment('${esc(postId)}')">💬 Comment</button>
    </div>
  </div>`:p.locked?'<div class="locked-notice">🔒 Comments locked</div>':'<div class="locked-notice">Login to comment</div>';

  const fullMediaHtml=(p.media||[]).map(m=>{
    if(m.type==='image'){const src=m.data||m.url||'';return`<div class="mthumb" onclick="openLB('${src}',[])"><img src="${src}" alt=""></div>`;}
    return'';
  }).join('');

  // Support both old (d-body) and new (detail-body) HTML modal IDs
  const dBody=document.getElementById('detail-body')||document.getElementById('d-body');
  if(!dBody)return;
  dBody.innerHTML=`
    <div style="margin-bottom:14px">
      ${statusHtml(p.status)} ${urgencyHtml(p.urgency)}
      ${p.pinned?'<span class="card-role-badge rb-pinned">📌 Pinned</span>':''}
    </div>
    <h2 style="font-size:20px;font-weight:800;color:var(--text1);margin-bottom:10px;line-height:1.3">${esc(p.title)}</h2>
    <div style="font-size:12px;color:var(--text3);margin-bottom:14px;display:flex;gap:10px;flex-wrap:wrap">
      <span>By <b onclick="openProfile('${esc(p.authorUsername||'')}')" style="cursor:pointer;color:var(--primary)">${esc(p.displayName||p.author||'Anonymous')}</b></span>
      <span>${fmtTs(p.timestamp)}</span>
      ${p.location?`<span>📍 ${esc(p.location)}</span>`:''}
      ${p.officials?`<span>👤 ${esc(p.officials)}</span>`:''}
    </div>
    ${histHtml}
    ${fullMediaHtml?`<div class="media-strip" style="margin-bottom:14px">${fullMediaHtml}</div>`:''}
    <div style="font-size:15px;line-height:1.7;color:var(--text2);margin-bottom:16px;white-space:pre-wrap">${esc(p.content)}</div>
    ${(p.tags||[]).length?`<div class="card-tags" style="margin-bottom:16px">${p.tags.map(t=>`<span class="tag">#${esc(t)}</span>`).join('')}</div>`:''}
    <div style="margin-bottom:16px"><div data-reaction-bar="${CSS.escape(postId)}" style="display:flex;flex-wrap:wrap;gap:6px">${reactionBarHtml(postId)}</div></div>
    <div class="cmts"><h4>💬 Comments (${cmts.length})</h4>${cmtsHtml}${commentFormHtml}</div>
  `;
  open_('m-detail');
}

async function submitComment(postId){
  if(!currentUser||currentUser.role==='guest'){toast('Login to comment','err');return;}
  const txt=document.getElementById('cmt-txt-'+CSS.escape(postId))?.value.trim();
  if(!txt){toast('Write something first','err');return;}
  const anon=document.getElementById('cmt-anon-'+CSS.escape(postId))?.checked||false;
  loading(true);
  try{
    const res=await API.post('comments',{id:genId(),postId,text:txt,anonymous:anon,author:anon?'Anonymous':(currentUser.displayName||currentUser.username),displayName:anon?'Anonymous':(currentUser.displayName||currentUser.username),authorUsername:anon?null:currentUser.username,avatarEmoji:anon?'👤':(currentUser.avatarEmoji||'👤'),timestamp:new Date().toISOString()});
    if(res.ok){await loadData();openDetail(postId);toast('Comment posted!','ok');}
    else toast(res.error||'Error posting','err');
  }catch(e){toast('Error posting comment','err');}
  loading(false);
}

async function staffDeleteComment(commentId,postId){
  if(!confirm('Delete this comment?'))return;
  loading(true);
  try{
    let res;
    if(devAuthed){
      res=await API.post('admin',{action:'deleteComment',passkey:devPass,data:{commentId}});
    } else {
      res=await API.post('staff',{action:'deleteComment',username:currentUser.username,data:{commentId}});
    }
    if(res.ok){toast('Comment deleted','ok');await loadData();openDetail(postId);}
    else toast(res.error||'Failed','err');
  }catch(e){toast('Error','err');}
  loading(false);
}

/* ── STAFF QUICK ACTIONS ON CARDS ── */
async function staffQuick(id,action){
  if(!canModerate(currentUser?.role)){toast('No permission','err');return;}
  let data={id};
  if(action==='verify') data.status='verified';
  else if(action==='review') data.status='reviewing';
  else if(action==='unverify') data.status='unverified';
  else if(action==='pin') data.pinned=true;
  else if(action==='unpin') data={id,pinned:false};
  else if(action==='delete'){
    if(!isDevRole(currentUser?.role)){toast('Developer only','err');return;}
    loading(true);
    try{const res=await API.post('admin',{action:'delete',passkey:devPass,data:{id}});if(res.ok){toast('Deleted','ok');await loadData();}else toast(res.error||'Failed','err');}
    catch(e){toast('Error','err');}
    loading(false);return;
  }
  loading(true);
  try{
    if(devAuthed){
      const apiAction=action==='verify'||action==='review'||action==='unverify'?'status':action;
      if(action==='verify'||action==='review'||action==='unverify') data={id,status:data.status};
      const res=await API.post('admin',{action:apiAction,passkey:devPass,data});
      if(res.ok){toast('Done!','ok');await loadData();}
      else toast(res.error||'Failed','err');
    } else {
      const res=await API.post('staff',{action,username:currentUser.username,data});
      if(res.ok){toast('Done!','ok');await loadData();}
      else toast(res.error||'Failed (login to Dev Panel for full access)','err');
    }
  }catch(e){toast('Error','err');}
  loading(false);
}

/* ── DEV QUICK MENU ── */
function toggleDevMenu(id,btn){
  const menu=document.getElementById('dqm-'+CSS.escape(id));
  if(!menu)return;
  const isOpen=menu.classList.contains('open');
  document.querySelectorAll('.dev-quick-menu.open').forEach(m=>m.classList.remove('open'));
  if(!isOpen) menu.classList.add('open');
}

async function devQuick(id,action){
  if(!devAuthed){open_('m-dlogin');toast('Enter your dev passkey to continue','dev','🛡');return;}
  let aname=action, data={id};
  if(action==='verify') {aname='status';data.status='verified';}
  else if(action==='review') {aname='status';data.status='reviewing';}
  else if(action==='unverify') {aname='status';data.status='unverified';}
  else if(action==='pin') data.pinned=true;
  else if(action==='unpin') data={id,pinned:false};
  else if(action==='lock') data.locked=true;
  else if(action==='unlock') {aname='unlock';data.locked=false;}
  else if(action==='delete'){aname='delete';}
  loading(true);
  try{
    const res=await API.post('admin',{action:aname,passkey:devPass,data});
    if(res.ok){toast('Done!','ok');await loadData();}
    else toast(res.error||'Failed','err');
  }catch(e){toast('Error','err');}
  loading(false);
}

/* ── LIGHTBOX ── */
let _lbImages=[], _lbIdx=0;
function openLB(src,allImages){
  if(Array.isArray(allImages)&&allImages.length){_lbImages=allImages;_lbIdx=allImages.indexOf(src);}
  else{_lbImages=[src];_lbIdx=0;}
  _lbShow();document.getElementById('lightbox').classList.add('open');document.body.classList.add('modal-open');
}
function _lbShow(){
  const src=_lbImages[_lbIdx]||''; document.getElementById('lb-img').src=src;
  const prev=document.getElementById('lb-prev'); const next=document.getElementById('lb-next'); const ctr=document.getElementById('lb-counter');
  if(prev)prev.style.display=_lbImages.length>1?'flex':'none';
  if(next)next.style.display=_lbImages.length>1?'flex':'none';
  if(ctr)ctr.textContent=_lbImages.length>1?`${_lbIdx+1} / ${_lbImages.length}`:'';
}
function lbNav(dir){_lbIdx=(_lbIdx+dir+_lbImages.length)%_lbImages.length;_lbShow();}
function closeLB(){document.getElementById('lightbox').classList.remove('open');if(!document.querySelector('.overlay.open'))document.body.classList.remove('modal-open');}

/* ── STAFF PANEL ── */
function openStaffPanel(){
  if(!canModerate(currentUser?.role)){toast('No access','err');return;}
  loadPendingUsersStaff();
  staffRenderReports();
  open_('m-staff');
}
function staffTab(name,btn){
  document.querySelectorAll('.staff-tab').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.staff-pane').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('sp-'+name).classList.add('active');
}
async function loadPendingUsersStaff(){
  const el=document.getElementById('staff-pending-list'); if(!el)return;
  el.innerHTML='<div style="font-size:12px;color:var(--text3)">Loading...</div>';
  try{
    const res=await API.post('admin',{action:'getPending',passkey:devAuthed?devPass:'__staff_check__',data:{}});
    if(!res.ok){
      const res2=await API.post('staff',{action:'getPending',username:currentUser.username,data:{}});
      if(!res2.ok){el.innerHTML='<div style="font-size:12px;color:var(--primary)">Unable to load — Dev Panel must be authenticated.</div>';return;}
      renderPendingListStaff(res2.pending||[],el);return;
    }
    renderPendingListStaff(res.pending||[],el);
    const n=(res.pending||[]).length;
    const badge=document.getElementById('pending-count-badge');
    if(badge){badge.textContent=n;badge.style.display=n>0?'flex':'none';}
    if(document.getElementById('rs-pending')) document.getElementById('rs-pending').textContent=n;
  }catch(e){el.innerHTML='<div style="font-size:12px;color:var(--primary)">Error loading.</div>';}
}
function renderPendingListStaff(pending,el){
  if(!pending.length){el.innerHTML='<div style="font-size:13px;color:var(--text3);text-align:center;padding:20px">No pending registrations.</div>';return;}
  el.innerHTML=pending.map(u=>`<div class="pend-card" id="spu-${esc(u.username)}">
    <div class="pend-user">${esc(u.displayName||u.username)} <span style="font-size:18px">${esc(u.avatarEmoji||'👤')}</span></div>
    <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3);margin-bottom:6px">@${esc(u.username)}${u.realName?' · '+esc(u.realName):''}</div>
    <div class="pend-reason">"${esc(u.reason)}"</div>
    <div class="pend-meta">Registered: ${fmtTs(u.createdAt)}</div>
    <div class="pend-actions">
      <select class="role-pick" id="sp-role-${esc(u.username)}">
        <option value="citizen">CITIZEN</option>
        <option value="reporter">REPORTER</option>
        ${isDevRole(currentUser?.role)?'<option value="staff">STAFF</option><option value="developer">DEVELOPER</option>':''}
      </select>
      <button class="btn btn-primary btn-xs" onclick="staffApproveUser('${esc(u.username)}')">✓ Approve</button>
      <button class="btn btn-danger btn-xs" onclick="staffRejectUser('${esc(u.username)}')">✕ Reject</button>
    </div>
  </div>`).join('');
}
async function staffApproveUser(username){
  const roleEl=document.getElementById('sp-role-'+CSS.escape(username));
  const role=roleEl?.value||'citizen';
  if(!isDevRole(currentUser?.role)&&(role==='staff'||role==='developer')){toast('Only developers can assign staff/developer roles','err');return;}
  loading(true);
  try{
    const pass=devAuthed?devPass:'__staff_approve__';
    const res=await API.post('admin',{action:'approveUser',passkey:pass,data:{username,role}});
    if(res.ok){toast(username+' approved as '+role,'ok');loadPendingUsersStaff();loadPendingCount();}
    else{
      const res2=await API.post('staff',{action:'approveUser',username:currentUser.username,data:{username,role}});
      if(res2.ok){toast(username+' approved as '+role,'ok');loadPendingUsersStaff();}
      else toast(res2.error||'Failed','err');
    }
  }catch(e){toast('Error','err');}
  loading(false);
}
async function staffRejectUser(username){
  if(!confirm('Reject @'+username+'?'))return;
  loading(true);
  try{
    const pass=devAuthed?devPass:'__staff_reject__';
    const res=await API.post('admin',{action:'rejectUser',passkey:pass,data:{username}});
    if(res.ok){toast(username+' rejected','ok');loadPendingUsersStaff();}
    else{
      const res2=await API.post('staff',{action:'rejectUser',username:currentUser.username,data:{username}});
      if(res2.ok){toast(username+' rejected','ok');loadPendingUsersStaff();}
      else toast(res2.error||'Failed','err');
    }
  }catch(e){toast('Error','err');}
  loading(false);
}

/* ── DEV PANEL ── */
function openDev(){devAuthed?openDevPanel():open_('m-dlogin');}
function devLogout(){
  if(!confirm('End developer session? You will need to re-enter the passkey to access the Dev Panel again.')) return;
  devAuthed=false; devPass='';
  close_('m-dev');
  toast('Developer session ended','dev','⬡');
}
async function devLogin(){
  const p=(document.getElementById('d-pass')||document.getElementById('dpass'))?.value||'';
  loading(true);
  try{
    const res=await API.post('admin',{action:'getLog',passkey:p,data:{}});
    if(res.ok){devPass=p;devAuthed=true;close_('m-dlogin');[document.getElementById('d-pass'),document.getElementById('dpass')].forEach(el=>{if(el)el.value=''});openDevPanel();}
    else toast('Invalid passkey','err');
  }catch(e){toast('Error','err');}
  loading(false);
}
function openDevPanel(){
  // Update stats badges
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('ds-total',S.posts.length);
  set('ds-verified',S.posts.filter(p=>p.status==='verified').length);
  set('ds-urgent',S.posts.filter(p=>p.urgency==='high').length);
  loadPendingCount();
  renderCatList();
  renderBranchList();
  renderAnnPreview();
  // Init the dev panel tabs - show accounts by default
  ['dp-accounts','dp-posts','dp-system'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.display=id==='dp-accounts'?'block':'none';
  });
  document.querySelectorAll('.modal-dev .staff-tab').forEach((b,i)=>{
    b.classList.toggle('active',i===0);
  });
  // CRITICAL: actually open the modal overlay
  open_('m-dev');
}
function devTab(name,btn){
  // Top-level dev panel tab switcher (accounts / posts / system)
  document.querySelectorAll('.modal-dev .staff-tab,.modal-dev .dev-tab').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  // Support both old .dev-pane and new dp-* IDs
  document.querySelectorAll('.dev-pane').forEach(p=>p.classList.remove('active'));
  ['dp-accounts','dp-posts','dp-system'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.display=id.endsWith(name)?'block':'none';
  });
  const oldPane=document.getElementById('dp-'+name);
  if(oldPane) oldPane.classList.add('active');
  if(name==='posts'){setTimeout(()=>populatePickers(),50);}
  if(name==='accounts'){loadPendingCount();}
}
function renderStatusBreakdown(){
  const el=document.getElementById('dev-status-breakdown'); if(!el)return;
  const counts={unverified:0,reviewing:0,verified:0};
  S.posts.forEach(p=>counts[p.status]=(counts[p.status]||0)+1);
  el.innerHTML=Object.entries(counts).map(([s,n])=>`<div class="dstat"><div class="dn" style="font-size:18px">${n}</div><div class="dl">${s.toUpperCase()}</div></div>`).join('');
}
function renderPinnedList(){
  const el=document.getElementById('pinned-list'); if(!el)return;
  const pinned=S.posts.filter(p=>p.pinned);
  el.innerHTML=pinned.length?pinned.map(p=>`<div class="pli"><span class="pli-badge">📌</span><span class="plt">${esc(p.title)}</span><button class="btn btn-ghost btn-xs" onclick="quickUnpin('${esc(p.id)}')">✕ Unpin</button></div>`).join(''):'<div style="color:var(--text3);font-size:12px">No pinned reports.</div>';
}
async function quickUnpin(id){
  try{await API.post('admin',{action:'unpin',passkey:devPass,data:{id}});await loadData();renderPinnedList();toast('Unpinned','ok');}
  catch(e){toast('Error','err');}
}
async function loadActivityLog(){
  try{
    const res=await API.post('admin',{action:'getLog',passkey:devPass,data:{}});
    if(res.ok){const el=document.getElementById('dev-log');el.innerHTML=res.log.slice(0,40).map(l=>`<div class="log-item"><span class="log-action">${esc(l.action)}</span><span class="log-detail">${esc(l.detail)}</span><span class="log-time">${ago(l.timestamp)}</span></div>`).join('')||'<div style="color:var(--text3)">No entries.</div>';}
  }catch(e){toast('Error loading log','err');}
}

/* ── BULK ── */
function renderBulkList(){
  const el=document.getElementById('bulk-post-list'); if(!el)return;
  const query=(document.getElementById('bulk-search')?.value||'').toLowerCase().trim();
  let posts=S.posts;
  if(query) posts=posts.filter(p=>p.title.toLowerCase().includes(query)||(p.author||'').toLowerCase().includes(query)||(p.status||'').toLowerCase().includes(query));
  const total=posts.length; const totalPages=Math.ceil(total/BULK_PER_PAGE);
  if(bulkPage>=totalPages) bulkPage=Math.max(0,totalPages-1);
  const slice=posts.slice(bulkPage*BULK_PER_PAGE,(bulkPage+1)*BULK_PER_PAGE);
  el.innerHTML=slice.map(p=>`<div class="bulk-item"><input type="checkbox" ${selectedBulk.has(p.id)?'checked':''} onchange="toggleBulk('${esc(p.id)}',this.checked)"><span class="bulk-item-title">${esc(p.title)}</span><span class="bulk-item-status">${(p.status||'').toUpperCase().slice(0,4)}</span></div>`).join('');
  updateBulkCount();
  const pg=document.getElementById('bulk-pagination'); if(!pg)return;
  if(totalPages<=1){pg.innerHTML='';return;}
  pg.innerHTML=`<span>${total} posts</span> <button class="btn btn-ghost btn-xs" onclick="bulkPage=0;renderBulkList()" ${bulkPage===0?'disabled':''}>«</button><button class="btn btn-ghost btn-xs" onclick="bulkPage--;renderBulkList()" ${bulkPage===0?'disabled':''}>‹</button><span>Page ${bulkPage+1}/${totalPages}</span><button class="btn btn-ghost btn-xs" onclick="bulkPage++;renderBulkList()" ${bulkPage>=totalPages-1?'disabled':''}>›</button><button class="btn btn-ghost btn-xs" onclick="bulkPage=${totalPages-1};renderBulkList()" ${bulkPage>=totalPages-1?'disabled':''}>»</button>`;
}
function toggleBulk(id,checked){if(checked)selectedBulk.add(id);else selectedBulk.delete(id);updateBulkCount();}
function updateBulkCount(){const el=document.getElementById('bulk-count');if(el)el.textContent=selectedBulk.size+' selected';}
function bulkSelectAll(){S.posts.forEach(p=>selectedBulk.add(p.id));renderBulkList();}
function bulkSelectNone(){selectedBulk.clear();renderBulkList();}
function bulkSelectUnverified(){selectedBulk.clear();S.posts.filter(p=>p.status==='unverified').forEach(p=>selectedBulk.add(p.id));renderBulkList();}
async function applyBulkAction(){
  if(!selectedBulk.size){toast('Select at least one','err');return;}
  const action=document.getElementById('bulk-action-sel').value;
  const ids=[...selectedBulk];
  if(action==='delete'){if(!confirm('Delete '+ids.length+' reports permanently?'))return;}
  loading(true);
  try{
    let res;
    if(action==='delete') res=await API.post('admin',{action:'bulkDelete',passkey:devPass,data:{ids}});
    else res=await API.post('admin',{action:'bulkStatus',passkey:devPass,data:{ids,status:action}});
    if(res.ok){toast('Bulk action applied!','ok');selectedBulk.clear();await loadData();renderBulkList();}
    else toast(res.error||'Failed','err');
  }catch(e){toast('Error','err');}
  loading(false);
}

/* ── SINGLE PICKER ── */
// _allPosts is declared in the MOBILE IMPROVEMENTS section below
function populatePickers(){_allPosts=S.posts;filterPicker();}
function filterPicker(){
  const q=(document.getElementById('picker-search')?.value||'').toLowerCase();
  const posts=q?_allPosts.filter(p=>p.title.toLowerCase().includes(q)||p.id.includes(q)):_allPosts;
  const sel=document.getElementById('main-pick'); if(!sel)return;
  sel.innerHTML=posts.slice(0,200).map(p=>`<option value="${esc(p.id)}">[${(p.status||'').toUpperCase().slice(0,4)}] ${esc(p.title.slice(0,55))}</option>`).join('');
  syncPickers();
}
function syncPickers(){
  const id=document.getElementById('main-pick')?.value;
  const p=S.posts.find(x=>x.id===id);
  const meta=document.getElementById('pick-meta');
  if(meta&&p) meta.textContent=`Status: ${p.status} · Urgency: ${p.urgency} · Pinned: ${p.pinned?'YES':'NO'} · Locked: ${p.locked?'YES':'NO'}`;
  const cp=document.getElementById('cmt-pick');
  if(cp&&p){const cmts=S.comments.filter(c=>c.postId===id);cp.innerHTML=cmts.length?cmts.map(c=>`<option value="${esc(c.id)}">${esc((c.displayName||c.author||'Anon')+': '+(c.text||'').slice(0,60))}</option>`).join(''):'<option>No comments</option>';}
  else if(cp) cp.innerHTML='<option>— Select report first —</option>';
}
async function devActMain(action){
  const id=document.getElementById('main-pick')?.value; if(!id){toast('Select a report first','err');return;}
  let data={id};
  if(action==='pin') data.pinned=true;
  if(action==='unpin') data={id,pinned:false};
  if(action==='status') data.status=document.getElementById('st-val').value;
  if(action==='urgency') data.urgency=document.getElementById('urg-val').value;
  if(action==='lock') data.locked=true;
  if(action==='delete'){if(!confirm('Delete permanently?'))return;}
  if(action==='editPost'){const gv=(a,b)=>(document.getElementById(a)||document.getElementById(b))?.value||'';data.title=gv('edit-title','edit-title');data.content=gv('edit-body','edit-content');data.officials=gv('edit-officials-hidden','edit-officials');data.location=gv('edit-location','edit-location');action='editPost';}
  if(action==='claimFull'||action==='claimCo'){const cn=document.getElementById('claim-name').value.trim();if(!cn){toast('Enter claimer name','err');return;}data={id,claimerName:cn};}
  loading(true);
  try{
    const res=await API.post('admin',{action,passkey:devPass,data});
    if(res.ok){toast('Action applied!','ok');await loadData();openDevPanel();}
    else toast(res.error||'Failed','err');
  }catch(e){toast('Error','err');}
  loading(false);
}
async function devDeleteComment(){
  const cp=document.getElementById('cmt-pick'); const commentId=cp?.value;
  if(!commentId||commentId.startsWith('—')){toast('Select a comment','err');return;}
  if(!confirm('Delete comment?'))return;
  loading(true);
  try{const res=await API.post('admin',{action:'deleteComment',passkey:devPass,data:{commentId}});if(res.ok){toast('Comment deleted','ok');await loadData();syncPickers();}else toast(res.error||'Failed','err');}
  catch(e){toast('Error','err');}
  loading(false);
}

/* ── ACCOUNTS (Dev Panel) ── */
function accSubTab(name,btn){
  document.querySelectorAll('#dp-accounts .dev-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('acc-pane-pending').style.display=name==='pending'?'block':'none';
  document.getElementById('acc-pane-users').style.display=name==='users'?'block':'none';
}
async function loadPendingCount(){
  try{
    const res=await API.post('admin',{action:'getPending',passkey:devPass,data:{}});
    if(res.ok){
      const n=res.pending.length;
      document.getElementById('pending-acc-badge').textContent=n;
      const badge=document.getElementById('pending-count-badge');
      if(badge){badge.textContent=n;badge.style.display=n>0?'flex':'none';}
      const el=document.getElementById('ds-pending-acc'); if(el)el.textContent=n;
      const rs=document.getElementById('rs-pending'); if(rs)rs.textContent=n;
    }
  }catch{}
}
async function loadPendingUsers(){
  const el=document.getElementById('pending-users-list'); el.innerHTML='<div style="font-size:12px;color:var(--text3)">Loading...</div>';
  try{
    const res=await API.post('admin',{action:'getPending',passkey:devPass,data:{}});
    if(!res.ok){el.innerHTML='<div style="color:var(--primary);font-size:12px">Error loading.</div>';return;}
    const {pending}=res;
    document.getElementById('pending-acc-badge').textContent=pending.length;
    if(!pending.length){el.innerHTML='<div style="color:var(--text3);font-size:12px">No pending registrations.</div>';return;}
    el.innerHTML=pending.map(u=>`<div class="pend-card" id="pu-${esc(u.username)}">
      <div class="pend-user">${esc(u.displayName||u.username)} <span style="font-size:18px">${esc(u.avatarEmoji||'👤')}</span></div>
      <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3);margin-bottom:6px">@${esc(u.username)}${u.realName?' · '+esc(u.realName):''}</div>
      <div class="pend-reason">"${esc(u.reason)}"</div>
      <div class="pend-meta">Registered: ${fmtTs(u.createdAt)}</div>
      <div class="pend-actions">
        <select class="role-pick" id="role-pick-${esc(u.username)}">
          <option value="citizen">CITIZEN</option>
          <option value="reporter">REPORTER</option>
          <option value="staff">STAFF</option>
          <option value="developer">DEVELOPER</option>
        </select>
        <button class="btn btn-primary btn-xs" onclick="approveUser('${esc(u.username)}')">✓ Approve</button>
        <button class="btn btn-danger btn-xs" onclick="rejectUser('${esc(u.username)}')">✕ Reject</button>
      </div>
    </div>`).join('');
  }catch(e){el.innerHTML='<div style="color:var(--primary);font-size:12px">Error loading.</div>';}
}
async function approveUser(username){
  const role=document.getElementById('role-pick-'+CSS.escape(username))?.value||'citizen';
  loading(true);
  try{const res=await API.post('admin',{action:'approveUser',passkey:devPass,data:{username,role}});if(res.ok){toast(username+' approved as '+role,'ok');loadPendingUsers();loadPendingCount();}else toast(res.error||'Failed','err');}
  catch(e){toast('Error','err');}
  loading(false);
}
async function rejectUser(username){
  if(!confirm('Reject @'+username+'?'))return;
  loading(true);
  try{const res=await API.post('admin',{action:'rejectUser',passkey:devPass,data:{username}});if(res.ok){toast(username+' rejected','ok');loadPendingUsers();loadPendingCount();}else toast(res.error||'Failed','err');}
  catch(e){toast('Error','err');}
  loading(false);
}
async function loadAllUsers(){
  const el=document.getElementById('all-users-list'); el.innerHTML='<div style="font-size:12px;color:var(--text3)">Loading...</div>';
  try{
    const res=await API.post('admin',{action:'getAllUsers',passkey:devPass,data:{}});
    if(!res.ok){el.innerHTML='<div style="color:var(--primary);font-size:12px">Error loading.</div>';return;}
    _allUsersList=res.users; renderUsersList();
  }catch(e){el.innerHTML='<div style="color:var(--primary);font-size:12px">Error loading.</div>';}
}
function filterUsersList(){renderUsersList();}
function renderUsersList(){
  const el=document.getElementById('all-users-list'); if(!el)return;
  const q=(document.getElementById('users-search')?.value||'').toLowerCase();
  const users=q?_allUsersList.filter(u=>(u.username||'').includes(q)||(u.displayName||'').toLowerCase().includes(q)):_allUsersList;
  if(!users.length){el.innerHTML='<div style="color:var(--text3);font-size:12px">No users found.</div>';return;}
  el.innerHTML=users.map(u=>`<div class="user-row">
    <div class="ur-av">${(u.avatarUrl||u.avatarImage)?`<img class="ur-av-img" src="${esc(u.avatarUrl||u.avatarImage)}" alt="">`:esc(u.avatarEmoji||'👤')}</div>
    <div class="ur-info"><div class="ur-name">${esc(u.displayName||u.username)}</div><div class="ur-uname">@${esc(u.username)}</div></div>
    ${roleBadgeHtml(u.role)}
    <select class="ur-role-sel" onchange="setUserRole('${esc(u.username)}',this.value)">
      <option value="citizen" ${u.role==='citizen'?'selected':''}>CITIZEN</option>
      <option value="reporter" ${u.role==='reporter'?'selected':''}>REPORTER</option>
      <option value="staff" ${u.role==='staff'?'selected':''}>STAFF</option>
      <option value="developer" ${u.role==='developer'?'selected':''}>DEVELOPER</option>
    </select>
  </div>`).join('');
}
async function setUserRole(username,role){
  try{const res=await API.post('admin',{action:'setRole',passkey:devPass,data:{username,role}});if(res.ok)toast(username+' → '+role,'ok');else toast(res.error||'Failed','err');}
  catch(e){toast('Error setting role','err');}
}

/* ── TIPS ── */
async function loadTips(){
  const el=document.getElementById('tips-list'); el.innerHTML='<div style="font-size:12px;color:var(--text3)">Loading...</div>';
  try{
    const res=await API.post('admin',{action:'getTips',passkey:devPass,data:{}});
    if(!res.ok){el.innerHTML='<div style="color:var(--primary);font-size:12px">Error loading.</div>';return;}
    const tips=res.tips||[];
    if(!tips.length){el.innerHTML='<div style="color:var(--text3);font-size:12px">No tips.</div>';return;}
    el.innerHTML=tips.map(t=>`<div class="pend-card">
      <div class="pend-user" style="font-weight:700">${esc(t.title)} <span class="sp ${t.urgency==='high'?'sp-u':''}" style="font-size:9px">${(t.urgency||'low').toUpperCase()}</span></div>
      <div style="font-size:12px;color:var(--text2);margin:5px 0">${esc(t.description||'')}</div>
      ${t.contact?`<div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3)">Contact: ${esc(t.contact)}</div>`:''}
      <div class="pend-meta">${fmtTs(t.timestamp)} · Status: ${t.status||'pending'}</div>
      <div class="pend-actions">
        <input type="text" class="fi" id="tip-claimer-${esc(t.id)}" value="SENTINEL STAFF" style="flex:1;font-size:12px;padding:5px 8px">
        <button class="btn btn-primary btn-xs" onclick="postTip('${esc(t.id)}')">📤 Post</button>
        <button class="btn btn-ghost btn-xs" onclick="dismissTip('${esc(t.id)}')">✕ Dismiss</button>
      </div>
    </div>`).join('');
  }catch(e){el.innerHTML='<div style="color:var(--primary);font-size:12px">Error loading.</div>';}
}
async function postTip(tipId){
  const claimer=(document.getElementById('tip-claimer-'+CSS.escape(tipId))?.value||'SENTINEL STAFF').trim();
  loading(true);
  try{const res=await API.post('admin',{action:'postTip',passkey:devPass,data:{tipId,claimerName:claimer}});if(res.ok){toast('Tip posted as report!','ok');await loadData();loadTips();}else toast(res.error||'Failed','err');}
  catch(e){toast('Error','err');}
  loading(false);
}
async function dismissTip(tipId){
  loading(true);
  try{const res=await API.post('admin',{action:'dismissTip',passkey:devPass,data:{tipId}});if(res.ok){toast('Tip dismissed','ok');loadTips();}else toast(res.error||'Failed','err');}
  catch(e){toast('Error','err');}
  loading(false);
}

/* ── BROADCAST ── */
async function devAct(action){
  if(action==='announce'){
    const gv=(a,b)=>(document.getElementById(a)||document.getElementById(b))?.value?.trim()||''; const t=gv('ann-t','ann-title'); const c=gv('ann-c','ann-body');
    if(!t||!c){toast('Title and message required','err');return;}
    loading(true);
    try{const res=await API.post('admin',{action:'announce',passkey:devPass,data:{title:t,content:c}});if(res.ok){toast('Broadcast sent!','ok');['ann-t','ann-c','ann-title','ann-body'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});await loadData();renderAnnPreview();}else toast(res.error||'Failed','err');}
    catch(e){toast('Error','err');} loading(false);
  } else if(action==='clearAnn'){
    if(!confirm('Clear all announcements?'))return;
    loading(true);
    try{const res=await API.post('admin',{action:'clearAnn',passkey:devPass,data:{}});if(res.ok){toast('Cleared','ok');await loadData();renderAnnPreview();}else toast(res.error||'Failed','err');}
    catch(e){toast('Error','err');} loading(false);
  } else if(action==='unpinAll'){
    if(!confirm('Unpin all?'))return;
    loading(true);
    try{const res=await API.post('admin',{action:'unpinAll',passkey:devPass,data:{}});if(res.ok){toast('All unpinned','ok');await loadData();}else toast(res.error||'Failed','err');}
    catch(e){toast('Error','err');} loading(false);
  } else if(action==='passkey'){
    const oldPk=document.getElementById('pk-old').value; const newPk=document.getElementById('pk-new').value;
    if(oldPk!==devPass){toast('Current passkey is wrong','err');return;}
    if(!newPk||newPk.length<6){toast('New passkey must be 6+ chars','err');return;}
    loading(true);
    try{const res=await API.post('admin',{action:'passkey',passkey:devPass,data:{newPasskey:newPk}});if(res.ok){devPass=newPk;document.getElementById('pk-old').value='';document.getElementById('pk-new').value='';toast('Passkey updated!','ok');}else toast(res.error||'Failed','err');}
    catch(e){toast('Error','err');} loading(false);
  }
}
function renderAnnPreview(){
  const el=document.getElementById('ann-preview'); if(!el)return;
  el.innerHTML=S.announcements.length?S.announcements.map(a=>`<div style="padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px;font-size:13px"><b>${esc(a.title)}</b><br><span style="color:var(--text2)">${esc(a.content||'')}</span><br><span style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text3)">${ago(a.timestamp)}</span></div>`).join(''):'<div style="color:var(--text3);font-size:12px">No active announcements.</div>';
}

/* ── MAINTENANCE ── */
async function setMaintenance(enabled){
  if(enabled&&!confirm('Enable maintenance mode? Users will see a maintenance page.'))return;
  const msg=document.getElementById('maint-msg-input')?.value.trim()||'';
  loading(true);
  try{
    const res=await API.post('admin',{action:'maintenance',passkey:devPass,data:{enabled,message:msg}});
    if(res.ok){toast(enabled?'Maintenance ON':'Maintenance OFF','ok');const el=document.getElementById('maint-status');if(el)el.textContent='Status: '+(enabled?'MAINTENANCE ON':'ONLINE');}
    else toast(res.error||'Failed','err');
  }catch(e){toast('Error','err');}
  loading(false);
}

/* ── CATEGORIES ── */
function renderCatList(){
  const el=document.getElementById('cat-list'); if(!el)return;
  el.innerHTML=S.categories.map((c,i)=>`<div class="cat-list-item"><span class="cli-ico">${esc(c.icon||'📌')}</span><span class="cli-lbl">${esc(c.label)}</span><button class="cli-rm" onclick="removeCat(${i})">✕</button></div>`).join('');
}
async function addCat(){
  const ico=document.getElementById('nc-ico').value.trim()||'📌';
  const lbl=document.getElementById('nc-lbl').value.trim();
  if(!lbl){toast('Enter a label','err');return;}
  const id=lbl.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  if(S.categories.find(c=>c.id===id)){toast('Category exists','err');return;}
  S.categories.push({id,label:lbl.toUpperCase(),icon:ico});
  await saveCats(); renderCatList(); renderTabs(); renderSidebarCategories(); document.getElementById('nc-lbl').value='';
}
async function removeCat(i){S.categories.splice(i,1);await saveCats();renderCatList();renderTabs();renderSidebarCategories();}
async function saveCats(){
  try{
    const res=await API.post('admin',{action:'categories',passkey:devPass,data:{categories:S.categories}});
    if(res.ok) toast('Categories saved!','ok');
    else toast(res.error||'Failed to save','err');
  }catch(e){toast('Error saving categories','err');}
}
async function resetCats(){
  if(!confirm('Reset categories to defaults?'))return;
  loading(true);
  try{
    const DEFAULT_CATS=[{id:'government',label:'GOVERNMENT',icon:'🏛'},{id:'police',label:'LAW ENFORCEMENT',icon:'🚔'},{id:'barangay',label:'BARANGAY / LOCAL',icon:'🏘'},{id:'election',label:'ELECTION / VOTING',icon:'🗳'},{id:'budget',label:'BUDGET / FUNDS',icon:'💰'},{id:'other',label:'OTHER',icon:'📋'}];
    const res=await API.post('admin',{action:'categories',passkey:devPass,data:{categories:DEFAULT_CATS}});
    if(res.ok){toast('Categories reset','ok');await loadData();renderCatList();}else toast(res.error||'Failed','err');
  }catch(e){toast('Error','err');}
  loading(false);
}

/* ── EXPORT ── */
async function exportData(fmt){
  loading(true);
  try{
    const res=await API.post('admin',{action:'exportData',passkey:devPass,data:{}});
    if(!res.ok){toast('Export failed','err');loading(false);return;}
    let content, filename, type;
    if(fmt==='json'){content=JSON.stringify({posts:res.posts,comments:res.comments,users:res.users,exportedAt:res.exportedAt},null,2);filename='sentinel-export.json';type='application/json';}
    else{
      const rows=[['id','title','author','status','urgency','category','timestamp'],...res.posts.map(p=>[p.id,p.title,p.displayName||p.author,p.status,p.urgency,p.category,p.timestamp])];
      content=rows.map(r=>r.map(v=>'"'+String(v||'').replace(/"/g,'""')+'"').join(',')).join('\n');
      filename='sentinel-export.csv'; type='text/csv';
    }
    const blob=new Blob([content],{type}); const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
    toast('Export downloaded!','ok');
  }catch(e){toast('Error exporting','err');}
  loading(false);
}

/* ── REACTIONS SETTINGS ── */
function openDevPanel_withReactions(){
  const inp=document.getElementById('react-input'); if(inp)inp.value=REACTIONS.join(' ');
  updateReactPreview();
}
function updateReactPreview(){
  const inp=document.getElementById('react-input'); const prev=document.getElementById('react-preview'); if(!inp||!prev)return;
  const emojis=inp.value.trim().split(/\s+/).filter(Boolean).slice(0,8);
  prev.innerHTML='<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">'+emojis.map(e=>`<span style="font-size:22px;background:var(--bg);border:1px solid var(--border);padding:6px 10px;border-radius:10px">${esc(e)}</span>`).join('')+'</div>';
}
async function saveCustomReactions(){
  const inp=document.getElementById('react-input'); if(!inp){toast('Input not found','err');return;}
  const emojis=inp.value.trim().split(/\s+/).filter(Boolean).slice(0,8);
  if(!emojis.length){toast('Enter at least one emoji','err');return;}
  loading(true);
  try{
    const res=await API.post('admin',{action:'setReactions',passkey:devPass,data:{reactions:emojis}});
    if(res.ok){REACTIONS=emojis;toast('Reactions updated!','ok');await loadData();}
    else toast(res.error||'Failed','err');
  }catch(e){toast('Error','err');}
  loading(false);
}
function resetReactions(){
  REACTIONS=[...DEFAULT_REACTIONS];
  const inp=document.getElementById('react-input');
  if(inp){inp.value=REACTIONS.join(' ');updateReactPreview();}
  saveCustomReactions();
}

/* ── KEYBOARD SHORTCUTS ── */
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT') return;
  if((e.key==='/'||e.key==='f')&&!e.metaKey&&!e.ctrlKey){e.preventDefault();const inp=document.getElementById('search-input');if(inp){inp.focus();inp.select();}}
  if(e.key==='Escape'){const open=document.querySelector('.overlay.open');if(open){close_(open.id);return;}closeUserDropdown();closeNotifPanel();const inp=document.getElementById('search-input');if(inp&&inp.value){inp.value='';onSearch();updateSearchClear();}}
  if(e.key==='n'&&!e.metaKey&&!e.ctrlKey&&currentUser&&currentUser.role!=='guest'){openNew();}
});

/* ── DEEP LINK ── */
function checkDeepLink(){
  const params=new URLSearchParams(location.search);
  const postId=params.get('post');
  if(postId){const p=S.posts.find(x=>x.id===postId);if(p) setTimeout(()=>openDetail(postId),300);}
}

/* ── SCROLL ── */
window.addEventListener('scroll',()=>{
  const topbar=document.querySelector('.topnav'); if(topbar)topbar.classList.toggle('scrolled',window.scrollY>4);
  const btt=document.getElementById('back-to-top'); if(btt)btt.classList.toggle('visible',window.scrollY>340);
});

/* ── CLOSE MENUS ON OUTSIDE CLICK ── */
document.addEventListener('click',e=>{
  if(!e.target.closest('.dev-quick-menu')&&!e.target.closest('.card-more-btn')){
    document.querySelectorAll('.dev-quick-menu.open').forEach(m=>m.classList.remove('open'));
  }
});
document.addEventListener('click',e=>{
  if(!e.target.closest('#notif-panel')&&!e.target.closest('#ntab-notif')) closeNotifPanel();
});

/* ── MOBILE BOTTOM NAV ── */
function mbnSwitch(name,btn){
  document.querySelectorAll('.mbn-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(name==='home'){curTab='all';curStatus='all';render();window.scrollTo({top:0,behavior:'smooth'});}
  else if(name==='trending'){
    curTab='all';curStatus='all';
    document.getElementById('sort-sel').value='votes';
    render();window.scrollTo({top:0,behavior:'smooth'});
    toast('Showing most voted reports','','🔥');
  }
}
function toggleMobileMenu(){
  const ua=document.getElementById('mobile-menu-user-area');
  if(ua){
    if(currentUser&&currentUser.role!=='guest'){
      const avatarSrc=currentUser.avatarUrl||currentUser.avatarImage||'';
      ua.innerHTML=`<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg);border-radius:var(--radius-sm)">
        <div style="width:38px;height:38px;border-radius:50%;background:var(--primary-lt);display:flex;align-items:center;justify-content:center;font-size:20px;overflow:hidden;flex-shrink:0">
          ${avatarSrc?`<img src="${esc(avatarSrc)}" style="width:100%;height:100%;object-fit:cover" alt="">`:esc(currentUser.avatarEmoji||'👤')}
        </div>
        <div><div style="font-weight:700;font-size:14px">${esc(currentUser.displayName||currentUser.username)}</div>
        <div style="font-size:11px;color:var(--text3)">@${esc(currentUser.username)} · ${(currentUser.role||'citizen').toUpperCase()}</div></div>
      </div>`;
    } else {
      ua.innerHTML=`<button class="btn btn-primary" style="width:100%" onclick="close_('m-mobile-menu');openAuth()">👁 Sign In</button>`;
    }
  }
  const staffBtn=document.getElementById('mobile-menu-staff-btn');
  const devBtn=document.getElementById('mobile-menu-dev-btn');
  if(staffBtn) staffBtn.style.display=canModerate(currentUser?.role)?'block':'none';
  if(devBtn) devBtn.style.display=isDevRole(currentUser?.role)?'block':'none';
  open_('m-mobile-menu');
}
function syncMobileNotifBadge(){
  const unread=_notifs.filter(n=>!n.read).length;
  const badge=document.getElementById('mbn-notif-badge');
  if(badge){badge.textContent=unread;badge.classList.toggle('show',unread>0);}
}

/* ── STAFF PANEL: REPORTS & COMMENTS ── */
function staffRenderReports(){
  const el=document.getElementById('staff-reports-list'); if(!el)return;
  const q=(document.getElementById('staff-report-search')?.value||'').toLowerCase();
  const filter=document.getElementById('staff-report-filter')?.value||'all';
  let posts=[...S.posts];
  if(filter!=='all') posts=posts.filter(p=>p.status===filter);
  if(q) posts=posts.filter(p=>(p.title+' '+(p.content||'')).toLowerCase().includes(q));
  posts.sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
  if(!posts.length){el.innerHTML='<div style="color:var(--text3);font-size:13px;text-align:center;padding:20px">No reports found.</div>';return;}
  el.innerHTML=posts.map(p=>`<div class="bulk-item" style="padding:8px 10px">
    <div style="flex:1;min-width:0">
      <div style="font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.title)}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px">${esc(p.displayName||p.author||'Anonymous')} · ${ago(p.timestamp)}</div>
    </div>
    <span class="sp ${p.status==='verified'?'sp-v':p.status==='reviewing'?'sp-r':'sp-u'}" style="font-size:9px;flex-shrink:0">${(p.status||'unverified').toUpperCase()}</span>
    <button class="staff-qbtn sqb-verify" onclick="staffQuick('${esc(p.id)}','verify')">✅</button>
    <button class="staff-qbtn sqb-review" onclick="staffQuick('${esc(p.id)}','review')">🔍</button>
    <button class="staff-qbtn sqb-unverify" onclick="staffQuick('${esc(p.id)}','unverify')">◈</button>
    ${isDevRole(currentUser?.role)?`<button class="staff-qbtn sqb-delete" onclick="if(confirm('Delete?'))staffQuick('${esc(p.id)}','delete')">🗑</button>`:''}
  </div>`).join('');
}
let _staffComments=[];
function staffLoadComments(){
  _staffComments=[...S.comments].sort((a,b)=>new Date(b.timestamp)-new Date(a.timestamp));
  staffRenderComments();
}
function staffRenderComments(){
  const el=document.getElementById('staff-comments-list'); if(!el)return;
  const q=(document.getElementById('staff-comment-search')?.value||'').toLowerCase();
  let cmts=_staffComments;
  if(q) cmts=cmts.filter(c=>(c.text+' '+(c.displayName||'')).toLowerCase().includes(q));
  if(!cmts.length){el.innerHTML='<div style="color:var(--text3);font-size:13px;text-align:center;padding:20px">'+(q?'No matching comments.':'Click Refresh to load comments.')+'</div>';return;}
  el.innerHTML=cmts.slice(0,50).map(c=>{
    const post=S.posts.find(p=>p.id===c.postId);
    return `<div class="bulk-item" style="padding:8px 10px;align-items:flex-start">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:12px">${esc(c.displayName||c.author||'Anonymous')}</div>
        <div style="font-size:12px;color:var(--text2);margin:2px 0">${esc((c.text||'').slice(0,120))}</div>
        <div style="font-size:10px;color:var(--text3)">On: "${esc((post?.title||'Unknown post').slice(0,40))}" · ${ago(c.timestamp)}</div>
      </div>
      <button class="staff-qbtn sqb-delete" onclick="staffDeleteComment('${esc(c.id)}','${esc(c.postId)}');staffLoadComments()" style="margin-top:0">🗑 Del</button>
    </div>`;
  }).join('');
}

/* ── INIT ── */
initTheme();
renderNotifBadge();
loadUserFromStorage();
loadBranches();
updateSidebarTheme();
setInterval(()=>{if(currentUser&&currentUser.role!=='guest')loadData();},60000);

/* ═══════════════════════════════════════
   MOBILE IMPROVEMENTS
═══════════════════════════════════════ */

/* ── PERSISTENT SKELETON ── */
function showSkeletons(){
  const feed=document.getElementById('feed'); if(!feed)return;
  if(!_dataLoaded){
    feed.innerHTML=[...Array(4)].map(()=>`<div class="skeleton-card mobile-skeleton">
    <div style="display:flex;gap:10px;margin-bottom:12px">
      <div class="skel" style="width:44px;height:44px;border-radius:50%;flex-shrink:0"></div>
      <div style="flex:1"><div class="skel" style="height:14px;width:60%;margin-bottom:7px"></div><div class="skel" style="height:11px;width:40%"></div></div>
    </div>
    <div class="skel" style="height:16px;width:85%;margin-bottom:8px"></div>
    <div class="skel" style="height:13px;width:100%;margin-bottom:5px"></div>
    <div class="skel" style="height:13px;width:75%"></div>
  </div>`).join('');
  }
}
function clearSkeletons(){ _dataLoaded = true; }

/* ── LOAD MORE / PAGINATION ── */

function render(){
  _currentPage = 0;
  const query=(document.getElementById('search-input')?.value||'').trim().toLowerCase();
  const sort=document.getElementById('sort-sel')?.value||'newest';
  let posts=[...S.posts];
  if(curTab!=='all') posts=posts.filter(p=>p.category===curTab);
  if(curStatus!=='all') posts=posts.filter(p=>p.status===curStatus);
  if(query&&!query.startsWith('@')) posts=posts.filter(p=>(p.title+' '+(p.content||'')+' '+(p.author||'')+' '+(p.officials||'')+' '+((p.tags||[]).join(' '))).toLowerCase().includes(query));
  posts.sort((a,b)=>{
    if(sort==='votes') return (b.votes||0)-(a.votes||0);
    if(sort==='comments') return (S.comments.filter(c=>c.postId===b.id).length)-(S.comments.filter(c=>c.postId===a.id).length);
    if(sort==='urgent'){const uo={high:3,med:2,low:1};return (uo[b.urgency]||0)-(uo[a.urgency]||0);}
    return new Date(b.timestamp)-new Date(a.timestamp);
  });
  const pinned=posts.filter(p=>p.pinned);
  const unpinned=posts.filter(p=>!p.pinned);
  _allPosts = [...pinned,...unpinned];
  _renderPage();
  updateBreakingBanner();
}

function _renderPage(){
  const feed=document.getElementById('feed'); if(!feed)return;
  const end = (_currentPage + 1) * PAGE_SIZE;
  const pagePosts = _allPosts.slice(0, end);
  const q=(document.getElementById('search-input')?.value||'').trim().toLowerCase();
  let labelHtml='';
  if(q&&!q.startsWith('@')) labelHtml=`<div class="search-results-label">Showing <span>${pagePosts.length}</span> result${pagePosts.length!==1?'s':''} for "<span>${esc(q)}</span>"</div>`;
  if(!_allPosts.length){
    feed.innerHTML=labelHtml+`<div class="empty"><div class="eico">🔍</div><h3>No reports found</h3><p>${q?`No results for "${esc(q)}" — try different keywords`:'No reports match your filters.'}</p>${q?`<button class="btn btn-ghost btn-sm" onclick="clearSearch()">✕ Clear Search</button>`:''}</div>`;
  } else {
    feed.innerHTML=labelHtml+pagePosts.map((p,i)=>postCardHtml(p,i)).join('');
  }
  const loadMoreBtn=document.getElementById('load-more-btn');
  if(loadMoreBtn) loadMoreBtn.classList.toggle('show', end < _allPosts.length);
  const pinNotice=document.getElementById('pin-notice');
  if(pinNotice) pinNotice.style.display=_allPosts.filter(p=>p.pinned).length?'flex':'none';
  const statEl=document.getElementById('stat-txt');
  if(statEl) statEl.innerHTML=`— ${_allPosts.length} reports`;
}

function loadMore(){
  _currentPage++;
  _renderPage();
  window.scrollBy({top:200,behavior:'smooth'});
}

/* ── MOBILE SORT ── */
function mbnOpenSort(){
  open_('m-mob-sort');
  const sortVal=document.getElementById('sort-sel')?.value||'newest';
  document.querySelectorAll('.mob-sort-btn').forEach(b=>b.classList.remove('active'));
  document.querySelectorAll('.mob-sort-btn').forEach(b=>{
    if(b.dataset.sort===sortVal) b.classList.add('active');
  });
}
function mbnSetSort(val){
  document.getElementById('sort-sel').value=val;
  close_('m-mob-sort');
  render();
  const btn=document.getElementById('mbn-sort');
  if(btn) btn.classList.add('active');
}

/* ── DARK MODE IN SIDEBAR ── */
function updateSidebarTheme(){
  const isDark=document.body.classList.contains('dark');
  const ico=document.getElementById('snav-theme-ico');
  const lbl=document.getElementById('snav-theme-lbl');
  if(ico) ico.textContent=isDark?'☀️':'🌙';
  if(lbl) lbl.textContent=isDark?'Light Mode':'Dark Mode';
}
function toggleTheme(){
  const d=!document.body.classList.contains('dark');
  document.body.classList.toggle('dark',d);
  localStorage.setItem('theme',d?'dark':'light');
  updateThemeBtn();
  updateSidebarTheme();
}
function updateThemeBtn(){
  const d=document.body.classList.contains('dark');
  const btn=document.getElementById('theme-settings-btn');
  if(btn) btn.textContent=d?'☀️ Light Mode':'🌙 Dark Mode';
  const navBtn=document.getElementById('theme-btn');
  if(navBtn) navBtn.textContent=d?'☀️':'🌙';
}

/* ── SEARCH AUTOCOMPLETE ── */
let _searchHoverIdx = -1;
function onSearchInput(){
  const inp=document.getElementById('search-input');
  const ac=document.getElementById('search-autocomplete');
  if(!inp||!ac)return;
  const val=inp.value.trim();
  if(!val.startsWith('@')||val.length<2){ac.classList.remove('show');_searchHoverIdx=-1;return;}
  const q=val.slice(1).toLowerCase();
  const matches=S.posts
    .filter(p=>p.authorUsername&&!p.anonymous&&p.authorUsername.toLowerCase().includes(q))
    .map(p=>({username:p.authorUsername,displayName:p.displayName}))
    .filter((m,i,arr)=>arr.findIndex(x=>x.username===m.username)===i)
    .slice(0,6);
  if(!matches.length){ac.classList.remove('show');_searchHoverIdx=-1;return;}
  ac.innerHTML=matches.map((m)=>{
    const initial=(m.displayName||m.username||'?')[0].toUpperCase();
    return `<div class="sac-item" onclick="selectSearchUser('${esc(m.username)}')">
      <div class="sac-avatar">${initial}</div>
      <div><div class="sac-name">${esc(m.displayName||m.username)}</div><div class="sac-uname">@${esc(m.username)}</div></div>
    </div>`;
  }).join('');
  ac.classList.add('show');
  _searchHoverIdx=-1;
}
function onSearchKey(e){
  const ac=document.getElementById('search-autocomplete');
  if(!ac||!ac.classList.contains('show')) return;
  const items=[...ac.querySelectorAll('.sac-item')];
  if(e.key==='ArrowDown'){e.preventDefault();_searchHoverIdx=Math.min(_searchHoverIdx+1,items.length-1);_highlightSearchItem(items);return;}
  if(e.key==='ArrowUp'){e.preventDefault();_searchHoverIdx=Math.max(_searchHoverIdx-1,0);_highlightSearchItem(items);return;}
  if(e.key==='Enter'&&_searchHoverIdx>=0){e.preventDefault();items[_searchHoverIdx]?.click();return;}
  if(e.key==='Escape'){ac.classList.remove('show');return;}
}
function _highlightSearchItem(items){items.forEach((it,i)=>it.classList.toggle('active',i===_searchHoverIdx));}
function selectSearchUser(username){
  const inp=document.getElementById('search-input');
  const ac=document.getElementById('search-autocomplete');
  if(inp) inp.value='@'+username;
  if(ac) ac.classList.remove('show');
  _searchHoverIdx=-1;
  render();
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.nav-search')){
    const ac=document.getElementById('search-autocomplete');
    if(ac) ac.classList.remove('show');
    _searchHoverIdx=-1;
  }
});

/* ── BREAKING NEWS BANNER ── */
let _breakingPostId = null;
function updateBreakingBanner(){
  const banner=document.getElementById('breaking-banner');
  const title=document.getElementById('breaking-title');
  if(!banner)return;
  const dismissed=sessionStorage.getItem('breaking_dismissed');
  const urgent=S.posts.find(p=>p.urgency==='high'&&p.status==='verified'&&!p.locked);
  if(urgent&&(!dismissed||dismissed!==urgent.id)){
    _breakingPostId=urgent.id;
    if(title){
      // Decode any HTML entities in the title (e.g. &amp; → &)
      const tmp=document.createElement('textarea');
      tmp.innerHTML=urgent.title.slice(0,60);
      title.textContent='🚨 '+tmp.value+(urgent.title.length>60?'…':'');
    }
    banner.classList.add('show');
  } else {
    banner.classList.remove('show');
    _breakingPostId=null;
  }
}
function dismissBreakingBanner(){
  const banner=document.getElementById('breaking-banner');
  if(banner) banner.classList.remove('show');
  if(_breakingPostId) sessionStorage.setItem('breaking_dismissed',_breakingPostId);
}
function breakingBannerClick(){
  if(_breakingPostId) openDetail(_breakingPostId);
}

/* ── REPORT / FLAG ── */
async function flagPost(postId){
  if(!currentUser||currentUser.role==='guest'){toast('Login to report','err');openAuth();return;}
  const reason=window.prompt('Why are you reporting this? (optional — press OK to submit)');
  loading(true);
  try{
    await API.post('flag',{id:postId,reason:reason||''});
    toast('Report submitted. Staff will review.','ok');
  }catch(e){toast('Error reporting post','err');}
  loading(false);
}

/* ── MEDIA UPLOAD LIMITS (5 per post) ── */
async function handleMedia(input){
  const files=Array.from(input.files||[]);
  const remaining = MAX_MEDIA - mediaFiles.length;
  if(remaining<=0){toast(`Max ${MAX_MEDIA} files per post`,'err');input.value='';return;}
  const toUpload = files.slice(0, remaining);
  if(files.length>remaining) toast(`${files.length-remaining} file(s) skipped — max ${MAX_MEDIA}`,'err');
  for(const file of toUpload){
    if(file.size>10*1024*1024){toast('Max 10MB per file','err');continue;}
    if(file.type.startsWith('image/')){
      toast('Uploading…','');
      try{
        const fd=new FormData(); fd.append('file',file); fd.append('upload_preset',CLOUDINARY_MEDIA_PRESET);
        const res=await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,{method:'POST',body:fd});
        const data=await res.json();
        if(!data.secure_url) throw new Error('Upload failed');
        mediaFiles.push({type:'image',url:data.secure_url});
        toast(`Uploaded (${mediaFiles.length}/${MAX_MEDIA})`,'ok');
      }catch(e){toast('Upload failed','err');}
    } else if(file.type.startsWith('audio/')){
      const b64=await toBase64(file);
      mediaFiles.push({type:'audio',data:b64});
      toast(`Audio (${mediaFiles.length}/${MAX_MEDIA})`,'ok');
    }
  }
  renderPreviews(); input.value='';
}

/* ── LIGHTBOX: gallery is already wired via openLB/lbNav ── */

/* ── CARD ACTIONS HTML HELPERS ── */
function _getCardActionsHtml(p){
  const isStaff=canModerate(currentUser?.role);
  const isDev=isDevRole(currentUser?.role);
  return `<div class="card-staff-actions">
    ${isStaff||isDev?`<button class="staff-qbtn sqb-verify" onclick="staffQuick('${esc(p.id)}','verify')">✅</button>
    <button class="staff-qbtn sqb-review" onclick="staffQuick('${esc(p.id)}','review')">🔍</button>
    <button class="staff-qbtn sqb-unverify" onclick="staffQuick('${esc(p.id)}','unverify')">◈</button>`:''}
    ${isDev?`<button class="staff-qbtn sqb-pin" onclick="staffQuick('${esc(p.id)}','${p.pinned?'unpin':'pin'}')">${p.pinned?'✕':'📌'}</button>`:''}
    ${isDev?`<button class="staff-qbtn sqb-delete" onclick="if(confirm('Delete?'))staffQuick('${esc(p.id)}','delete')">🗑</button>`:''}
  </div>`;
}
function _getDqmHtml(p){
  const isStaff=canModerate(currentUser?.role);
  const isDev=isDevRole(currentUser?.role);
  const isOwn=currentUser&&p.authorUsername&&p.authorUsername===currentUser.username;
  return `
    ${isStaff||isDev?`<div class="dqm-item" onclick="event.stopPropagation();staffQuick('${esc(p.id)}','verify')">✅ Verify</div>
    <div class="dqm-item" onclick="event.stopPropagation();staffQuick('${esc(p.id)}','review')">🔍 Under Review</div>
    <div class="dqm-item" onclick="event.stopPropagation();staffQuick('${esc(p.id)}','unverify')">◈ Unverify</div>`:''}
    ${currentUser&&currentUser.role!=='guest'&&!isOwn?`<div class="dqm-item dqm-flag" onclick="event.stopPropagation();flagPost('${esc(p.id)}')">🚨 Report</div>`:''}
    ${isDev?`<div class="dqm-sep"></div>
    <div class="dqm-item" onclick="event.stopPropagation();devQuick('${esc(p.id)}','${p.pinned?'unpin':'pin'}')">${p.pinned?'✕ Unpin':'📌 Pin'}</div>
    <div class="dqm-item" onclick="event.stopPropagation();devQuick('${esc(p.id)}','${p.locked?'unlock':'lock'}')">${p.locked?'🔓 Unlock':'🔒 Lock'}</div>
    <div class="dqm-sep"></div>
    <div class="dqm-item" style="color:var(--primary)" onclick="event.stopPropagation();if(confirm('Delete?'))devQuick('${esc(p.id)}','delete')">🗑 Delete</div>`:''}
    ${isOwn?`${isStaff||isDev?'<div class="dqm-sep"></div>':''}
    <div class="dqm-item" onclick="event.stopPropagation();openDetail('${esc(p.id)}')">✏️ Edit</div>`:''}
  `;
}

/* ── POST CARD HTML (UPDATED with report button + lightbox) ── */
function postCardHtml(p,idx){
  const cmtCount=S.comments.filter(c=>c.postId===p.id).length;
  const authorDisplay=p.anonymous?'Anonymous':(p.displayName||p.author||'Anonymous');
  const hasUsername=!p.anonymous&&p.authorUsername;
  const isOwn=currentUser&&hasUsername&&p.authorUsername===currentUser.username;
  const avClass=AV_CLASSES[Math.abs((p.authorUsername||'').charCodeAt(0)||0)%AV_CLASSES.length];
  const mediaItems=(p.media||[]).slice(0,4);
  const mediaHtml=mediaItems.length?`<div class="media-strip">${mediaItems.map((m,i)=>{
    const extra=(p.media.length>4&&i===3)?`<div class="mmore">+${p.media.length-4}</div>`:'';
    const allImgs=(p.media||[]).filter(mm=>mm.type==='image').map(mm=>mm.data||mm.url||'');
    if(m.type==='image'){const src=m.data||m.url||'';return`<div class="mthumb" onclick="openLB('${src}',${JSON.stringify(allImgs)})"><img src="${src}" alt=""></div>${extra}`;}
    if(m.type==='audio')return`<div class="mthumb"><div class="mico"><span>🎵</span><span>AUDIO</span></div>${extra}</div>`;
    return'';
  }).join('')}</div>`:'';
  const tagsHtml=(p.tags&&p.tags.length)?`<div class="card-tags">${p.tags.map(t=>`<span class="tag" onclick="event.stopPropagation();document.getElementById('search-input').value='${esc(t)}';updateSearchClear();render()">#${esc(t)}</span>`).join('')}</div>`:'';
  const staffBadge=p.fromTip?'<span class="staff-post-badge">STAFF</span>':'';
  const coClaimBadge=p.coClaimed?`<span class="coclaim-badge">via ${esc(p.coClaimedBy)}</span>`:'';
  const editedBadge=p.editedByAdmin?'<span class="edited-badge">[EDITED]</span>':'';
  const classes=['post-card',p.pinned?'is-pinned':'',p.urgency==='high'?'is-urgent':'',p.status==='verified'?'is-verified':'',p.locked?'is-locked':''].filter(Boolean).join(' ');
  const totalReactions=REACTIONS.reduce((sum,e)=>sum+getReactionCount(p.id,e),0);
  const reactionSummaryHtml=totalReactions>0?`<div class="reaction-summary"><div class="reaction-icons">${REACTIONS.filter(e=>getReactionCount(p.id,e)>0).slice(0,3).map(e=>`<div class="reaction-ico">${esc(e)}</div>`).join('')}</div><span>${totalReactions}</span></div>`:'<div></div>';
  const commentCountHtml=cmtCount>0?`<div class="comment-count-link" onclick="openDetail('${esc(p.id)}')">${cmtCount} 💬</div>`:'<div></div>';
  const isStaff=canModerate(currentUser?.role);
  const isDev=isDevRole(currentUser?.role);
  const userReact=getUserReaction(p.id);
  const initial=authorDisplay[0]||'?';

  const topComment=S.comments.find(c=>c.postId===p.id);
  const topCommentHtml=topComment?`<div class="card-top-comment">
    <div class="comment-item-inline">
      <div class="ci-av-sm">${esc(topComment.avatarEmoji||'👤')}</div>
      <div class="ci-bubble">
        <div class="ci-author">${esc(topComment.displayName||topComment.author||'Anonymous')}</div>
        <div class="ci-text">${esc((topComment.text||'').slice(0,100))}${topComment.text&&topComment.text.length>100?'…':''}</div>
      </div>
    </div>
    ${canPost(currentUser?.role)?`<div class="comment-input-wrap">
      <div class="composer-av" style="width:32px;height:32px;font-size:14px">${esc(currentUser?.avatarEmoji||'👤')}</div>
      <div class="comment-input-inline" onclick="openDetail('${esc(p.id)}')" style="cursor:pointer">Write a comment…</div>
    </div>`:''}
  </div>`:'';

  return `<div class="${classes}" onclick="onCardTap('${esc(p.id)}',event)">
    <div class="card-header">
      <div class="card-author-av ${esc(avClass)}" onclick="event.stopPropagation();${hasUsername?`openProfile('${esc(p.authorUsername)}')`:''}">
        ${p.status==='verified'?'<div class="card-verified-ring">✓</div>':''}
        ${esc(initial)}
      </div>
      <div class="card-author-info">
        <div class="card-author-row">
          <span class="card-author-name" onclick="event.stopPropagation();${hasUsername?`openProfile('${esc(p.authorUsername)}')`:''}">${esc(authorDisplay)}</span>
          ${p.status==='verified'?'<span class="card-role-badge rb-verified">✅</span>':''}
          ${p.urgency==='high'?'<span class="card-role-badge rb-urgent">🚨</span>':''}
          ${p.pinned?'<span class="card-role-badge rb-pinned">📌</span>':''}
          ${staffBadge}${coClaimBadge}
        </div>
        <div class="card-post-meta">
          <span>${catLabel(p.category)}</span><span class="card-meta-dot"></span><span>${ago(p.timestamp)}</span>
          ${p.location?`<span class="card-meta-dot"></span><span class="card-meta-loc" onclick="event.stopPropagation();document.getElementById('search-input').value='${esc(p.location)}';updateSearchClear();render()">${esc(p.location)}</span>`:''}
          ${p.locked?'<span class="lock-badge">🔒</span>':''}${editedBadge}
        </div>
      </div>
  ${isOwn||isStaff||isDev||(currentUser&&currentUser.role!=='guest')?`<div style="position:relative;flex-shrink:0">
        <button class="card-more-btn" onclick="event.stopPropagation();toggleDevMenu('${esc(p.id)}',this)">•••</button>
        <div class="dev-quick-menu" id="dqm-${CSS.escape(p.id)}">${_getDqmHtml(p)}</div>
      </div>`:''}
    </div>
    <div class="card-body">
      <div class="card-category-label">${catLabel(p.category)} ${urgencyHtml(p.urgency)} ${statusHtml(p.status)}</div>
      <div class="card-title" onclick="event.stopPropagation();openDetail('${esc(p.id)}')">${esc(p.title)}</div>
      ${p.officials?`<div class="off-line">👤 ${esc(p.officials)}</div>`:''}
      <div class="card-excerpt">${esc(p.content)}</div>
      ${tagsHtml}${mediaHtml}
    </div>
    ${_getCardActionsHtml(p)}
    <div class="card-engagement">
      ${reactionSummaryHtml}
      ${commentCountHtml}
    </div>
    <div class="card-actions">
      <button class="card-action-btn${userReact?' btn-reacted':''}" onclick="event.stopPropagation();toggleReactPanel('${esc(p.id)}')">
        <span class="btn-ico">${userReact?esc(userReact):'👍'}</span> ${userReact?'Reacted':'React'}
      </button>
      <button class="card-action-btn" onclick="event.stopPropagation();openDetail('${esc(p.id)}')">
        <span class="btn-ico">💬</span> Comment
      </button>
      <button class="card-action-btn" onclick="event.stopPropagation();sharePost('${esc(p.id)}')">
        <span class="btn-ico">↗</span> Share
      </button>
    </div>
    <div class="reaction-btns" id="react-panel-${CSS.escape(p.id)}" style="display:none" data-reaction-bar="${CSS.escape(p.id)}">
      ${reactionBarHtml(p.id)}
    </div>
    ${topCommentHtml}
  </div>`;
}

/* ── LOAD DATA: with clear skeletons ── */
async function loadData(){
  _dataLoaded = false;
  showSkeletons(); loading(true);
  try{
    const d=await API.get('data');
    apiErr(false);
    if(d.maintenance){
      document.getElementById('maint-screen').classList.add('show');
      document.getElementById('maint-msg').textContent=d.maintenanceMsg||'System under maintenance.';
      loading(false); return;
    }
    document.getElementById('maint-screen').classList.remove('show');
    S.posts=d.posts||[]; S.comments=d.comments||[]; S.announcements=d.announcements||[];
    S.categories=d.categories||[]; S.reactions=d.reactions||{};
    if(d.customReactions&&d.customReactions.length) REACTIONS=d.customReactions;
    checkSmartNotifs(S.posts,S.comments,S.announcements,S.reactions);
    renderTabs(); renderAnnouncements();
    clearSkeletons();
    render(); checkDeepLink();
    renderTrendingWidget(); renderTopReportersWidget(); renderTagsWidget(); renderStatNumbers();
    renderSidebarCategories();
  }catch(e){
    apiErr(true);
    _dataLoaded=true; // clear skeleton state so ghosts don't persist
    const feed=document.getElementById('feed');
    if(feed&&!S.posts.length){
      feed.innerHTML=`<div class="empty"><div class="eico">📡</div><h3>Connection Error</h3><p>Could not reach the server. Check your connection and try again.</p><button class="btn btn-ghost btn-sm" onclick="loadData()">↺ Retry</button></div>`;
    }
    toast('Failed to load — check your connection','err');
  }
  loading(false);
}


/* ═══════════════════════════════════════════════════════
   MISSING BRIDGE FUNCTIONS — added to fix HTML/JS mismatch
   ═══════════════════════════════════════════════════════ */

/* handleAvatarFile — called by Settings modal avatar upload */
function handleAvatarFile(input){
  handleAvatarUpload(input,'s-avatar-preview','s-av-emoji-preview','s-emoji','s-emoji-grid');
}

/* handleMediaFiles — called by New Post modal file input */
function handleMediaFiles(input){ handleMedia(input); }

/* toggleAnonLabel — called by anonymous toggle checkbox */
function toggleAnonLabel(chkId,lblId){
  const chk=document.getElementById(chkId);
  const lbl=document.getElementById(lblId);
  if(!chk||!lbl)return;
  lbl.innerHTML=chk.checked?'Post <strong>Anonymously</strong>':'Post <strong>Publicly</strong>';
}

/* addOfficial — called by Officials field in New Post modal */
function addOfficial(ctx){
  const inp=document.getElementById(ctx+'-off-inp'); if(!inp)return;
  const val=inp.value.trim(); if(!val)return;
  const listEl=document.getElementById(ctx+'-officials-list');
  const hidEl=document.getElementById(ctx+'-officials');
  let arr=[];
  try{ arr=JSON.parse(hidEl?.value||'[]'); }catch{ arr=[]; }
  if(arr.includes(val)){toast('Already added','err');return;}
  arr.push(val);
  if(hidEl) hidEl.value=JSON.stringify(arr);
  if(listEl) listEl.innerHTML=arr.map((o,i)=>`<span class="official-tag">${esc(o)}<button onclick="removeOfficial('${ctx}',${i})">✕</button></span>`).join('');
  inp.value='';
}

function removeOfficial(ctx,idx){
  const listEl=document.getElementById(ctx+'-officials-list');
  const hidEl=document.getElementById(ctx+'-officials');
  let arr=[];
  try{ arr=JSON.parse(hidEl?.value||'[]'); }catch{ arr=[]; }
  arr.splice(idx,1);
  if(hidEl) hidEl.value=JSON.stringify(arr);
  if(listEl) listEl.innerHTML=arr.map((o,i)=>`<span class="official-tag">${esc(o)}<button onclick="removeOfficial('${ctx}',${i})">✕</button></span>`).join('');
}

/* saveSettings — called by Settings modal Save button */
async function saveSettings(){
  if(!currentUser)return;
  // Read from new HTML IDs, fallback to old IDs
  const gv=(ids,fallback='')=>{for(const id of ids){const el=document.getElementById(id);if(el&&el.value!==undefined)return el.value.trim();}return fallback;};
  const displayName=gv(['s-name','set-dname'])||currentUser.displayName;
  const bio=gv(['s-bio','set-bio']);
  const avatarEmoji=gv(['s-emoji','set-emoji'])||currentUser.avatarEmoji||'👤';
  const bannerColor=gv(['s-banner-color','set-color'])||currentUser.bannerColor||'#0d4a6b';
  const avatarUrl=_avatarImageCache['settings']||currentUser.avatarUrl||'';
  loading(true);
  try{
    const res=await API.post('auth',{action:'updateProfile',username:currentUser.username,password:'__profile_only__',
      displayName,bio,avatarEmoji,bannerColor,avatarUrl,avatarImage:''});
    if(res.ok){
      currentUser={...currentUser,displayName:res.displayName,avatarEmoji:res.avatarEmoji,avatarUrl:res.avatarUrl||'',avatarImage:'',bio:res.bio,bannerColor:res.bannerColor};
      saveUser(currentUser); renderAuthArea(); renderSidebarUser(); renderComposerBox();
      // Also handle password change if fields filled
      const curPw=gv(['s-cur-pass','set-cur-pw']);
      const newPw=gv(['s-new-pass','set-new-pw']);
      if(curPw && newPw && newPw.length>=6){
        const pr=await API.post('auth',{action:'changePassword',username:currentUser.username,password:curPw,newPassword:newPw});
        if(pr.ok) toast('Profile & password saved!','ok');
        else toast('Profile saved but password: '+(pr.error||'failed'),'err');
      } else {
        toast('Settings saved!','ok');
      }
      render();
    } else toast(res.error||'Failed','err');
  }catch(e){toast('Error saving settings','err');}
  loading(false);
}

/* saveEdit — called by Edit Post modal Save button */
async function saveEdit(){
  const postId=document.getElementById('edit-post-id')?.value;
  if(!postId){toast('No post selected','err');return;}
  const title=(document.getElementById('edit-title')?.value||'').trim();
  const content=(document.getElementById('edit-body')?.value||document.getElementById('edit-content')?.value||'').trim();
  if(!title||!content){toast('Title and content required','err');return;}
  const rawTags=(document.getElementById('edit-tags')?.value||'');
  const tags=rawTags.split(/[,\s]+/).map(t=>t.replace(/^#/,'')).filter(Boolean);
  const location=(document.getElementById('edit-location')?.value||'').trim();
  const category=document.getElementById('edit-cat')?.value||'';
  loading(true);
  try{
    const res=await API.post('posts',{action:'edit',id:postId,title,content,tags,location,category,urgency:curUrg,
      username:currentUser?.username});
    if(res.ok){close_('m-edit');toast('Report updated!','ok');await loadData();}
    else toast(res.error||'Failed','err');
  }catch(e){toast('Error updating report','err');}
  loading(false);
}

/* openEdit — opens the edit modal for a post */
function openEdit(postId){
  const p=S.posts.find(x=>x.id===postId);if(!p)return;
  const sv=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val;};
  sv('edit-post-id',postId);
  sv('edit-title',p.title||'');
  sv('edit-body',p.content||'');
  sv('edit-content',p.content||'');
  sv('edit-tags',(p.tags||[]).map(t=>'#'+t).join(' '));
  populateCatSelect('edit-cat');
  const catEl=document.getElementById('edit-cat');if(catEl&&p.category)catEl.value=p.category;
  populateBranchSelect();
  const locEl=document.getElementById('edit-location');if(locEl&&p.location)locEl.value=p.location;
  curUrg=p.urgency||'low';
  open_('m-edit');
}


/* postAnnouncement — called by Staff Panel */
async function postAnnouncement(){
  const title=(document.getElementById('ann-title')?.value||'').trim();
  const body=(document.getElementById('ann-body')?.value||'').trim();
  if(!title||!body){toast('Title and content required','err');return;}
  loading(true);
  try{
    let res;
    if(devAuthed){
      res=await API.post('admin',{action:'announce',passkey:devPass,data:{title,content:body}});
    } else {
      res=await API.post('staff',{action:'announce',username:currentUser.username,data:{title,content:body}});
    }
    if(res.ok){
      const tEl=document.getElementById('ann-title');const bEl=document.getElementById('ann-body');
      if(tEl)tEl.value='';if(bEl)bEl.value='';
      toast('Announcement posted!','ok');await loadData();
      const al=document.getElementById('ann-list');if(al)renderAnnPreview();
    } else toast(res.error||'Failed','err');
  }catch(e){toast('Error','err');}
  loading(false);
}

/* promoteTip — called by Staff Panel Promote tab */
async function promoteTip(){
  const sel=document.getElementById('promo-tip-sel');
  const tipId=sel?.value;
  if(!tipId){toast('Select a tip first','err');return;}
  loading(true);
  try{
    const res=await API.post('admin',{action:'postTip',passkey:devPass,data:{tipId,claimerName:'SENTINEL STAFF'}});
    if(res.ok){toast('Tip promoted to post!','ok');await loadData();if(sel)sel.value='';}
    else toast(res.error||'Failed','err');
  }catch(e){toast('Error','err');}
  loading(false);
}

/* ═══════════════════════════════════════════════════════════════
   WINDOW EXPORTS — ALL functions callable from HTML event handlers
   Required because <script type="module"> isolates scope from onclick.
   This single block eliminates every ReferenceError in DevTools.
   ═══════════════════════════════════════════════════════════════ */
Object.assign(window, {
  /* ── Auth / Landing ── */
  landingTab, landingLogin, landingRegister, continueAsGuest,
  authTab, doLogin, doRegister,
  openAuth, openWelcome, saveWelcome, skipWelcome, showMainApp, logout,
  toggleUserDropdown, closeUserDropdown,

  /* ── Profile / Settings ── */
  openMyProfile, openProfile, openSettings,
  saveSettings, saveProfile, changePassword, changeUsername,
  buildEmojiGrid, buildColorSwatches, selectEmoji, selectColor,
  handleAvatarFile, handleAvatarUpload,

  /* ── Navigation ── */
  sidebarNav, navTabSwitch,
  setTab, setTabByCategory, setSt,
  onSearch, clearSearch, updateSearchClear,
  setTagFilter, onSearchInput, onSearchKey, selectSearchUser,
  loadMore, render,

  /* ── New Post / Edit ── */
  openNew, setUrg, submitPost,
  openEdit, saveEdit,
  addOfficial, removeOfficial,
  handleMedia, handleMediaFiles,
  removeMedia, toggleAnonLabel, updateCount, updateReactPreview,

  /* ── Tips ── */
  openTip, setTipUrg, submitTip,

  /* ── Post Detail / Comments ── */
  openDetail, submitComment, staffDeleteComment, flagPost, sharePost,
  onCardTap, toggleReactPanel, doReact,

  /* ── Notifications ── */
  toggleNotifPanel, closeNotifPanel, clearNotifs, markNotifRead,

  /* ── Lightbox ── */
  openLB, closeLB, lbNav,

  /* ── Modals ── */
  open_, close_,

  /* ── Theme ── */
  toggleTheme, initTheme,

  /* ── Reactions Settings ── */
  saveCustomReactions, resetReactions,

  /* ── Staff Panel ── */
  openStaffPanel, staffTab, staffQuick,
  staffLoadComments, staffRenderComments, staffRenderReports,
  staffApproveUser, staffRejectUser, loadPendingUsersStaff,
  postAnnouncement, promoteTip,

  /* ── Dev Panel ── */
  devLogin, devLogout, openDev, openDevPanel, devAct, devActMain,
  devDeleteComment, devQuick, devTab, accSubTab,
  loadActivityLog, loadPendingUsers, approveUser, rejectUser,
  loadAllUsers, filterUsersList, setUserRole,
  loadTips, postTip, dismissTip,
  populatePickers, filterPicker, syncPickers,
  applyBulkAction, bulkSelectAll, bulkSelectNone, bulkSelectUnverified,
  toggleBulk, renderBulkList,
  addCat, removeCat, resetCats, saveCats,
  addBranch, removeBranch, resetBranches,
  exportData, setMaintenance, renderAnnPreview,

  /* ── Breaking Banner ── */
  dismissBreakingBanner, breakingBannerClick,

  /* ── Mobile Nav ── */
  mbnSwitch, mbnOpenSort, mbnSetSort, toggleMobileMenu,

  /* ── Utilities ── */
  toast, quickUnpin, syncMobileNotifBadge,
  openDevPanel_withReactions,
});

/* Extra direct assignments for safety */
window.openEdit = openEdit;
window.removeOfficial = removeOfficial;
window.toggleAnonLabel = toggleAnonLabel;
window.handleAvatarFile = handleAvatarFile;
window.handleMediaFiles = handleMediaFiles;
window.saveSettings = saveSettings;
window.saveEdit = saveEdit;
window.postAnnouncement = postAnnouncement;
window.promoteTip = promoteTip;
window.staffApproveUser = staffApproveUser;
window.staffRejectUser = staffRejectUser;
window.devLogout = devLogout;
