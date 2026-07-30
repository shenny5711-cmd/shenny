// Firebase 同步：帳號密碼登入 + Firestore 即時同步（mantras / sessions）
// 法本 PDF、佛號法照是靜態庫（js/text-library.js），不經過這裡

firebase.initializeApp(firebaseConfig);
const fbAuth = firebase.auth();
const fbStore = firebase.firestore();
fbStore.enablePersistence({ synchronizeTabs: true }).catch(() => {});

let currentUid = null;
let unsubMantras = null;
let unsubSessions = null;

function $sync(sel) { return document.querySelector(sel); }

function userCollectionPath(sub) {
  return `users/${currentUid}/${sub}`;
}

// ---------- 登入 / 註冊 UI ----------
function bindAuthUI() {
  $sync('#btnAuthOpen').addEventListener('click', () => {
    if (currentUid) {
      if (confirm('確定要登出嗎？')) fbAuth.signOut();
      return;
    }
    $sync('#authError').textContent = '';
    $sync('#authEmail').value = '';
    $sync('#authPassword').value = '';
    $sync('#authModal').classList.remove('hidden');
  });

  $sync('#authCancel').addEventListener('click', () => $sync('#authModal').classList.add('hidden'));

  $sync('#authSignIn').addEventListener('click', async () => {
    const email = $sync('#authEmail').value.trim();
    const password = $sync('#authPassword').value;
    try {
      await fbAuth.signInWithEmailAndPassword(email, password);
      $sync('#authModal').classList.add('hidden');
    } catch (e) {
      $sync('#authError').textContent = describeAuthError(e);
    }
  });

  $sync('#authSignUp').addEventListener('click', async () => {
    const email = $sync('#authEmail').value.trim();
    const password = $sync('#authPassword').value;
    try {
      await fbAuth.createUserWithEmailAndPassword(email, password);
      $sync('#authModal').classList.add('hidden');
    } catch (e) {
      $sync('#authError').textContent = describeAuthError(e);
    }
  });
}

function describeAuthError(e) {
  const map = {
    'auth/invalid-email': 'Email 格式不對',
    'auth/weak-password': '密碼至少要 6 碼',
    'auth/email-already-in-use': '這個帳號已經註冊過了，改用「登入」',
    'auth/wrong-password': '密碼錯誤',
    'auth/user-not-found': '帳號不存在，改用「註冊新帳號」',
    'auth/invalid-credential': '帳號或密碼錯誤'
  };
  return map[e.code] || ('發生錯誤：' + e.message);
}

fbAuth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUid = user.uid;
    $sync('#authLabel').textContent = '已登入：' + user.email;
    $sync('#btnAuthOpen').textContent = '登出';
    await backfillLocalDataToCloud();
    startSync();
  } else {
    currentUid = null;
    $sync('#authLabel').textContent = '未登入';
    $sync('#btnAuthOpen').textContent = '登入';
    stopSync();
  }
});

// ---------- 補送：把這台裝置在「登入同步之前」就已經存在的本機資料推上雲端 ----------
// 只做一次（每台裝置/每個瀏覽器一次即可，之後的新資料都會透過 syncPush* 即時推送，不需要再補）
async function backfillLocalDataToCloud() {
  const flagKey = 'chant_backfilled_' + currentUid;
  if (localStorage.getItem(flagKey)) return;

  const mantras = await DB.getAll('mantras');
  await Promise.all(mantras.map((m) => {
    const { id, name, target, color, createdAt } = m;
    return fbStore.doc(userCollectionPath('mantras') + '/' + id).set({ name, target, color, createdAt }).catch(() => {});
  }));

  const sessions = await DB.getAll('sessions');
  await Promise.all(sessions.map((s) =>
    fbStore.doc(userCollectionPath('sessions') + '/' + s.id).set(s).catch(() => {})
  ));

  localStorage.setItem(flagKey, '1');
}

// ---------- 即時同步 ----------
function startSync() {
  unsubMantras = fbStore.collection(userCollectionPath('mantras')).onSnapshot(async (snap) => {
    for (const change of snap.docChanges()) {
      const id = change.doc.id;
      if (change.type === 'removed') {
        await DB.delete('mantras', id);
      } else {
        const data = change.doc.data();
        const existing = await DB.get('mantras', id);
        await DB.put('mantras', Object.assign({}, existing, data, { id }));
      }
    }
    if (typeof onMantrasChangedExternally === 'function') onMantrasChangedExternally();
  }, (err) => console.warn('佛號同步監聽中斷：', err.code));

  unsubSessions = fbStore.collection(userCollectionPath('sessions')).onSnapshot(async (snap) => {
    let changed = false;
    for (const change of snap.docChanges()) {
      if (change.type === 'removed') continue;
      const id = change.doc.id;
      const existing = await DB.get('sessions', id);
      if (existing) continue; // 已經有了（很可能是本機自己剛推上去、又監聽回來的那筆）
      const data = change.doc.data();
      await DB.put('sessions', Object.assign({ id }, data));
      await recomputeDailySummary(data.mantraId, todayStr(new Date(data.startTime)));
      changed = true;
    }
    if (changed && typeof onStatsChangedExternally === 'function') onStatsChangedExternally();
  }, (err) => console.warn('念佛紀錄同步監聽中斷：', err.code));
}

function stopSync() {
  if (unsubMantras) { unsubMantras(); unsubMantras = null; }
  if (unsubSessions) { unsubSessions(); unsubSessions = null; }
}

// ---------- 推上雲端（給 db.js / app.js 呼叫）----------
function syncPushMantra(m) {
  if (!currentUid) return;
  const { id, name, target, color, createdAt } = m; // 故意不同步 image（Blob 存不進 Firestore，且法照正在改走靜態庫）
  fbStore.doc(userCollectionPath('mantras') + '/' + id).set({ name, target, color, createdAt }).catch(() => {});
}

function syncDeleteMantra(id) {
  if (!currentUid) return;
  fbStore.doc(userCollectionPath('mantras') + '/' + id).delete().catch(() => {});
}

function syncPushSession(session) {
  if (!currentUid) return;
  fbStore.doc(userCollectionPath('sessions') + '/' + session.id).set(session).catch(() => {});
}

bindAuthUI();
