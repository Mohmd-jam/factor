/* =========================================================================
 * فاکتورینو — لایه ذخیره‌سازی آفلاین (IndexedDB)
 *
 * تمام داده‌ها ابتدا روی همین دستگاه ذخیره می‌شوند و سپس با سرور
 * همگام‌سازی می‌شوند (js/sync.js). اگر IndexedDB در دسترس نباشد،
 * به‌صورت خودکار روی localStorage جایگزین می‌شود.
 * ========================================================================= */
(function () {
  'use strict';

  var DB_NAME = 'factorino';
  var DB_VERSION = 3;
  var STORES = ['products', 'customers', 'invoices', 'meta'];

  var dbPromise = null;
  var useFallback = false;

  // ------------------------------------------------------------------ ابزار
  function nowIso() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    var buf = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(buf);
    } else {
      for (var i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
    }
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    var hex = [];
    for (var j = 0; j < 16; j++) hex.push((buf[j] + 0x100).toString(16).slice(1));
    return (
      hex.slice(0, 4).join('') + '-' + hex.slice(4, 6).join('') + '-' +
      hex.slice(6, 8).join('') + '-' + hex.slice(8, 10).join('') + '-' +
      hex.slice(10, 16).join('')
    );
  }

  // ------------------------------------------------------- نسخه جایگزین (LS)
  var LS_PREFIX = 'factorino_ls_';

  var fallback = {
    read: function (store) {
      try {
        return JSON.parse(window.localStorage.getItem(LS_PREFIX + store) || '{}');
      } catch (e) {
        return {};
      }
    },
    write: function (store, map) {
      try {
        window.localStorage.setItem(LS_PREFIX + store, JSON.stringify(map));
      } catch (e) {
        /* فضای ذخیره‌سازی پر است */
      }
    },
  };

  // --------------------------------------------------------------- باز کردن
  function open() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        useFallback = true;
        resolve(null);
        return;
      }

      var req;
      try {
        req = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        useFallback = true;
        resolve(null);
        return;
      }

      req.onupgradeneeded = function (ev) {
        var db = req.result;
        STORES.forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            var keyPath = name === 'meta' ? 'key' : 'uuid';
            var store = db.createObjectStore(name, { keyPath: keyPath });
            if (name !== 'meta') {
              store.createIndex('updatedAt', 'updatedAt', { unique: false });
              store.createIndex('dirty', 'dirty', { unique: false });
            }
            if (name === 'invoices') {
              store.createIndex('issueDate', 'issueDate', { unique: false });
              store.createIndex('number', 'number', { unique: false });
            }
          }
        });
        // ایندکس‌های احتمالاً جاافتاده در نسخه‌های قدیمی
        if (ev.oldVersion > 0 && req.transaction) {
          ['products', 'customers', 'invoices'].forEach(function (name) {
            if (!db.objectStoreNames.contains(name)) return;
            var st = req.transaction.objectStore(name);
            if (!st.indexNames.contains('dirty')) st.createIndex('dirty', 'dirty', { unique: false });
            if (!st.indexNames.contains('updatedAt')) st.createIndex('updatedAt', 'updatedAt', { unique: false });
          });
        }
      };

      req.onsuccess = function () {
        var db = req.result;
        db.onversionchange = function () {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      req.onerror = function () {
        console.warn('[factorino] IndexedDB در دسترس نیست؛ از localStorage استفاده می‌شود.', req.error);
        useFallback = true;
        resolve(null);
      };

      req.onblocked = function () {
        console.warn('[factorino] بازکردن پایگاه داده مسدود شد (تب دیگری باز است).');
      };
    });

    return dbPromise;
  }

  function tx(store, mode) {
    return open().then(function (db) {
      if (!db) return null;
      return db.transaction(store, mode).objectStore(store);
    });
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  // ------------------------------------------------------------ عملیات پایه
  function getAll(store) {
    return tx(store, 'readonly').then(function (os) {
      if (!os) {
        var map = fallback.read(store);
        return Object.keys(map).map(function (k) {
          return map[k];
        });
      }
      return wrap(os.getAll());
    });
  }

  function get(store, key) {
    return tx(store, 'readonly').then(function (os) {
      if (!os) return fallback.read(store)[key] || null;
      return wrap(os.get(key)).then(function (v) {
        return v || null;
      });
    });
  }

  function put(store, record) {
    return tx(store, 'readwrite').then(function (os) {
      if (!os) {
        var map = fallback.read(store);
        map[record[store === 'meta' ? 'key' : 'uuid']] = record;
        fallback.write(store, map);
        return record;
      }
      return wrap(os.put(record)).then(function () {
        return record;
      });
    });
  }

  function bulkPut(store, records) {
    if (!records || !records.length) return Promise.resolve(0);
    return open().then(function (db) {
      if (!db) {
        var map = fallback.read(store);
        records.forEach(function (r) {
          map[r[store === 'meta' ? 'key' : 'uuid']] = r;
        });
        fallback.write(store, map);
        return records.length;
      }
      return new Promise(function (resolve, reject) {
        var t = db.transaction(store, 'readwrite');
        var os = t.objectStore(store);
        records.forEach(function (r) {
          os.put(r);
        });
        t.oncomplete = function () {
          resolve(records.length);
        };
        t.onerror = function () {
          reject(t.error);
        };
        t.onabort = function () {
          reject(t.error);
        };
      });
    });
  }

  function remove(store, key) {
    return tx(store, 'readwrite').then(function (os) {
      if (!os) {
        var map = fallback.read(store);
        delete map[key];
        fallback.write(store, map);
        return true;
      }
      return wrap(os.delete(key)).then(function () {
        return true;
      });
    });
  }

  function clearStore(store) {
    return tx(store, 'readwrite').then(function (os) {
      if (!os) {
        fallback.write(store, {});
        return true;
      }
      return wrap(os.clear()).then(function () {
        return true;
      });
    });
  }

  // -------------------------------------------------------------- متادیتا
  function metaGet(key, fallbackValue) {
    return get('meta', key).then(function (row) {
      return row && row.value !== undefined ? row.value : fallbackValue;
    });
  }

  function metaSet(key, value) {
    return put('meta', { key: key, value: value });
  }

  // -------------------------------------------------------- عملیات دامنه‌ای
  /** رکورد را با مهر زمان و پرچم «نیازمند ارسال» ذخیره می‌کند. */
  function save(store, record, options) {
    var opts = options || {};
    var rec = Object.assign({}, record);
    if (!rec.uuid) rec.uuid = uuid();
    if (!rec.createdAt) rec.createdAt = nowIso();
    rec.updatedAt = opts.keepUpdatedAt && rec.updatedAt ? rec.updatedAt : nowIso();
    rec.deleted = !!rec.deleted;
    rec.dirty = opts.dirty === false ? 0 : 1;
    return put(store, rec).then(function () {
      return rec;
    });
  }

  /** حذف نرم: رکورد نگه داشته می‌شود تا حذف با سرور همگام شود. */
  function softDelete(store, key) {
    return get(store, key).then(function (rec) {
      if (!rec) return null;
      rec.deleted = true;
      rec.updatedAt = nowIso();
      rec.dirty = 1;
      return put(store, rec);
    });
  }

  /** فقط رکوردهای زنده (حذف‌نشده). */
  function list(store) {
    return getAll(store).then(function (rows) {
      return rows.filter(function (r) {
        return !r.deleted;
      });
    });
  }

  /** رکوردهایی که هنوز به سرور ارسال نشده‌اند. */
  function dirtyRecords(store) {
    return getAll(store).then(function (rows) {
      return rows.filter(function (r) {
        return r.dirty;
      });
    });
  }

  /** پس از ارسال موفق، پرچم dirty پاک می‌شود. */
  function markClean(store, uuids) {
    if (!uuids || !uuids.length) return Promise.resolve(0);
    return getAll(store).then(function (rows) {
      var set = {};
      uuids.forEach(function (u) {
        set[u] = true;
      });
      var changed = rows.filter(function (r) {
        return set[r.uuid] && r.dirty;
      });
      changed.forEach(function (r) {
        r.dirty = 0;
      });
      return bulkPut(store, changed);
    });
  }

  /**
   * ادغام رکوردهای سرور با نسخه محلی.
   * قانون: آخرین به‌روزرسانی برنده است؛ رکورد محلیِ ارسال‌نشده دست‌نخورده می‌ماند.
   */
  function mergeFromServer(store, serverRows) {
    if (!serverRows || !serverRows.length) return Promise.resolve(0);
    return getAll(store).then(function (localRows) {
      var byUuid = {};
      localRows.forEach(function (r) {
        byUuid[r.uuid] = r;
      });

      var toWrite = [];
      serverRows.forEach(function (remote) {
        var local = byUuid[remote.uuid];
        var incoming = Object.assign({}, remote, { dirty: 0 });
        if (!local) {
          toWrite.push(incoming);
          return;
        }
        if (local.dirty) {
          // تغییر محلیِ ارسال‌نشده اولویت دارد مگر سرور جدیدتر باشد
          if (Date.parse(remote.updatedAt || 0) > Date.parse(local.updatedAt || 0)) {
            toWrite.push(incoming);
          }
          return;
        }
        if (Date.parse(remote.updatedAt || 0) >= Date.parse(local.updatedAt || 0)) {
          toWrite.push(incoming);
        }
      });

      return bulkPut(store, toWrite);
    });
  }

  /** پاک‌کردن کامل داده‌های این دستگاه. */
  function clearAll() {
    return Promise.all(STORES.map(clearStore)).then(function () {
      try {
        Object.keys(window.localStorage).forEach(function (k) {
          if (k.indexOf(LS_PREFIX) === 0 || k === 'factorino_draft') {
            window.localStorage.removeItem(k);
          }
        });
      } catch (e) {}
      return true;
    });
  }

  /** برآورد فضای مصرف‌شده (برای صفحه تنظیمات). */
  function estimate() {
    if (navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate().catch(function () {
        return null;
      });
    }
    return Promise.resolve(null);
  }

  /** درخواست ذخیره‌سازی پایدار تا مرورگر داده‌ها را پاک نکند. */
  function persist() {
    if (navigator.storage && navigator.storage.persist) {
      return navigator.storage.persist().catch(function () {
        return false;
      });
    }
    return Promise.resolve(false);
  }

  // ---------------------------------------------------------------- خروجی
  window.FactorinoDB = {
    open: open,
    uuid: uuid,
    nowIso: nowIso,

    getAll: getAll,
    get: get,
    put: put,
    bulkPut: bulkPut,
    remove: remove,
    clearStore: clearStore,

    list: list,
    save: save,
    softDelete: softDelete,
    dirtyRecords: dirtyRecords,
    markClean: markClean,
    mergeFromServer: mergeFromServer,

    metaGet: metaGet,
    metaSet: metaSet,

    clearAll: clearAll,
    estimate: estimate,
    persist: persist,

    usingFallback: function () {
      return useFallback;
    },
  };
})();
