// IndexedDB 封裝：mantras / sessions / dailySummaries
// 法本 PDF、佛號法照改用靜態庫（js/text-library.js），不再存進 IndexedDB
const DB_NAME = 'chant-keeper';
const DB_VERSION = 3;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('mantras')) {
        db.createObjectStore('mantras', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('by_mantra', 'mantraId');
        s.createIndex('by_start', 'startTime');
      }
      if (!db.objectStoreNames.contains('dailySummaries')) {
        db.createObjectStore('dailySummaries', { keyPath: 'id' });
      }
      if (db.objectStoreNames.contains('texts')) {
        db.deleteObjectStore('texts');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = openDB();

function tx(storeName, mode) {
  return dbPromise.then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const DB = {
  async put(storeName, value) {
    const store = await tx(storeName, 'readwrite');
    return reqToPromise(store.put(value));
  },
  async get(storeName, id) {
    const store = await tx(storeName, 'readonly');
    return reqToPromise(store.get(id));
  },
  async delete(storeName, id) {
    const store = await tx(storeName, 'readwrite');
    return reqToPromise(store.delete(id));
  },
  async getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return reqToPromise(store.getAll());
  },
  async getAllByIndex(storeName, indexName, value) {
    const store = await tx(storeName, 'readonly');
    return reqToPromise(store.index(indexName).getAll(value));
  }
};

// crypto.randomUUID() 只能在「安全網域」(https 或 localhost) 下用，
// 用區網 IP（手機/平板連線必須用這個）走 http 存取時會是 undefined，所以要有備援寫法
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function todayStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 從 sessions 重新加總某一天的彙總（而不是遞增），這樣不管是本機新紀錄
// 還是從其他裝置同步下來的紀錄，重複套用都不會算兩次
async function recomputeDailySummary(mantraId, dateKey) {
  const all = await DB.getAllByIndex('sessions', 'by_mantra', mantraId);
  const daySessions = all.filter(s => todayStr(new Date(s.startTime)) === dateKey);
  const summaryId = `${mantraId}_${dateKey}`;
  if (daySessions.length === 0) {
    await DB.delete('dailySummaries', summaryId);
    return;
  }
  const totalCount = daySessions.reduce((sum, s) => sum + s.count, 0);
  const totalDuration = daySessions.reduce((sum, s) => sum + Math.max(0, s.endTime - s.startTime), 0);
  await DB.put('dailySummaries', { id: summaryId, mantraId, date: dateKey, totalCount, totalDuration });
}

// Session 結束時呼叫：寫入 session、重算當日彙總，並（若已登入）推上雲端同步
async function commitSession(mantraId, count, startTime, endTime, source) {
  if (count <= 0) return;
  const session = {
    id: uuid(),
    mantraId,
    startTime,
    endTime,
    count,
    source, // 'auto' | 'manual'
    deviceId: getDeviceId(),
    createdAt: Date.now()
  };
  await DB.put('sessions', session);
  await recomputeDailySummary(mantraId, todayStr(new Date(startTime)));
  if (typeof syncPushSession === 'function') syncPushSession(session);
  return session;
}

function getDeviceId() {
  let id = localStorage.getItem('chant_device_id');
  if (!id) {
    id = uuid();
    localStorage.setItem('chant_device_id', id);
  }
  return id;
}
