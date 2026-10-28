let mantras = [];
let activeMantraId = null;
let session = null; // { startTime, count }
let lockSession = null; // 鎖定模式底下的獨立累加，離開鎖定時併入同一個 session
let currentTapCircleUrl = null; // 目前套用在大圓上的法照 object URL
let currentPreviewUrl = null; // 佛號設定 modal 內預覽圖的 object URL
let reloadWhenIdle = false; // 新版已就緒但正在念，等按「結束本次」後再換

// 版本號直接讀 index.html 裡 app.js?v=N 的 N，改版時不用多改一個地方
const APP_VERSION = (() => {
  try { return new URL(document.currentScript.src).searchParams.get('v') || ''; } catch (e) { return ''; }
})();

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const ICON_CHEVRON = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

// ---------- 初始化 ----------
async function init() {
  mantras = await DB.getAll('mantras');
  if (mantras.length === 0) {
    const seed = { id: uuid(), name: '南無阿彌陀佛', target: 0, color: '#c99a4a', createdAt: Date.now() };
    await DB.put('mantras', seed);
    mantras = [seed];
  }
  activeMantraId = mantras[0].id;

  renderMantraChips();
  renderMantraList();
  applyTapCircleBackground();
  bindTabs();
  bindStatsRange();
  bindCounter();
  bindLockMode();
  bindManualModal();
  bindMantraModal();
  bindTexts();
  bindExportPdf();
  renderStats();
  renderTextList();

  $('#appVersion').textContent = APP_VERSION ? `目前版本：${APP_VERSION}` : '';
  registerServiceWorker();
}

// ---------- 自動更新 ----------
// 每次打開或切回 App 都檢查有沒有新版；新版裝好就自動重新載入，
// 正在念的話等按「結束本次」再換，不會打斷計數
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller; // 第一次安裝不算更新，不用重新載入
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (session) reloadWhenIdle = true;
    else location.reload();
  });
}

// ---------- Tabs ----------
function bindTabs() {
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  // 右上角的登入狀態：點了直接到「設定」頁看帳號
  $('#syncBadge').addEventListener('click', () => switchTab('mantras'));
}

function switchTab(tab) {
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
  window.scrollTo(0, 0);
  if (tab === 'stats') renderStats();
}

// ---------- 佛號選擇 chips ----------
function renderMantraChips() {
  for (const container of [$('#mantraChips'), $('#statsMantraChips')]) {
    container.innerHTML = '';
    mantras.forEach(m => {
      const chip = document.createElement('button');
      chip.className = 'mantra-chip' + (m.id === activeMantraId ? ' active' : '');
      chip.textContent = m.name;
      chip.style.setProperty('--chip', m.color);
      chip.addEventListener('click', () => {
        if (session) { alert('請先結束目前的計數再切換佛號'); return; }
        activeMantraId = m.id;
        renderMantraChips();
        renderStats();
        applyTapCircleBackground();
      });
      container.appendChild(chip);
    });
  }
}

// 依目前選中的佛號，把法照套到計數大圓上（沒有法照就用原本的漸層色）
function applyTapCircleBackground() {
  const circle = $('#tapCircle');
  if (currentTapCircleUrl) { URL.revokeObjectURL(currentTapCircleUrl); currentTapCircleUrl = null; }
  const mantra = mantras.find(m => m.id === activeMantraId);
  if (mantra) $('#tapWrap').style.setProperty('--ring', mantra.color); // 大圓外圈用佛號顏色
  if (mantra && mantra.image) {
    currentTapCircleUrl = URL.createObjectURL(mantra.image);
    circle.style.backgroundImage = `linear-gradient(rgba(0,0,0,0.35), rgba(0,0,0,0.35)), url("${currentTapCircleUrl}")`;
    circle.style.backgroundSize = 'cover';
    circle.style.backgroundPosition = 'center';
    circle.classList.add('has-image');
  } else {
    circle.style.backgroundImage = '';
    circle.style.backgroundSize = '';
    circle.style.backgroundPosition = '';
    circle.classList.remove('has-image');
  }
}

// ---------- 計數 ----------
function vibrate(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

function bindCounter() {
  $('#tapCircle').addEventListener('click', () => {
    if (!session) {
      session = { startTime: Date.now(), count: 0 };
      $('#btnEndSession').disabled = false;
      $('#sessionHint').textContent = '持誦中…';
    }
    session.count++;
    vibrate(30);
    $('#countDisplay').textContent = session.count;
  });

  $('#btnEndSession').addEventListener('click', endSession);

  $('#btnLock').addEventListener('click', () => {
    if (!session) {
      session = { startTime: Date.now(), count: 0 };
      $('#btnEndSession').disabled = false;
      $('#sessionHint').textContent = '持誦中…';
    }
    const mantra = mantras.find(m => m.id === activeMantraId);
    $('#lockMantra').textContent = mantra ? mantra.name : '';
    $('#lockOverlay').classList.remove('hidden');
    $('#lockCount').textContent = session.count;
  });

  // 離開頁面前（關螢幕、切到別的 App）若有未結束的 session，先保存，避免資料遺失
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && session) {
      saveSessionProgress(session).then(renderStats);
    }
  });
}

// 只存「上次存檔之後」新念的部分：離開畫面時先存一次，
// 回來繼續念、按結束時只補存剩下的，同一段就不會被算兩次
function saveSessionProgress(s) {
  const unsaved = s.count - (s.savedCount || 0);
  if (unsaved <= 0) return Promise.resolve();
  const from = s.savedAt || s.startTime;
  const now = Date.now();
  s.savedCount = s.count;
  s.savedAt = now;
  return commitSession(activeMantraId, unsaved, from, now, 'auto');
}

async function endSession() {
  if (!session) return;
  const s = session;
  session = null;
  $('#countDisplay').textContent = '0';
  $('#sessionHint').textContent = '輕觸開始';
  $('#btnEndSession').disabled = true;
  await saveSessionProgress(s);
  renderStats();
  if (reloadWhenIdle) location.reload();
}

// ---------- 鎖定模式（防誤觸）----------
function bindLockMode() {
  const overlay = $('#lockOverlay');
  overlay.addEventListener('click', (e) => {
    if (e.target.id === 'lockExit') return;
    if (!session) session = { startTime: Date.now(), count: 0 };
    session.count++;
    vibrate(30);
    $('#lockCount').textContent = session.count;
    $('#countDisplay').textContent = session.count;
  });

  let pressTimer = null;
  const exitBtn = $('#lockExit');
  const startPress = (e) => {
    e.stopPropagation();
    exitBtn.classList.add('pressing'); // 按鈕慢慢填滿，讓人知道要繼續按住
    pressTimer = setTimeout(() => {
      exitBtn.classList.remove('pressing');
      overlay.classList.add('hidden');
    }, 2000);
  };
  const cancelPress = (e) => {
    e.stopPropagation();
    exitBtn.classList.remove('pressing');
    clearTimeout(pressTimer);
  };
  exitBtn.addEventListener('touchstart', startPress);
  exitBtn.addEventListener('mousedown', startPress);
  exitBtn.addEventListener('touchend', cancelPress);
  exitBtn.addEventListener('touchcancel', cancelPress);
  exitBtn.addEventListener('mouseup', cancelPress);
  exitBtn.addEventListener('mouseleave', cancelPress);
}

// ---------- 手動輸入 ----------
function bindManualModal() {
  $('#btnManual').addEventListener('click', () => {
    const sel = $('#manualMantra');
    sel.innerHTML = mantras.map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    sel.value = activeMantraId;
    $('#manualCount').value = 1;
    $('#manualDate').value = todayStr();
    $('#manualModal').classList.remove('hidden');
  });
  $('#manualCancel').addEventListener('click', () => $('#manualModal').classList.add('hidden'));
  $('#manualSave').addEventListener('click', async () => {
    const mantraId = $('#manualMantra').value;
    const count = parseInt($('#manualCount').value, 10) || 0;
    const dateVal = $('#manualDate').value || todayStr();
    if (count <= 0) { alert('請輸入大於 0 的次數'); return; }
    const t = new Date(dateVal + 'T12:00:00').getTime();
    await commitSession(mantraId, count, t, t, 'manual');
    $('#manualModal').classList.add('hidden');
    renderStats();
  });
}

// ---------- 佛號設定 ----------
function renderMantraList() {
  const list = $('#mantraList');
  list.innerHTML = '';
  mantras.forEach(m => {
    const item = document.createElement('div');
    item.className = 'mantra-item';
    item.innerHTML = `
      <div class="mantra-swatch" style="background:${m.color}"></div>
      <div class="mantra-item-info">
        <div class="mantra-item-name">${m.name}</div>
        <div class="mantra-item-target">${m.target > 0 ? '發願 ' + m.target.toLocaleString() + ' 遍' : '未設定發願數'}</div>
      </div>
      ${ICON_CHEVRON}
    `;
    item.addEventListener('click', () => openMantraModal(m));
    list.appendChild(item);
  });
}

let editingMantraId = null;
let pendingImage = 'unchanged'; // 'unchanged' | File | 'removed'

function showImagePreview(blob) {
  if (currentPreviewUrl) { URL.revokeObjectURL(currentPreviewUrl); currentPreviewUrl = null; }
  const preview = $('#mantraImagePreview');
  if (blob) {
    currentPreviewUrl = URL.createObjectURL(blob);
    preview.src = currentPreviewUrl;
    preview.classList.remove('hidden');
    $('#mantraImageRemove').classList.remove('hidden');
  } else {
    preview.src = '';
    preview.classList.add('hidden');
    $('#mantraImageRemove').classList.add('hidden');
  }
}

function openMantraModal(m) {
  editingMantraId = m ? m.id : null;
  pendingImage = 'unchanged';
  $('#mantraModalTitle').textContent = m ? '編輯佛號' : '新增佛號';
  $('#mantraName').value = m ? m.name : '';
  $('#mantraTarget').value = m ? m.target : 0;
  $('#mantraColor').value = m ? m.color : '#c99a4a';
  $('#mantraImage').value = '';
  showImagePreview(m ? m.image : null);
  $('#mantraDelete').classList.toggle('hidden', !m);
  $('#mantraModal').classList.remove('hidden');
}

function bindMantraModal() {
  $('#btnAddMantra').addEventListener('click', () => openMantraModal(null));
  $('#mantraCancel').addEventListener('click', () => $('#mantraModal').classList.add('hidden'));

  $('#mantraImage').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingImage = file;
    showImagePreview(file);
  });

  $('#mantraImageRemove').addEventListener('click', () => {
    pendingImage = 'removed';
    $('#mantraImage').value = '';
    showImagePreview(null);
  });

  $('#mantraSave').addEventListener('click', async () => {
    const name = $('#mantraName').value.trim();
    if (!name) { alert('請輸入名稱'); return; }
    const target = parseInt($('#mantraTarget').value, 10) || 0;
    const color = $('#mantraColor').value;
    let savedMantra;
    if (editingMantraId) {
      const m = mantras.find(x => x.id === editingMantraId);
      m.name = name; m.target = target; m.color = color;
      if (pendingImage instanceof File) m.image = pendingImage;
      else if (pendingImage === 'removed') m.image = null;
      await DB.put('mantras', m);
      savedMantra = m;
    } else {
      const image = pendingImage instanceof File ? pendingImage : null;
      const m = { id: uuid(), name, target, color, image, createdAt: Date.now() };
      await DB.put('mantras', m);
      mantras.push(m);
      savedMantra = m;
    }
    if (typeof syncPushMantra === 'function') syncPushMantra(savedMantra);
    $('#mantraModal').classList.add('hidden');
    renderMantraChips();
    renderMantraList();
    applyTapCircleBackground();
  });

  $('#mantraDelete').addEventListener('click', async () => {
    if (!editingMantraId) return;
    if (mantras.length <= 1) { alert('至少要保留一個佛號'); return; }
    if (!confirm('確定刪除這個佛號？歷史紀錄不會被刪除，但將無法在畫面上選取。')) return;
    await DB.delete('mantras', editingMantraId);
    if (typeof syncDeleteMantra === 'function') syncDeleteMantra(editingMantraId);
    mantras = mantras.filter(x => x.id !== editingMantraId);
    if (activeMantraId === editingMantraId) activeMantraId = mantras[0].id;
    $('#mantraModal').classList.add('hidden');
    renderMantraChips();
    renderMantraList();
    applyTapCircleBackground();
  });
}

// ---------- 統計 ----------
function weekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = (d.getDay() + 6) % 7; // 週一為 0
  d.setDate(d.getDate() - day);
  return todayStr(d) + ' 那週';
}
function monthKey(dateStr) {
  return dateStr.slice(0, 7);
}

async function renderStats() {
  const summaries = await DB.getAll('dailySummaries');
  const mine = summaries.filter(s => s.mantraId === activeMantraId).sort((a, b) => b.date.localeCompare(a.date));

  const total = mine.reduce((sum, s) => sum + s.totalCount, 0);
  const mantra = mantras.find(m => m.id === activeMantraId);
  const target = mantra ? mantra.target : 0;
  const pct = target > 0 ? Math.min(100, total / target * 100) : 0;

  const weekly = {};
  mine.forEach(s => { weekly[weekKey(s.date)] = (weekly[weekKey(s.date)] || 0) + s.totalCount; });
  const monthly = {};
  mine.forEach(s => { monthly[monthKey(s.date)] = (monthly[monthKey(s.date)] || 0) + s.totalCount; });

  const today = todayStr();
  const todayCount = (mine.find(s => s.date === today) || { totalCount: 0 }).totalCount;
  const weekCount = weekly[weekKey(today)] || 0;
  const monthCount = monthly[monthKey(today)] || 0;

  $('#statsSummary').innerHTML = `
    <div class="summary-name">${mantra ? mantra.name : ''}</div>
    <div class="summary-label">累積總數</div>
    <div class="big-total">${total.toLocaleString()}<small>遍</small></div>
    ${target > 0 ? `
      <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
      <div class="progress-text">發願 ${target.toLocaleString()} 遍，已完成 ${pct.toFixed(1)}%</div>
    ` : `<div class="progress-text">還沒設定發願數，可以到「設定」頁加上</div>`}
    <div class="stat-tiles">
      <div class="stat-tile"><b>${todayCount.toLocaleString()}</b><span>今日</span></div>
      <div class="stat-tile"><b>${weekCount.toLocaleString()}</b><span>本週</span></div>
      <div class="stat-tile"><b>${monthCount.toLocaleString()}</b><span>本月</span></div>
    </div>
  `;

  $('#dailyList').innerHTML = statsRows(mine.slice(0, 14).map(s => [s.date, s.totalCount]));
  $('#weeklyList').innerHTML = statsRows(Object.entries(weekly).slice(0, 12));
  $('#monthlyList').innerHTML = statsRows(Object.entries(monthly).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12));

  // 計數頁上方的小統計，和大圓外圈的發願進度
  $('#metaToday').textContent = todayCount.toLocaleString();
  $('#metaTotal').textContent = total.toLocaleString();
  $('#metaTarget').textContent = target > 0 ? pct.toFixed(1) + '%' : '未設定';
  $('#tapWrap').style.setProperty('--p', pct);
  $('#tapWrap').classList.toggle('no-target', target === 0);
}

// 每一列後面墊一條淺色長條，一眼看出哪天念得多
function statsRows(entries) {
  if (entries.length === 0) return emptyRow();
  const max = Math.max(...entries.map(([, v]) => v));
  return entries.map(([k, v]) =>
    `<div class="stats-row"><i class="bar" style="width:${max > 0 ? v / max * 100 : 0}%"></i><span>${k}</span><span class="count">${v.toLocaleString()}</span></div>`
  ).join('');
}

function emptyRow() {
  return `<div class="stats-row empty"><span>尚無紀錄</span></div>`;
}

// 統計頁「每日／每週／每月」切換
function bindStatsRange() {
  $$('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
      $$('.stats-group').forEach(g => g.classList.toggle('active', g.dataset.range === btn.dataset.range));
    });
  });
}

// ---------- 匯出累積總數 PDF（用瀏覽器內建列印，選「另存為 PDF」）----------
function bindExportPdf() {
  $('#btnExportPdf').addEventListener('click', exportStatsPdf);
}

async function exportStatsPdf() {
  const summaries = await DB.getAll('dailySummaries');
  const rows = mantras.map((m) => {
    const total = summaries.filter(s => s.mantraId === m.id).reduce((sum, s) => sum + s.totalCount, 0);
    return { name: m.name, total, target: m.target };
  });
  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const rowsHtml = rows.map(r => `
    <tr>
      <td>${r.name}</td>
      <td style="text-align:right">${r.total.toLocaleString()}</td>
      <td>${r.target > 0 ? `發願 ${r.target.toLocaleString()} 遍，已完成 ${Math.min(100, r.total / r.target * 100).toFixed(1)}%` : ''}</td>
    </tr>
  `).join('');

  $('#printReport').innerHTML = `
    <h1>念佛計數 累積總數報表</h1>
    <p class="print-meta">匯出時間：${dateStr}</p>
    <table>
      <thead><tr><th>佛號 / 咒語</th><th>累積次數</th><th>發願進度</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot><tr><td>總計</td><td style="text-align:right">${grandTotal.toLocaleString()}</td><td></td></tr></tfoot>
    </table>
  `;
  window.print();
}

// ---------- 法本 (PDF，靜態庫，見 js/text-library.js) ----------
function renderTextList() {
  const list = $('#textList');
  list.innerHTML = TEXT_LIBRARY.map((t, i) => `
    <div class="mantra-item text-item" data-index="${i}">
      <div class="text-item-icon">PDF</div>
      <div class="text-item-info">
        <div class="text-item-name">${t.name}</div>
        <div class="text-item-sub">點開閱讀</div>
      </div>
      ${ICON_CHEVRON}
    </div>
  `).join('') || `<div class="list-empty">尚無法本</div>`;
}

function bindTexts() {
  $('#textList').addEventListener('click', (e) => {
    const item = e.target.closest('.text-item');
    if (item) openPdfViewer(TEXT_LIBRARY[item.dataset.index]);
  });

  $('#pdfViewerClose').addEventListener('click', closePdfViewer);
}

function openPdfViewer(text) {
  $('#pdfViewerTitle').textContent = text.name;
  $('#pdfViewerFrame').src = text.file;
  $('#pdfViewer').classList.remove('hidden');
}

function closePdfViewer() {
  $('#pdfViewer').classList.add('hidden');
  $('#pdfViewerFrame').src = '';
}

// ---------- 給 js/sync.js 呼叫：其他裝置的變更同步下來後刷新畫面 ----------
async function onMantrasChangedExternally() {
  mantras = await DB.getAll('mantras');
  if (mantras.length === 0) return; // 理論上不會發生（至少會保留一個），保守起見不刷新
  if (!mantras.find(m => m.id === activeMantraId)) activeMantraId = mantras[0].id;
  renderMantraChips();
  renderMantraList();
  applyTapCircleBackground();
}

function onStatsChangedExternally() {
  renderStats();
}

init();
