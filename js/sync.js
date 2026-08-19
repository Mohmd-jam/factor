/* =========================================================================
 * فاکتورینو — همگام‌سازی دوطرفه با سرور
 *
 * جریان کار:
 *   1) push  → رکوردهای محلیِ تغییرکرده (dirty) به سرور فرستاده می‌شوند.
 *   2) pull  → تغییرات سرور بعد از آخرین همگام‌سازی دریافت و ادغام می‌شوند.
 *   3) نتیجه از طریق رویداد `factorino:sync` به رابط کاربری اطلاع داده می‌شود.
 *
 * وابستگی: js/auth.js (FactorinoAuth) و js/db.js (FactorinoDB)
 * ========================================================================= */
(function () {
  'use strict';

  var Auth = window.FactorinoAuth;
  var DB = window.FactorinoDB;
  if (!Auth || !DB) return;

  var META_LAST_SYNC = 'lastSyncAt';
  var META_SETTINGS = 'settings';
  var BATCH = 200; // حداکثر رکورد در هر درخواست push (سرور تا ۵۰۰ می‌پذیرد)
  var AUTO_INTERVAL = 3 * 60 * 1000; // هر ۳ دقیقه

  var state = {
    running: false,
    queued: false,
    online: navigator.onLine !== false,
    lastResult: null,
    lastError: null,
    timer: null,
  };

  // ------------------------------------------------------------------ رویداد
  function emit(type, detail) {
    try {
      window.dispatchEvent(new CustomEvent('factorino:' + type, { detail: detail || {} }));
    } catch (e) {
      /* مرورگرهای قدیمی */
    }
  }

  function status(kind, extra) {
    emit('sync', Object.assign({ status: kind, online: state.online }, extra || {}));
  }

  // ------------------------------------------------------- آماده‌سازی رکوردها
  /** رکورد محلی را به شکل مورد انتظار سرور در می‌آورد (بدون فیلدهای داخلی). */
  function cleanProduct(p) {
    return {
      uuid: p.uuid,
      name: p.name || '',
      sku: p.sku || '',
      category: p.category || '',
      unit: p.unit || 'عدد',
      price: Number(p.price) || 0,
      aliases: Array.isArray(p.aliases) ? p.aliases : String(p.aliases || '').split(',').filter(Boolean),
      isActive: p.isActive === undefined ? true : !!p.isActive,
      createdAt: p.createdAt || null,
      updatedAt: p.updatedAt || null,
      deleted: !!p.deleted,
    };
  }

  function cleanCustomer(c) {
    return {
      uuid: c.uuid,
      name: c.name || '',
      phone: c.phone || '',
      taxId: c.taxId || '',
      city: c.city || '',
      postalCode: c.postalCode || '',
      address: c.address || '',
      note: c.note || '',
      createdAt: c.createdAt || null,
      updatedAt: c.updatedAt || null,
      deleted: !!c.deleted,
    };
  }

  function cleanInvoice(i) {
    return {
      uuid: i.uuid,
      number: i.number || '',
      customerUuid: i.customerUuid || '',
      customerName: i.customerName || '',
      place: i.place || '',
      issueDate: i.issueDate || '',
      status: i.status === 'draft' ? 'draft' : 'final',
      paymentStatus: ['unpaid', 'partial', 'paid'].indexOf(i.paymentStatus) >= 0 ? i.paymentStatus : 'unpaid',
      discount: Number(i.discount) || 0,
      taxPercent: Number(i.taxPercent) || 0,
      shipping: Number(i.shipping) || 0,
      notes: i.notes || '',
      items: (Array.isArray(i.items) ? i.items : []).slice(0, 200).map(function (it) {
        return {
          productUuid: it.productUuid || '',
          name: it.name || '',
          unit: it.unit || 'عدد',
          unitPrice: Number(it.unitPrice) || 0,
          qty: Number(it.qty) || 0,
          discount: Number(it.discount) || 0,
        };
      }),
      createdAt: i.createdAt || null,
      updatedAt: i.updatedAt || null,
      deleted: !!i.deleted,
    };
  }

  // ---------------------------------------------------------------- ارسال
  function pushOnce() {
    return Promise.all([
      DB.dirtyRecords('products'),
      DB.dirtyRecords('customers'),
      DB.dirtyRecords('invoices'),
    ]).then(function (sets) {
      var products = sets[0];
      var customers = sets[1];
      var invoices = sets[2];
      var total = products.length + customers.length + invoices.length;
      if (!total) return { pushed: 0, batches: 0 };

      // تقسیم به دسته‌های کوچک تا از سقف سرور عبور نکنیم
      var batches = [];
      var buffer = { products: [], customers: [], invoices: [] };
      var count = 0;

      function flush() {
        if (count > 0) {
          batches.push(buffer);
          buffer = { products: [], customers: [], invoices: [] };
          count = 0;
        }
      }

      products.forEach(function (p) {
        buffer.products.push(cleanProduct(p));
        if (++count >= BATCH) flush();
      });
      customers.forEach(function (c) {
        buffer.customers.push(cleanCustomer(c));
        if (++count >= BATCH) flush();
      });
      invoices.forEach(function (i) {
        buffer.invoices.push(cleanInvoice(i));
        if (++count >= BATCH) flush();
      });
      flush();

      var pushed = 0;
      var conflicts = [];
      var skipped = [];

      // دسته‌ها پشت سر هم ارسال می‌شوند تا ترتیب حفظ شود
      var chain = Promise.resolve();
      batches.forEach(function (batch) {
        chain = chain.then(function () {
          return Auth.request('sync.php?action=push', { method: 'POST', body: batch }).then(function (data) {
            pushed += (data.products || 0) + (data.customers || 0) + (data.invoices || 0);
            if (data.conflicts && data.conflicts.length) conflicts = conflicts.concat(data.conflicts);
            if (data.skipped && data.skipped.length) skipped = skipped.concat(data.skipped);

            // رکوردهای پذیرفته‌شده دیگر dirty نیستند
            var conflicted = {};
            (data.conflicts || []).concat(data.skipped || []).forEach(function (c) {
              if (c && c.uuid) conflicted[c.uuid] = true;
            });
            var accepted = function (rows) {
              return rows
                .map(function (r) {
                  return r.uuid;
                })
                .filter(function (u) {
                  return !conflicted[u];
                });
            };
            return Promise.all([
              DB.markClean('products', accepted(batch.products)),
              DB.markClean('customers', accepted(batch.customers)),
              DB.markClean('invoices', accepted(batch.invoices)),
            ]);
          });
        });
      });

      return chain.then(function () {
        return { pushed: pushed, batches: batches.length, conflicts: conflicts, skipped: skipped };
      });
    });
  }

  // --------------------------------------------------------------- دریافت
  function pullOnce(fullResync) {
    var sincePromise = fullResync
      ? Promise.resolve('1970-01-01 00:00:00')
      : DB.metaGet(META_LAST_SYNC, '1970-01-01 00:00:00');

    return sincePromise.then(function (since) {
      var url = 'sync.php?action=pull&since=' + encodeURIComponent(since || '1970-01-01 00:00:00');
      return Auth.request(url).then(function (data) {
        var jobs = [
          DB.mergeFromServer('products', data.products || []),
          DB.mergeFromServer('customers', data.customers || []),
          DB.mergeFromServer('invoices', data.invoices || []),
        ];

        if (data.settings) {
          jobs.push(DB.metaSet(META_SETTINGS, data.settings));
        }

        return Promise.all(jobs).then(function (counts) {
          return DB.metaSet(META_LAST_SYNC, data.serverTime || DB.nowIso()).then(function () {
            return {
              products: counts[0] || 0,
              customers: counts[1] || 0,
              invoices: counts[2] || 0,
              settings: !!data.settings,
              serverTime: data.serverTime,
            };
          });
        });
      });
    });
  }

  // ----------------------------------------------------------- اجرای کامل
  /**
   * یک چرخه کامل همگام‌سازی.
   * @param {{full?:boolean, silent?:boolean}} [options]
   */
  function syncNow(options) {
    var opts = options || {};

    if (!Auth.isLoggedIn()) {
      return Promise.resolve({ ok: false, reason: 'guest' });
    }
    if (!state.online) {
      status('offline');
      return Promise.resolve({ ok: false, reason: 'offline' });
    }
    if (state.running) {
      state.queued = true;
      return Promise.resolve({ ok: false, reason: 'busy' });
    }

    state.running = true;
    if (!opts.silent) status('start');

    return pushOnce()
      .then(function (pushResult) {
        return pullOnce(!!opts.full).then(function (pullResult) {
          return { ok: true, push: pushResult, pull: pullResult };
        });
      })
      .then(function (result) {
        state.lastResult = result;
        state.lastError = null;
        DB.metaSet('lastSyncLocal', new Date().toISOString());
        status('done', result);
        emit('data-changed', { source: 'sync' });
        return result;
      })
      .catch(function (err) {
        state.lastError = err;
        // خطای احراز هویت را auth.js خودش مدیریت می‌کند (خروج + هدایت)
        var message = Auth.friendlyError ? Auth.friendlyError(err) : err && err.message;
        status('error', { message: message, status: err && err.status });
        return { ok: false, reason: 'error', error: err, message: message };
      })
      .then(function (result) {
        state.running = false;
        if (state.queued) {
          state.queued = false;
          setTimeout(function () {
            syncNow({ silent: true });
          }, 800);
        }
        return result;
      });
  }

  /** همگام‌سازی کامل: همه چیز از ابتدا از سرور خوانده می‌شود. */
  function fullResync() {
    return syncNow({ full: true });
  }

  // ------------------------------------------------------------ حذف رکورد
  /** حذف نرم محلی + اطلاع به سرور در اولین فرصت. */
  function deleteRecord(type, uuid) {
    var store = type === 'product' ? 'products' : type === 'customer' ? 'customers' : 'invoices';
    return DB.softDelete(store, uuid).then(function () {
      emit('data-changed', { source: 'delete', type: type, uuid: uuid });
      if (state.online && Auth.isLoggedIn()) {
        return Auth.request('sync.php?action=delete', {
          method: 'POST',
          body: { type: type, uuid: uuid },
        })
          .then(function () {
            return DB.markClean(store, [uuid]);
          })
          .catch(function () {
            /* بعداً با push دوباره تلاش می‌شود */
          });
      }
      return null;
    });
  }

  // ---------------------------------------------------------- تنظیمات کاربر
  function loadSettings() {
    return DB.metaGet(META_SETTINGS, null);
  }

  function saveSettings(settings) {
    // ذخیره محلی فوری تا رابط کاربری منتظر شبکه نماند
    return DB.metaSet(META_SETTINGS, settings).then(function () {
      if (!state.online || !Auth.isLoggedIn()) {
        return { ok: false, offline: true, settings: settings };
      }
      return Auth.request('settings.php?action=save', { method: 'POST', body: settings })
        .then(function (data) {
          var fresh = data.settings || settings;
          return DB.metaSet(META_SETTINGS, fresh).then(function () {
            return { ok: true, settings: fresh };
          });
        });
    });
  }

  function uploadLogo(dataUrl) {
    return Auth.request('settings.php?action=logo', { method: 'POST', body: { logo: dataUrl } });
  }

  function fetchSettings() {
    return Auth.request('settings.php?action=get').then(function (data) {
      if (data.settings) DB.metaSet(META_SETTINGS, data.settings);
      return data;
    });
  }

  // ------------------------------------------------------------- آمار سرور
  function stats(kind, params) {
    var query = 'stats.php?action=' + encodeURIComponent(kind || 'dashboard');
    if (params) {
      Object.keys(params).forEach(function (k) {
        if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
          query += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }
      });
    }
    return Auth.request(query);
  }

  // ------------------------------------------------------- زمان‌بندی خودکار
  function startAuto() {
    stopAuto();
    state.timer = window.setInterval(function () {
      if (state.online && !document.hidden) syncNow({ silent: true });
    }, AUTO_INTERVAL);
  }

  function stopAuto() {
    if (state.timer) {
      window.clearInterval(state.timer);
      state.timer = null;
    }
  }

  window.addEventListener('online', function () {
    state.online = true;
    status('online');
    syncNow({ silent: true });
  });

  window.addEventListener('offline', function () {
    state.online = false;
    status('offline');
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.online) {
      DB.metaGet('lastSyncLocal', null).then(function (last) {
        var age = last ? Date.now() - Date.parse(last) : Infinity;
        if (age > 60 * 1000) syncNow({ silent: true });
      });
    }
  });

  // پیش از بستن صفحه، تغییرات معلق را با sendBeacon نمی‌فرستیم (نیاز به CSRF دارد)
  // اما تلاش می‌کنیم یک push سریع انجام دهیم.
  window.addEventListener('pagehide', function () {
    if (state.online && Auth.isLoggedIn() && !state.running) {
      pushOnce().catch(function () {});
    }
  });

  window.FactorinoSync = {
    syncNow: syncNow,
    fullResync: fullResync,
    push: pushOnce,
    pull: pullOnce,
    deleteRecord: deleteRecord,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    fetchSettings: fetchSettings,
    uploadLogo: uploadLogo,
    stats: stats,
    startAuto: startAuto,
    stopAuto: stopAuto,
    isOnline: function () {
      return state.online;
    },
    isRunning: function () {
      return state.running;
    },
    lastError: function () {
      return state.lastError;
    },
  };
})();
