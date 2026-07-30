let mantras = [];
let activeMantraId = null;
let session = null; // { startTime, count }
let lockSession = null; // 鎖定模式底下的獨立累加，離開鎖定時併入同一個 session
let currentTapCircleUrl = null; // 目前套用在大圓上的法照 object URL
let currentPreviewUrl = null; // 佛號設定 modal 內預覽圖的 object URL

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

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
  bindCounter();
  bindLockMode();
  bindManualModal();
  bindMantraModal();
  bindTexts();
  renderStats();
  renderTextList();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

// ---------- Tabs ----------
function bindTabs() {
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      $$('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $(`#tab-${btn.dataset.tab}`).classList.add('active');
      if (btn.dataset.tab === 'stats') renderStats();
    });
  });
}

// ---------- 佛號選擇 chips ----------
function renderMantraChips() {
  for (const container of [$('#mantraChips'), $('#statsMantraChips')]) {
    container.innerHTML = '';
    mantras.forEach(m => {
      const chip = document.createElement('button');
      chip.className = 'mantra-chip' + (m.id === activeMantraId ? ' active' : '');
      chip.textContent = m.name;
      chip.style.borderColor = m.color;
      if (m.id === activeMantraId) chip.style.background = m.color;
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
    }
    $('#lockOverlay').classList.remove('hidden');
    $('#lockCount').textContent = session.count;
  });

  // 離開頁面前若有未結束的 session，先保存，避免資料遺失
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && session && session.count > 0) {
      commitSession(activeMantraId, session.count, session.startTime, Date.now(), 'auto');
    }
  });
}

async function endSession() {
  if (!session) return;
  const s = session;
  session = null;
  $('#countDisplay').textContent = '0';
  $('#sessionHint').textContent = '點擊圓形按鈕開始計數';
  $('#btnEndSession').disabled = true;
  if (s.count > 0) {
    await commitSession(activeMantraId, s.count, s.startTime, Date.now(), 'auto');
    renderStats();
  }
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
    pressTimer = setTimeout(() => {
      overlay.classList.add('hidden');
    }, 2000);
  };
  const cancelPress = (e) => {
    e.stopPropagation();
    clearTimeout(pressTimer);
  };
  exitBtn.addEventListener('touchstart', startPress);
  exitBtn.addEventListener('mousedown', startPress);
  exitBtn.addEventListener('touchend', cancelPress);
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
      <div>
        <div class="mantra-item-name">${m.name}</div>
        <div class="mantra-item-target">${m.target > 0 ? '發願 ' + m.target + ' 遍' : '未設定發願數'}</div>
      </div>
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

  const summaryEl = $('#statsSummary');
  summaryEl.innerHTML = `
    <div class="big-total">${total.toLocaleString()} 遍</div>
    ${target > 0 ? `
      <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, total / target * 100)}%"></div></div>
      <div style="color:var(--text-dim); font-size:0.85rem; margin-top:4px;">發願 ${target.toLocaleString()} 遍，已完成 ${Math.min(100, (total / target * 100)).toFixed(1)}%</div>
    ` : ''}
  `;

  $('#dailyList').innerHTML = mine.slice(0, 14).map(s =>
    `<div class="stats-row"><span>${s.date}</span><span class="count">${s.totalCount}</span></div>`
  ).join('') || emptyRow();

  const weekly = {};
  mine.forEach(s => { weekly[weekKey(s.date)] = (weekly[weekKey(s.date)] || 0) + s.totalCount; });
  $('#weeklyList').innerHTML = Object.entries(weekly).slice(0, 12).map(([k, v]) =>
    `<div class="stats-row"><span>${k}</span><span class="count">${v}</span></div>`
  ).join('') || emptyRow();

  const monthly = {};
  mine.forEach(s => { monthly[monthKey(s.date)] = (monthly[monthKey(s.date)] || 0) + s.totalCount; });
  $('#monthlyList').innerHTML = Object.entries(monthly).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12).map(([k, v]) =>
    `<div class="stats-row"><span>${k}</span><span class="count">${v}</span></div>`
  ).join('') || emptyRow();
}

function emptyRow() {
  return `<div class="stats-row" style="color:var(--text-dim)"><span>尚無紀錄</span></div>`;
}

// ---------- 法本 (PDF，靜態庫，見 js/text-library.js) ----------
function renderTextList() {
  const list = $('#textList');
  list.innerHTML = TEXT_LIBRARY.map((t, i) => `
    <div class="mantra-item text-item" data-index="${i}">
      <div class="text-item-icon">PDF</div>
      <div class="text-item-info">
        <div class="text-item-name">${t.name}</div>
      </div>
    </div>
  `).join('') || `<div style="color:var(--text-dim); padding:12px;">尚無法本</div>`;
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
