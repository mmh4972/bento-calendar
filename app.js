// 訂便當月曆：先點上班日（黃格子），再標午餐、晚餐有沒有訂到。資料存在 Firebase（跟洗腎叫車同一個專案，放在 bento 區塊）
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, deleteDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js?v=2';

// 點一下換下一個狀態
const STATUS = [
  { id: '', label: '未訂', cls: 's-none' },
  { id: 'ok', label: '訂到', cls: 's-ok' },
  { id: 'skip', label: '不用', cls: 's-skip' },
];
const MEALS = [{ id: 'lunch', name: '午' }, { id: 'dinner', name: '晚' }];
const $ = (id) => document.getElementById(id);

let days = {};                         // { '2026-10-31': { work: true, lunch: 'ok', dinner: 'skip' } }
let view = firstOfMonth(new Date());
let mode = null;                       // 'work' 點上班日、'bento' 標便當；第一次讀到資料時決定
let db = null;
let unsubs = [];

function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function keyOf(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function todayKey() { return keyOf(new Date()); }
function rec(key) { return days[key] || {}; }
function statusOf(id) { return STATUS.find((s) => s.id === (id || '')) || STATUS[0]; }
function monthKeys() {
  const y = view.getFullYear(), m = view.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  return Array.from({ length: last }, (_, i) => keyOf(new Date(y, m, i + 1)));
}

function setMode(m) {
  mode = m;
  document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('sel', b.dataset.mode === m));
  render();
}

function render() {
  const y = view.getFullYear(), m = view.getMonth();
  $('title').textContent = y + ' 年 ' + (m + 1) + ' 月';
  $('legend').innerHTML = mode === 'work'
    ? '<span>點日子切換：</span><span><i class="dot work"></i>有上班</span><span>白色＝沒上班</span>'
    : '<span>點午／晚切換：</span><span><i class="dot s-none"></i>未訂</span><span><i class="dot s-ok"></i>訂到</span><span><i class="dot s-skip"></i>不用</span>';
  const grid = $('grid');
  grid.className = 'grid mode-' + mode;
  grid.innerHTML = '';
  const lead = (view.getDay() + 6) % 7; // 週一為第一欄
  for (let i = 0; i < lead; i++) grid.appendChild(Object.assign(document.createElement('div'), { className: 'cell empty' }));

  const tk = todayKey();
  const count = { work: 0, lunchOk: 0, lunchNone: 0, dinnerOk: 0, dinnerNone: 0 };
  for (const key of monthKeys()) {
    const r = rec(key);
    const cell = document.createElement('div');
    cell.className = 'cell' + (r.work ? ' work' : '') + (key === tk ? ' today' : '') + (key < tk ? ' past' : '');
    cell.innerHTML = '<span class="num">' + Number(key.slice(8)) + '</span>';
    if (r.work) {
      count.work++;
      for (const meal of MEALS) {
        const s = statusOf(r[meal.id]);
        if (s.id === 'ok') count[meal.id + 'Ok']++;
        if (s.id === '') count[meal.id + 'None']++;
        const b = document.createElement('button');
        b.className = 'slot ' + s.cls;
        b.textContent = meal.name + ' ' + s.label;
        b.addEventListener('click', (e) => {
          if (mode !== 'bento') return;
          e.stopPropagation();
          const next = STATUS[(STATUS.indexOf(s) + 1) % STATUS.length].id;
          saveDay(key, Object.assign({}, r, { [meal.id]: next }));
        });
        cell.appendChild(b);
      }
    }
    cell.addEventListener('click', () => {
      if (mode === 'work') saveDay(key, r.work ? {} : { work: true });
      else if (!r.work) setSync('這天沒上班。要改上班日，請先切到「① 點上班日」');
    });
    grid.appendChild(cell);
  }

  if (!count.work) {
    $('summary').textContent = mode === 'work'
      ? '這個月還沒點上班日。直接點日子，有上班的會變黃色。'
      : '這個月還沒有上班日，請先切到「① 點上班日」。';
  } else {
    const part = (name, ok, none) => name + '：<b class="green">' + ok + '</b> 天訂到' + (none ? '、<b class="red">' + none + '</b> 天未訂' : '');
    $('summary').innerHTML = '這個月上班 <b>' + count.work + '</b> 天<br>' +
      part('午餐', count.lunchOk, count.lunchNone) + '<br>' + part('晚餐', count.dinnerOk, count.dinnerNone);
  }
}

// ---- 雲端 ----
function setSync(text, bad) { $('sync').textContent = text; $('sync').classList.toggle('bad', !!bad); }
function syncState(meta) {
  if (meta.hasPendingWrites) setSync(navigator.onLine ? '儲存中…' : '沒有網路，已先存在這台裝置，連上網路後會自動上傳');
  else if (meta.fromCache) setSync('沒有網路，顯示的是上次的資料');
  else setSync('已同步，手機和電腦都看得到');
}
function writeError(e) {
  setSync('儲存失敗（' + (e.code || e.message) + '），請確認帳號有權限', true);
}

function listen() {
  unsubs.push(onSnapshot(collection(db, 'bento'), { includeMetadataChanges: true }, (snap) => {
    const next = {};
    snap.forEach((d) => { next[d.id] = d.data(); });
    days = next;
    // 第一次打開：這個月還沒排班就從「點上班日」開始，排過了就直接標便當
    if (!mode) setMode(monthKeys().some((k) => rec(k).work) ? 'bento' : 'work');
    else render();
    syncState(snap.metadata);
  }, (e) => setSync('讀取失敗（' + e.code + '）：這個帳號可能沒有權限', true)));
}

function saveDay(key, r) {
  for (const k of Object.keys(r)) if (r[k] === '' || r[k] === undefined) delete r[k];
  if (!r.work) r = {}; // 取消上班，便當紀錄一起清掉
  if (Object.keys(r).length) days[key] = r; else delete days[key];
  render();
  const ref = doc(db, 'bento', key);
  (Object.keys(r).length ? setDoc(ref, r) : deleteDoc(ref)).catch(writeError);
}

// ---- 視窗開關與導覽 ----
function show(id) {
  $('backdrop').classList.add('show');
  $(id).classList.add('show');
}
function hide() {
  $('backdrop').classList.remove('show');
  document.querySelectorAll('.sheet').forEach((s) => s.classList.remove('show'));
}
$('backdrop').addEventListener('click', hide);
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', hide));
document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
$('prev').addEventListener('click', () => { view = new Date(view.getFullYear(), view.getMonth() - 1, 1); render(); });
$('next').addEventListener('click', () => { view = new Date(view.getFullYear(), view.getMonth() + 1, 1); render(); });
$('todayBtn').addEventListener('click', () => { view = firstOfMonth(new Date()); render(); });
$('settingsBtn').addEventListener('click', () => { $('ver').textContent = '版本 ' + window.APP_VERSION; show('setSheet'); });

// 左右滑動換月
let sx = null;
$('grid').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
$('grid').addEventListener('touchend', (e) => {
  if (sx === null) return;
  const dx = e.changedTouches[0].clientX - sx;
  sx = null;
  if (Math.abs(dx) > 60) $(dx < 0 ? 'next' : 'prev').click();
});

// ---- 登入 ----
if (!firebaseConfig.apiKey) {
  $('login').hidden = false;
  $('loginErr').textContent = '還沒填 Firebase 設定（firebase-config.js）';
  $('loginBtn').disabled = true;
} else {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });

  onAuthStateChanged(auth, (user) => {
    unsubs.forEach((u) => u());
    unsubs = [];
    days = {};
    mode = null;
    $('login').hidden = !!user;
    $('app').hidden = !user;
    if (user) {
      $('who').textContent = user.email;
      listen();
    }
  });

  $('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('loginErr').textContent = '';
    $('loginBtn').disabled = true;
    try {
      await signInWithEmailAndPassword(auth, $('email').value.trim(), $('password').value);
    } catch (err) {
      const msg = {
        'auth/invalid-credential': 'Email 或密碼不對',
        'auth/invalid-email': 'Email 格式不對',
        'auth/too-many-requests': '試太多次了，請稍後再試',
        'auth/network-request-failed': '沒有網路，請連上網路再登入',
      }[err.code];
      $('loginErr').textContent = msg || ('登入失敗（' + err.code + '）');
    }
    $('loginBtn').disabled = false;
  });
  $('logoutBtn').addEventListener('click', () => { hide(); signOut(auth); });
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
