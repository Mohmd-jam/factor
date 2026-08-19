/* =========================================================================
 * فاکتورینو — کنترلر اصلی برنامه
 *
 * بخش‌ها:
 *   ابزارها → تاریخ شمسی → وضعیت → مسیریابی → تنظیمات → محصولات →
 *   مشتری‌ها → ویرایشگر فاکتور → فهرست فاکتورها → گزارش‌ها → نمودار →
 *   پشتیبان رمزنگاری‌شده → دستیار صوتی → PWA
 * ========================================================================= */
(function () {
  'use strict';

  var Auth = window.FactorinoAuth;
  var DB = window.FactorinoDB;
  var Sync = window.FactorinoSync;
  var Voice = window.FactorinoVoice;

  // =======================================================================
  // ابزارهای عمومی
  // =======================================================================

  function $(id) {
    return document.getElementById(id);
  }

  function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  function on(el, type, handler, options) {
    if (el) el.addEventListener(type, handler, options);
  }

  var FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

  /** ارقام لاتین → فارسی (برای نمایش). */
  function fa(value) {
    return String(value == null ? '' : value).replace(/\d/g, function (d) {
      return FA_DIGITS[+d];
    });
  }

  /** ارقام فارسی/عربی → لاتین (برای ورودی‌ها). */
  function latin(value) {
    return String(value == null ? '' : value).replace(/[۰-۹٠-٩]/g, function (ch) {
      var p = '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch);
      return String(p >= 0 ? p : '٠١٢٣٤٥٦٧٨٩'.indexOf(ch));
    });
  }

  function num(value, fallback) {
    var n = parseFloat(latin(String(value == null ? '' : value)).replace(/[,\s]/g, ''));
    return isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }

  /** عدد با جداکننده هزارگان و ارقام فارسی. */
  function money(value) {
    var n = Math.round((num(value) + Number.EPSILON) * 100) / 100;
    var neg = n < 0;
    n = Math.abs(n);
    var intPart = Math.floor(n);
    var frac = Math.round((n - intPart) * 100);
    var s = String(intPart).replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
    if (frac > 0) s += '/' + (frac < 10 ? '0' + frac : frac);
    return (neg ? '−' : '') + fa(s);
  }

  /** تعداد: عددهای صحیح بدون اعشار، کسری‌ها با حداکثر ۲ رقم. */
  function qtyText(value) {
    var n = num(value);
    if (Math.abs(n - Math.round(n)) < 0.0001) return fa(Math.round(n));
    return fa(String(Math.round(n * 100) / 100).replace('.', '/'));
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        fn.apply(self, args);
      }, wait || 250);
    };
  }

  function todayIso() {
    var d = new Date();
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  }

  function nowStamp() {
    return new Date().toISOString().slice(0, 19).replace('T', ' ');
  }

  // ------------------------------------------------------------ تاریخ شمسی
  var JALALI_MONTHS = [
    'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
  ];
  var WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

  /** تبدیل میلادی به هجری شمسی (الگوریتم استاندارد بورکِرت–دِرشوویتس). */
  function toJalali(gy, gm, gd) {
    var g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    var jy = gy <= 1600 ? 0 : 979;
    gy -= gy <= 1600 ? 621 : 1600;
    var gy2 = gm > 2 ? gy + 1 : gy;
    var days =
      365 * gy +
      Math.floor((gy2 + 3) / 4) -
      Math.floor((gy2 + 99) / 100) +
      Math.floor((gy2 + 399) / 400) -
      80 +
      gd +
      g_d_m[gm - 1];
    jy += 33 * Math.floor(days / 12053);
    days %= 12053;
    jy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
      jy += Math.floor((days - 1) / 365);
      days = (days - 1) % 365;
    }
    var jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
    var jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
    return [jy, jm, jd];
  }

  /** تاریخ ISO (YYYY-MM-DD) → متن شمسی خوانا. */
  function jalaliText(iso, withWeekday) {
    if (!iso) return '—';
    var parts = String(iso).slice(0, 10).split('-');
    if (parts.length !== 3) return fa(iso);
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    if (isNaN(d.getTime())) return fa(iso);
    var j = toJalali(+parts[0], +parts[1], +parts[2]);
    var text = fa(j[2]) + ' ' + JALALI_MONTHS[j[1] - 1] + ' ' + fa(j[0]);
    if (withWeekday) text = WEEKDAYS[d.getDay()] + '، ' + text;
    return text;
  }

  /** تاریخ کوتاه شمسی: ۱۴۰۳/۰۵/۲۷ */
  function jalaliShort(iso) {
    if (!iso) return '—';
    var parts = String(iso).slice(0, 10).split('-');
    if (parts.length !== 3) return fa(iso);
    var j = toJalali(+parts[0], +parts[1], +parts[2]);
    return fa(j[0] + '/' + String(j[1]).padStart(2, '0') + '/' + String(j[2]).padStart(2, '0'));
  }

  // -------------------------------------------------------------- اعلان‌ها
  function toast(message, type, timeout) {
    var box = $('toastContainer');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<svg><use href="#i-' +
      (type === 'error' ? 'alert' : type === 'success' ? 'check' : 'info') +
      '"></use></svg><span>' +
      escapeHtml(message) +
      '</span>';
    box.appendChild(el);
    window.setTimeout(function () {
      el.classList.add('leaving');
      window.setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 320);
    }, timeout || 3600);
  }

  /** دیالوگ تأیید — Promise<boolean> */
  function confirmDialog(options) {
    var dialog = $('confirmDialog');
    var opts = options || {};
    if (!dialog || typeof dialog.showModal !== 'function') {
      return Promise.resolve(window.confirm(opts.text || 'آیا مطمئن هستید؟'));
    }
    $('confirmTitle').textContent = opts.title || 'آیا مطمئن هستید؟';
    $('confirmText').textContent = opts.text || '';
    var btn = $('confirmActionBtn');
    btn.textContent = opts.action || 'حذف';
    btn.className = 'btn ' + (opts.danger === false ? 'btn-primary' : 'btn-danger');

    return new Promise(function (resolve) {
      function done() {
        dialog.removeEventListener('close', done);
        resolve(dialog.returnValue === 'confirm');
      }
      dialog.addEventListener('close', done);
      dialog.returnValue = '';
      dialog.showModal();
    });
  }

  function openDialog(id) {
    var d = $(id);
    if (!d) return;
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }

  function closeDialog(id) {
    var d = $(id);
    if (!d) return;
    if (typeof d.close === 'function') d.close();
    else d.removeAttribute('open');
  }

  // =======================================================================
  // وضعیت برنامه
  // =======================================================================

  var DEFAULT_SETTINGS = {
    businessName: '',
    ownerName: '',
    phone: '',
    taxId: '',
    email: '',
    address: '',
    logo: '',
    invoicePrefix: 'INV-',
    nextInvoiceNumber: 1,
    currency: 'تومان',
    taxPercent: 0,
    invoiceFooter: '',
    voiceEnabled: true,
  };

  var state = {
    products: [],
    customers: [],
    invoices: [],
    settings: Object.assign({}, DEFAULT_SETTINGS),
    draft: null,
    editingInvoiceUuid: null,
    route: 'dashboard',
    filters: { product: '', customer: '', invoice: '', invoiceStatus: 'all' },
    report: null,
    deferredPrompt: null,
    ready: false,
  };

  var DRAFT_KEY = 'factorino_draft';

  function currency() {
    return state.settings.currency || 'تومان';
  }

  function findProduct(uuid) {
    for (var i = 0; i < state.products.length; i++) {
      if (state.products[i].uuid === uuid) return state.products[i];
    }
    return null;
  }

  function findCustomer(uuid) {
    for (var i = 0; i < state.customers.length; i++) {
      if (state.customers[i].uuid === uuid) return state.customers[i];
    }
    return null;
  }

  function findInvoice(uuid) {
    for (var i = 0; i < state.invoices.length; i++) {
      if (state.invoices[i].uuid === uuid) return state.invoices[i];
    }
    return null;
  }

  // =======================================================================
  // بارگذاری داده‌ها
  // =======================================================================

  function loadAll() {
    return Promise.all([
      DB.list('products'),
      DB.list('customers'),
      DB.list('invoices'),
      DB.metaGet('settings', null),
    ]).then(function (res) {
      state.products = (res[0] || []).sort(function (a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), 'fa');
      });
      state.customers = (res[1] || []).sort(function (a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), 'fa');
      });
      state.invoices = (res[2] || []).sort(function (a, b) {
        var d = String(b.issueDate || '').localeCompare(String(a.issueDate || ''));
        if (d !== 0) return d;
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      });
      state.settings = Object.assign({}, DEFAULT_SETTINGS, res[3] || {});
      return state;
    });
  }

  function renderAll() {
    applySettingsToUi();
    renderDashboard();
    renderProducts();
    renderCustomers();
    renderInvoices();
    refreshCustomerSelect();
    refreshProductDatalist();
    renderInvoiceLines();
    if (state.route === 'reports') runReport();
  }

  // =======================================================================
  // مسیریابی
  // =======================================================================

  var ROUTE_TITLES = {
    dashboard: 'پیشخوان',
    'new-invoice': 'فاکتور جدید',
    products: 'محصولات',
    customers: 'مشتری‌ها',
    invoices: 'فاکتورها',
    reports: 'گزارش‌ها',
    settings: 'تنظیمات و پشتیبان',
  };

  function currentRoute() {
    var hash = (window.location.hash || '').replace('#', '').trim();
    return ROUTE_TITLES[hash] ? hash : 'dashboard';
  }

  function navigate(route, options) {
    if (!ROUTE_TITLES[route]) route = 'dashboard';
    state.route = route;

    qsa('.view').forEach(function (view) {
      view.classList.toggle('active', view.getAttribute('data-view') === route);
    });
    qsa('[data-route]').forEach(function (link) {
      link.classList.toggle('active', link.getAttribute('data-route') === route);
    });

    var title = $('pageTitle');
    if (title) title.textContent = ROUTE_TITLES[route];

    if (window.location.hash !== '#' + route) {
      if (options && options.replace) window.history.replaceState(null, '', '#' + route);
      else window.location.hash = route;
    }

    window.scrollTo({ top: 0, behavior: 'auto' });

    if (route === 'dashboard') renderDashboard();
    if (route === 'reports' && !state.report) runReport();
    if (route === 'new-invoice') {
      refreshCustomerSelect();
      refreshProductDatalist();
      renderInvoiceLines();
    }
  }

  function initRouting() {
    window.addEventListener('hashchange', function () {
      navigate(currentRoute(), { replace: true });
    });

    document.addEventListener('click', function (ev) {
      var routeBtn = ev.target.closest('[data-route-button]');
      if (routeBtn) {
        ev.preventDefault();
        navigate(routeBtn.getAttribute('data-route-button'));
        return;
      }
      var closer = ev.target.closest('[data-close-dialog]');
      if (closer) {
        ev.preventDefault();
        closeDialog(closer.getAttribute('data-close-dialog'));
      }
    });

    // میان‌بر صفحه‌کلید: + برای فاکتور جدید
    document.addEventListener('keydown', function (ev) {
      var tag = (ev.target && ev.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (ev.key === '+' || ev.key === '=') {
        ev.preventDefault();
        navigate('new-invoice');
      }
      if (ev.key === 'Escape') {
        qsa('dialog[open]').forEach(function (d) {
          if (typeof d.close === 'function') d.close();
        });
      }
    });
  }

  // =======================================================================
  // تنظیمات
  // =======================================================================

  function applySettingsToUi() {
    var s = state.settings;

    var name = s.businessName || 'کسب‌وکار من';
    var header = $('headerBusinessName');
    if (header) header.textContent = name;
    var avatar = $('avatarInitial');
    if (avatar) avatar.textContent = (name.trim()[0] || 'ف');

    var today = $('todayLabel');
    if (today) today.textContent = jalaliText(todayIso(), true);

    ['summaryCurrency1', 'summaryCurrency2', 'summaryCurrency3'].forEach(function (id) {
      var el = $(id);
      if (el) el.textContent = currency();
    });
    qsa('.currency-label').forEach(function (el) {
      el.textContent = currency();
    });

    setValue('settingBusinessName', s.businessName);
    setValue('settingOwner', s.ownerName);
    setValue('settingPhone', s.phone);
    setValue('settingTaxId', s.taxId);
    setValue('settingEmail', s.email);
    setValue('settingAddress', s.address);
    setValue('settingPrefix', s.invoicePrefix);
    setValue('settingNextNumber', s.nextInvoiceNumber);
    setValue('settingCurrency', s.currency);
    setValue('settingTax', s.taxPercent);
    setValue('settingFooter', s.invoiceFooter);

    renderLogoPreview();

    var banner = $('setupBanner');
    if (banner) {
      banner.hidden = !!(s.businessName && state.products.length);
    }

    var editorNumber = $('editorInvoiceNumber');
    if (editorNumber && !state.editingInvoiceUuid) {
      editorNumber.textContent = fa(nextInvoiceNumber());
    }
  }

  function setValue(id, value) {
    var el = $(id);
    if (!el) return;
    if (document.activeElement === el) return; // در حال تایپ کاربر
    el.value = value === undefined || value === null ? '' : value;
  }

  function renderLogoPreview() {
    var img = $('logoPreview');
    var placeholder = $('logoPlaceholder');
    var removeBtn = $('removeLogoBtn');
    var has = !!state.settings.logo;
    if (img) {
      if (has) img.src = state.settings.logo;
      else img.removeAttribute('src');
      img.hidden = !has;
    }
    if (placeholder) placeholder.hidden = has;
    if (removeBtn) removeBtn.hidden = !has;
  }

  function nextInvoiceNumber() {
    var prefix = state.settings.invoicePrefix || '';
    var n = parseInt(state.settings.nextInvoiceNumber, 10);
    if (!isFinite(n) || n < 1) n = 1;
    return prefix + String(n).padStart(4, '0');
  }

  /**
   * بسته تنظیمات برای ارسال به سرور — از روی وضعیت برنامه، نه از روی فرم.
   * (هنگام ثبت فاکتور فرم هنوز شماره قدیمی را نشان می‌دهد.)
   */
  function settingsPayload() {
    var s = state.settings;
    return {
      businessName: s.businessName || '',
      ownerName: s.ownerName || '',
      phone: s.phone || '',
      taxId: s.taxId || '',
      email: s.email || '',
      address: s.address || '',
      invoicePrefix: s.invoicePrefix || '',
      nextInvoiceNumber: Math.max(1, parseInt(s.nextInvoiceNumber, 10) || 1),
      currency: s.currency || 'تومان',
      taxPercent: Math.min(100, Math.max(0, num(s.taxPercent))),
      invoiceFooter: s.invoiceFooter || '',
      logo: s.logo || '',
      voiceEnabled: s.voiceEnabled !== false,
    };
  }

  function collectSettingsForm() {
    return {
      businessName: ($('settingBusinessName') || {}).value || '',
      ownerName: ($('settingOwner') || {}).value || '',
      phone: latin(($('settingPhone') || {}).value || ''),
      taxId: latin(($('settingTaxId') || {}).value || ''),
      email: ($('settingEmail') || {}).value || '',
      address: ($('settingAddress') || {}).value || '',
      invoicePrefix: ($('settingPrefix') || {}).value || '',
      nextInvoiceNumber: Math.max(1, parseInt(latin(($('settingNextNumber') || {}).value || '1'), 10) || 1),
      currency: ($('settingCurrency') || {}).value || 'تومان',
      taxPercent: Math.min(100, Math.max(0, num(($('settingTax') || {}).value, 0))),
      invoiceFooter: ($('settingFooter') || {}).value || '',
      logo: state.settings.logo || '',
      voiceEnabled: state.settings.voiceEnabled !== false,
    };
  }

  function saveSettings(ev) {
    if (ev) ev.preventDefault();
    var payload = collectSettingsForm();

    if (!payload.businessName.trim()) {
      toast('نام کسب‌وکار را وارد کنید.', 'error');
      var f = $('settingBusinessName');
      if (f) f.focus();
      return Promise.resolve(false);
    }

    payload.updatedAt = nowStamp();
    state.settings = Object.assign({}, state.settings, payload);
    applySettingsToUi();

    return Sync.saveSettings(payload)
      .then(function (res) {
        if (res && res.settings) {
          state.settings = Object.assign({}, DEFAULT_SETTINGS, res.settings);
          applySettingsToUi();
        }
        toast(res && res.offline ? 'تنظیمات روی دستگاه ذخیره شد؛ با اتصال اینترنت همگام می‌شود.' : 'تنظیمات ذخیره شد.', 'success');
        return true;
      })
      .catch(function (err) {
        var msg = Auth.friendlyError ? Auth.friendlyError(err) : 'ذخیره تنظیمات ناموفق بود.';
        toast(msg, 'error');
        return false;
      });
  }

  function initSettings() {
    on($('settingsForm'), 'submit', saveSettings);

    on($('logoPickerBtn'), 'click', function () {
      var input = $('logoInput');
      if (input) input.click();
    });

    on($('logoInput'), 'change', function (ev) {
      var file = ev.target.files && ev.target.files[0];
      if (!file) return;
      if (file.size > 1024 * 1024) {
        toast('حجم لوگو باید کمتر از ۱ مگابایت باشد.', 'error');
        ev.target.value = '';
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var dataUrl = String(reader.result || '');
        state.settings.logo = dataUrl;
        renderLogoPreview();
        Sync.uploadLogo(dataUrl)
          .then(function () {
            toast('لوگو ذخیره شد.', 'success');
            return DB.metaSet('settings', state.settings);
          })
          .catch(function (err) {
            toast(Auth.friendlyError ? Auth.friendlyError(err) : 'ارسال لوگو ناموفق بود.', 'error');
          });
      };
      reader.readAsDataURL(file);
      ev.target.value = '';
    });

    on($('removeLogoBtn'), 'click', function () {
      state.settings.logo = '';
      renderLogoPreview();
      Sync.uploadLogo(null)
        .then(function () {
          toast('لوگو حذف شد.', 'success');
          return DB.metaSet('settings', state.settings);
        })
        .catch(function () {
          toast('حذف لوگو روی سرور انجام نشد.', 'error');
        });
    });

    on($('togglePassword'), 'click', function () {
      var input = $('backupPassword');
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    on($('clearAllBtn'), 'click', function () {
      confirmDialog({
        title: 'حذف کامل داده‌های این دستگاه',
        text: 'همه محصولات، مشتری‌ها و فاکتورهای ذخیره‌شده روی این دستگاه پاک می‌شوند. اگر با سرور همگام شده باشند، پس از ورود دوباره بازیابی می‌شوند.',
        action: 'بله، پاک کن',
      }).then(function (ok) {
        if (!ok) return;
        DB.clearAll().then(function () {
          state.products = [];
          state.customers = [];
          state.invoices = [];
          state.draft = null;
          try {
            window.localStorage.removeItem(DRAFT_KEY);
          } catch (e) {}
          renderAll();
          toast('اطلاعات این دستگاه پاک شد.', 'success');
        });
      });
    });

    on($('exportBackupBtn'), 'click', exportBackup);
    on($('importBackupInput'), 'change', importBackup);
  }

  // =======================================================================
  // محصولات
  // =======================================================================

  function renderProducts() {
    var body = $('productsBody');
    var empty = $('productsEmpty');
    if (!body) return;

    var term = Voice ? Voice.normalize(state.filters.product) : state.filters.product.trim();
    var rows = state.products.filter(function (p) {
      if (!term) return true;
      var hay = Voice
        ? Voice.normalize([p.name, p.sku, p.category, (p.aliases || []).join(' ')].join(' '))
        : [p.name, p.sku, p.category].join(' ');
      return hay.indexOf(term) >= 0;
    });

    body.innerHTML = rows
      .map(function (p) {
        var aliases = Array.isArray(p.aliases) ? p.aliases : String(p.aliases || '').split(',').filter(Boolean);
        return (
          '<tr>' +
          '<td data-label="محصول"><div class="cell-main"><strong>' + escapeHtml(p.name) + '</strong>' +
          (p.category ? '<small>' + escapeHtml(p.category) + '</small>' : '') + '</div></td>' +
          '<td data-label="کد" dir="ltr">' + (p.sku ? escapeHtml(p.sku) : '—') + '</td>' +
          '<td data-label="دسته‌بندی">' + (p.category ? escapeHtml(p.category) : '—') + '</td>' +
          '<td data-label="واحد">' + escapeHtml(p.unit || 'عدد') + '</td>' +
          '<td data-label="قیمت فروش"><b>' + money(p.price) + '</b> <small>' + escapeHtml(currency()) + '</small></td>' +
          '<td data-label="نام‌های صوتی">' +
          (aliases.length
            ? aliases.map(function (a) {
                return '<span class="chip">' + escapeHtml(a) + '</span>';
              }).join('')
            : '<span class="muted">—</span>') +
          '</td>' +
          '<td data-label="عملیات" class="row-actions">' +
          '<button class="icon-btn" data-edit-product="' + escapeHtml(p.uuid) + '" aria-label="ویرایش"><svg><use href="#i-edit"></use></svg></button>' +
          '<button class="icon-btn danger" data-delete-product="' + escapeHtml(p.uuid) + '" aria-label="حذف"><svg><use href="#i-trash"></use></svg></button>' +
          '</td></tr>'
        );
      })
      .join('');

    if (empty) empty.hidden = rows.length > 0;

    var total = state.products.length;
    var sum = state.products.reduce(function (acc, p) {
      return acc + num(p.price);
    }, 0);
    var withAliases = state.products.filter(function (p) {
      var a = Array.isArray(p.aliases) ? p.aliases : String(p.aliases || '').split(',').filter(Boolean);
      return a.length > 0;
    }).length;

    setText('productCount', fa(total));
    setText('productAverage', total ? money(sum / total) : '۰');
    setText('productVoiceCount', fa(withAliases));
  }

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function openProductDialog(uuid) {
    var p = uuid ? findProduct(uuid) : null;
    setText('productDialogTitle', p ? 'ویرایش محصول' : 'محصول جدید');
    $('productId').value = p ? p.uuid : '';
    $('productName').value = p ? p.name || '' : '';
    $('productPrice').value = p ? num(p.price) : '';
    $('productUnit').value = p ? p.unit || 'عدد' : 'عدد';
    $('productSku').value = p ? p.sku || '' : '';
    $('productCategory').value = p ? p.category || '' : '';
    $('productAliases').value = p
      ? (Array.isArray(p.aliases) ? p.aliases : String(p.aliases || '').split(',')).filter(Boolean).join('، ')
      : '';
    openDialog('productDialog');
    window.setTimeout(function () {
      $('productName').focus();
    }, 60);
  }

  function submitProduct(ev) {
    ev.preventDefault();
    var uuid = $('productId').value;
    var name = $('productName').value.trim();
    var price = num($('productPrice').value);

    if (!name) {
      toast('نام محصول الزامی است.', 'error');
      return;
    }
    if (price < 0) {
      toast('قیمت نمی‌تواند منفی باشد.', 'error');
      return;
    }

    var aliases = $('productAliases')
      .value.split(/[,،؛;]/)
      .map(function (a) {
        return a.trim();
      })
      .filter(Boolean);

    var existing = uuid ? findProduct(uuid) : null;
    var record = Object.assign({}, existing || {}, {
      uuid: uuid || DB.uuid(),
      name: name,
      price: price,
      unit: $('productUnit').value || 'عدد',
      sku: latin($('productSku').value.trim()),
      category: $('productCategory').value.trim(),
      aliases: aliases,
      isActive: true,
      deleted: false,
    });

    DB.save('products', record).then(function (saved) {
      if (existing) {
        state.products = state.products.map(function (p) {
          return p.uuid === saved.uuid ? saved : p;
        });
      } else {
        state.products.push(saved);
      }
      state.products.sort(function (a, b) {
        return String(a.name).localeCompare(String(b.name), 'fa');
      });
      closeDialog('productDialog');
      renderProducts();
      refreshProductDatalist();
      applySettingsToUi();
      toast(existing ? 'محصول به‌روزرسانی شد.' : 'محصول ثبت شد.', 'success');
      Sync.syncNow({ silent: true });
    });
  }

  function deleteProduct(uuid) {
    var p = findProduct(uuid);
    if (!p) return;
    confirmDialog({
      title: 'حذف محصول',
      text: '«' + p.name + '» حذف شود؟ فاکتورهای قبلی تغییری نمی‌کنند.',
    }).then(function (ok) {
      if (!ok) return;
      Sync.deleteRecord('product', uuid).then(function () {
        state.products = state.products.filter(function (x) {
          return x.uuid !== uuid;
        });
        renderProducts();
        refreshProductDatalist();
        toast('محصول حذف شد.', 'success');
      });
    });
  }

  function refreshProductDatalist() {
    var list = $('productOptions');
    if (!list) return;
    list.innerHTML = state.products
      .map(function (p) {
        return '<option value="' + escapeHtml(p.name) + '">' + money(p.price) + ' ' + escapeHtml(currency()) + '</option>';
      })
      .join('');
  }

  function initProducts() {
    on($('productForm'), 'submit', submitProduct);
    on(
      $('productSearch'),
      'input',
      debounce(function (ev) {
        state.filters.product = ev.target.value;
        renderProducts();
      }, 200)
    );

    document.addEventListener('click', function (ev) {
      var openBtn = ev.target.closest('[data-action="open-product"]');
      if (openBtn) {
        ev.preventDefault();
        openProductDialog(null);
        return;
      }
      var edit = ev.target.closest('[data-edit-product]');
      if (edit) {
        openProductDialog(edit.getAttribute('data-edit-product'));
        return;
      }
      var del = ev.target.closest('[data-delete-product]');
      if (del) deleteProduct(del.getAttribute('data-delete-product'));
    });
  }

  // =======================================================================
  // مشتری‌ها
  // =======================================================================

  function customerStats(uuid) {
    var count = 0;
    var total = 0;
    state.invoices.forEach(function (inv) {
      if (inv.customerUuid !== uuid || inv.status !== 'final') return;
      count++;
      total += num(inv.total);
    });
    return { count: count, total: total };
  }

  function renderCustomers() {
    var body = $('customersBody');
    var empty = $('customersEmpty');
    if (!body) return;

    var term = Voice ? Voice.normalize(state.filters.customer) : state.filters.customer.trim();
    var rows = state.customers.filter(function (c) {
      if (!term) return true;
      var hay = Voice ? Voice.normalize([c.name, c.phone, c.city, c.taxId].join(' ')) : [c.name, c.phone, c.city].join(' ');
      return hay.indexOf(term) >= 0;
    });

    body.innerHTML = rows
      .map(function (c) {
        var st = customerStats(c.uuid);
        return (
          '<tr>' +
          '<td data-label="نام / مجموعه"><div class="cell-main"><strong>' + escapeHtml(c.name) + '</strong>' +
          (c.address ? '<small>' + escapeHtml(String(c.address).slice(0, 60)) + '</small>' : '') + '</div></td>' +
          '<td data-label="تلفن" dir="ltr">' + (c.phone ? fa(c.phone) : '—') + '</td>' +
          '<td data-label="شهر">' + (c.city ? escapeHtml(c.city) : '—') + '</td>' +
          '<td data-label="تعداد فاکتور">' + fa(st.count) + '</td>' +
          '<td data-label="جمع خرید"><b>' + money(st.total) + '</b></td>' +
          '<td data-label="عملیات" class="row-actions">' +
          '<button class="icon-btn" data-invoice-for="' + escapeHtml(c.uuid) + '" aria-label="فاکتور جدید"><svg><use href="#i-plus-receipt"></use></svg></button>' +
          '<button class="icon-btn" data-edit-customer="' + escapeHtml(c.uuid) + '" aria-label="ویرایش"><svg><use href="#i-edit"></use></svg></button>' +
          '<button class="icon-btn danger" data-delete-customer="' + escapeHtml(c.uuid) + '" aria-label="حذف"><svg><use href="#i-trash"></use></svg></button>' +
          '</td></tr>'
        );
      })
      .join('');

    if (empty) empty.hidden = rows.length > 0;

    var monthStart = monthStartIso();
    var activeSet = {};
    var sales = 0;
    state.invoices.forEach(function (inv) {
      if (inv.status !== 'final') return;
      sales += num(inv.total);
      if (inv.customerUuid && String(inv.issueDate || '') >= monthStart) activeSet[inv.customerUuid] = true;
    });

    setText('customerCount', fa(state.customers.length));
    setText('activeCustomerCount', fa(Object.keys(activeSet).length));
    setText('customerSales', money(sales));
  }

  function openCustomerDialog(uuid, prefillName) {
    var c = uuid ? findCustomer(uuid) : null;
    setText('customerDialogTitle', c ? 'ویرایش مشتری' : 'مشتری جدید');
    $('customerId').value = c ? c.uuid : '';
    $('customerName').value = c ? c.name || '' : prefillName || '';
    $('customerPhone').value = c ? c.phone || '' : '';
    $('customerTaxId').value = c ? c.taxId || '' : '';
    $('customerCity').value = c ? c.city || '' : '';
    $('customerPostal').value = c ? c.postalCode || '' : '';
    $('customerAddress').value = c ? c.address || '' : '';
    $('customerNote').value = c ? c.note || '' : '';
    openDialog('customerDialog');
    window.setTimeout(function () {
      $('customerName').focus();
    }, 60);
  }

  function submitCustomer(ev) {
    ev.preventDefault();
    var uuid = $('customerId').value;
    var name = $('customerName').value.trim();
    if (!name) {
      toast('نام مشتری الزامی است.', 'error');
      return;
    }

    var existing = uuid ? findCustomer(uuid) : null;
    var record = Object.assign({}, existing || {}, {
      uuid: uuid || DB.uuid(),
      name: name,
      phone: latin($('customerPhone').value.trim()),
      taxId: latin($('customerTaxId').value.trim()),
      city: $('customerCity').value.trim(),
      postalCode: latin($('customerPostal').value.trim()),
      address: $('customerAddress').value.trim(),
      note: $('customerNote').value.trim(),
      deleted: false,
    });

    DB.save('customers', record).then(function (saved) {
      if (existing) {
        state.customers = state.customers.map(function (c) {
          return c.uuid === saved.uuid ? saved : c;
        });
      } else {
        state.customers.push(saved);
      }
      state.customers.sort(function (a, b) {
        return String(a.name).localeCompare(String(b.name), 'fa');
      });
      closeDialog('customerDialog');
      renderCustomers();
      refreshCustomerSelect(saved.uuid);
      toast(existing ? 'مشتری به‌روزرسانی شد.' : 'مشتری ثبت شد.', 'success');
      Sync.syncNow({ silent: true });
    });
  }

  function deleteCustomer(uuid) {
    var c = findCustomer(uuid);
    if (!c) return;
    confirmDialog({
      title: 'حذف مشتری',
      text: '«' + c.name + '» حذف شود؟ فاکتورهای صادرشده باقی می‌مانند.',
    }).then(function (ok) {
      if (!ok) return;
      Sync.deleteRecord('customer', uuid).then(function () {
        state.customers = state.customers.filter(function (x) {
          return x.uuid !== uuid;
        });
        renderCustomers();
        refreshCustomerSelect();
        toast('مشتری حذف شد.', 'success');
      });
    });
  }

  function refreshCustomerSelect(selectUuid) {
    var select = $('invoiceCustomer');
    if (!select) return;
    var keep = selectUuid || select.value;
    select.innerHTML =
      '<option value="">انتخاب مشتری...</option>' +
      state.customers
        .map(function (c) {
          return '<option value="' + escapeHtml(c.uuid) + '">' + escapeHtml(c.name) + (c.city ? ' — ' + escapeHtml(c.city) : '') + '</option>';
        })
        .join('');
    if (keep) select.value = keep;
    if (select.value) {
      var draft = getDraft();
      draft.customerUuid = select.value;
      saveDraft();
    }
  }

  function initCustomers() {
    on($('customerForm'), 'submit', submitCustomer);
    on(
      $('customerSearch'),
      'input',
      debounce(function (ev) {
        state.filters.customer = ev.target.value;
        renderCustomers();
      }, 200)
    );

    document.addEventListener('click', function (ev) {
      var openBtn = ev.target.closest('[data-action="open-customer"]');
      if (openBtn) {
        ev.preventDefault();
        openCustomerDialog(null);
        return;
      }
      var edit = ev.target.closest('[data-edit-customer]');
      if (edit) {
        openCustomerDialog(edit.getAttribute('data-edit-customer'));
        return;
      }
      var del = ev.target.closest('[data-delete-customer]');
      if (del) {
        deleteCustomer(del.getAttribute('data-delete-customer'));
        return;
      }
      var invFor = ev.target.closest('[data-invoice-for]');
      if (invFor) {
        var draft = getDraft();
        draft.customerUuid = invFor.getAttribute('data-invoice-for');
        saveDraft();
        navigate('new-invoice');
        var sel = $('invoiceCustomer');
        if (sel) sel.value = draft.customerUuid;
      }
    });
  }

  // =======================================================================
  // ویرایشگر فاکتور
  // =======================================================================

  function emptyDraft() {
    return {
      uuid: null,
      customerUuid: '',
      place: '',
      issueDate: todayIso(),
      items: [],
      discount: 0,
      taxPercent: num(state.settings.taxPercent, 0),
      shipping: 0,
      paymentStatus: 'unpaid',
      notes: '',
    };
  }

  function getDraft() {
    if (!state.draft) {
      try {
        var raw = window.localStorage.getItem(DRAFT_KEY);
        state.draft = raw ? JSON.parse(raw) : emptyDraft();
      } catch (e) {
        state.draft = emptyDraft();
      }
      if (!state.draft || !Array.isArray(state.draft.items)) state.draft = emptyDraft();
    }
    return state.draft;
  }

  function saveDraft() {
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(state.draft));
    } catch (e) {}
  }

  function resetDraft(keepCustomer) {
    var customerUuid = keepCustomer ? getDraft().customerUuid : '';
    state.draft = emptyDraft();
    state.draft.customerUuid = customerUuid;
    state.editingInvoiceUuid = null;
    saveDraft();
    fillEditorFromDraft();
    renderInvoiceLines();
  }

  function fillEditorFromDraft() {
    var d = getDraft();
    var sel = $('invoiceCustomer');
    if (sel) sel.value = d.customerUuid || '';
    setValueForce('invoiceDate', d.issueDate || todayIso());
    setValueForce('invoicePlace', d.place || '');
    setValueForce('invoiceDiscount', num(d.discount));
    setValueForce('invoiceTax', num(d.taxPercent));
    setValueForce('invoiceShipping', num(d.shipping));
    setValueForce('invoicePaymentStatus', d.paymentStatus || 'unpaid');
    setValueForce('invoiceNotes', d.notes || '');

    var numberBox = $('editorInvoiceNumber');
    if (numberBox) {
      numberBox.textContent = state.editingInvoiceUuid
        ? fa((findInvoice(state.editingInvoiceUuid) || {}).number || '—')
        : fa(nextInvoiceNumber());
    }
  }

  function setValueForce(id, value) {
    var el = $(id);
    if (el) el.value = value === undefined || value === null ? '' : value;
  }

  function collectEditorIntoDraft() {
    var d = getDraft();
    d.customerUuid = (($('invoiceCustomer') || {}).value) || '';
    d.issueDate = (($('invoiceDate') || {}).value) || todayIso();
    d.place = (($('invoicePlace') || {}).value) || '';
    d.discount = num(($('invoiceDiscount') || {}).value);
    d.taxPercent = Math.min(100, Math.max(0, num(($('invoiceTax') || {}).value)));
    d.shipping = num(($('invoiceShipping') || {}).value);
    d.paymentStatus = (($('invoicePaymentStatus') || {}).value) || 'unpaid';
    d.notes = (($('invoiceNotes') || {}).value) || '';
    saveDraft();
    return d;
  }

  /** محاسبه مبالغ یک فاکتور/پیش‌نویس. */
  function computeTotals(source) {
    var subtotal = (source.items || []).reduce(function (acc, it) {
      var line = num(it.unitPrice) * num(it.qty) - num(it.discount);
      return acc + Math.max(0, line);
    }, 0);
    var discount = Math.min(num(source.discount), subtotal);
    var base = Math.max(0, subtotal - discount);
    var taxPercent = Math.min(100, Math.max(0, num(source.taxPercent)));
    var taxAmount = Math.round(base * taxPercent) / 100;
    var shipping = Math.max(0, num(source.shipping));
    var total = base + taxAmount + shipping;
    return {
      subtotal: subtotal,
      discount: discount,
      taxPercent: taxPercent,
      taxAmount: taxAmount,
      shipping: shipping,
      total: total,
    };
  }

  function renderInvoiceLines() {
    var body = $('invoiceLinesBody');
    var empty = $('invoiceLinesEmpty');
    if (!body) return;

    var d = getDraft();

    body.innerHTML = d.items
      .map(function (it, index) {
        var line = Math.max(0, num(it.unitPrice) * num(it.qty) - num(it.discount));
        return (
          '<tr>' +
          '<td data-label="ردیف">' + fa(index + 1) + '</td>' +
          '<td data-label="شرح محصول"><div class="cell-main"><strong>' + escapeHtml(it.name) + '</strong><small>' + escapeHtml(it.unit || 'عدد') + '</small></div></td>' +
          '<td data-label="قیمت واحد"><input class="cell-input" type="number" min="0" inputmode="numeric" data-line-price="' + index + '" value="' + num(it.unitPrice) + '"></td>' +
          '<td data-label="تعداد"><input class="cell-input narrow" type="number" min="0.01" step="0.01" inputmode="decimal" data-line-qty="' + index + '" value="' + num(it.qty) + '"></td>' +
          '<td data-label="تخفیف"><input class="cell-input" type="number" min="0" inputmode="numeric" data-line-discount="' + index + '" value="' + num(it.discount) + '"></td>' +
          '<td data-label="مبلغ"><b>' + money(line) + '</b></td>' +
          '<td data-label="حذف" class="row-actions"><button class="icon-btn danger" data-line-remove="' + index + '" aria-label="حذف ردیف"><svg><use href="#i-trash"></use></svg></button></td>' +
          '</tr>'
        );
      })
      .join('');

    if (empty) empty.hidden = d.items.length > 0;

    var totals = computeTotals(d);
    setText('sumSubtotal', money(totals.subtotal));
    setText('sumTotal', money(totals.total));
  }

  /** افزودن قلم به پیش‌نویس؛ اگر محصول تکراری بود تعداد جمع می‌شود. */
  function addLine(product, qty, overridePrice) {
    var d = getDraft();
    var quantity = num(qty, 1) || 1;

    for (var i = 0; i < d.items.length; i++) {
      if (d.items[i].productUuid && d.items[i].productUuid === product.uuid) {
        d.items[i].qty = num(d.items[i].qty) + quantity;
        if (overridePrice != null) d.items[i].unitPrice = num(overridePrice);
        saveDraft();
        renderInvoiceLines();
        return d.items[i];
      }
    }

    var item = {
      productUuid: product.uuid || '',
      name: product.name,
      unit: product.unit || 'عدد',
      unitPrice: overridePrice != null ? num(overridePrice) : num(product.price),
      qty: quantity,
      discount: 0,
    };
    d.items.push(item);
    saveDraft();
    renderInvoiceLines();
    return item;
  }

  function addLineFromInputs() {
    var input = $('lineProductSearch');
    var qtyInput = $('lineQty');
    if (!input) return;

    var text = input.value.trim();
    if (!text) {
      toast('نام محصول را وارد کنید.', 'error');
      input.focus();
      return;
    }

    var qty = num(qtyInput ? qtyInput.value : 1, 1) || 1;
    var match = Voice ? Voice.matchProduct(text, state.products) : null;

    if (match && match.score >= 0.6) {
      addLine(match.product, qty);
      input.value = '';
      if (qtyInput) qtyInput.value = 1;
      input.focus();
      return;
    }

    confirmDialog({
      title: 'محصول پیدا نشد',
      text: '«' + text + '» در فهرست محصولات نیست. آن را به‌عنوان محصول جدید ثبت می‌کنید؟',
      action: 'ثبت محصول',
      danger: false,
    }).then(function (ok) {
      if (!ok) return;
      openProductDialog(null);
      $('productName').value = text;
      $('productPrice').focus();
    });
  }

  function initInvoiceEditor() {
    fillEditorFromDraft();

    on($('addLineBtn'), 'click', function (ev) {
      ev.preventDefault();
      addLineFromInputs();
    });

    on($('lineProductSearch'), 'keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        addLineFromInputs();
      }
    });

    on($('lineQty'), 'keydown', function (ev) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        addLineFromInputs();
      }
    });

    ['invoiceCustomer', 'invoiceDate', 'invoicePlace', 'invoicePaymentStatus', 'invoiceNotes'].forEach(function (id) {
      on($(id), 'change', function () {
        collectEditorIntoDraft();
      });
    });

    ['invoiceDiscount', 'invoiceTax', 'invoiceShipping'].forEach(function (id) {
      on($(id), 'input', function () {
        collectEditorIntoDraft();
        renderInvoiceLines();
      });
    });

    // ویرایش درجای ردیف‌ها
    on($('invoiceLinesBody'), 'input', function (ev) {
      var d = getDraft();
      var el = ev.target;
      var idx;

      if (el.hasAttribute('data-line-qty')) {
        idx = +el.getAttribute('data-line-qty');
        if (d.items[idx]) d.items[idx].qty = Math.max(0.01, num(el.value, 1));
      } else if (el.hasAttribute('data-line-price')) {
        idx = +el.getAttribute('data-line-price');
        if (d.items[idx]) d.items[idx].unitPrice = Math.max(0, num(el.value));
      } else if (el.hasAttribute('data-line-discount')) {
        idx = +el.getAttribute('data-line-discount');
        if (d.items[idx]) d.items[idx].discount = Math.max(0, num(el.value));
      } else {
        return;
      }

      saveDraft();
      var totals = computeTotals(d);
      setText('sumSubtotal', money(totals.subtotal));
      setText('sumTotal', money(totals.total));

      var row = el.closest('tr');
      if (row) {
        var item = d.items[idx];
        var cell = row.querySelector('td[data-label="مبلغ"] b');
        if (cell && item) cell.textContent = money(Math.max(0, num(item.unitPrice) * num(item.qty) - num(item.discount)));
      }
    });

    on($('invoiceLinesBody'), 'click', function (ev) {
      var btn = ev.target.closest('[data-line-remove]');
      if (!btn) return;
      var idx = +btn.getAttribute('data-line-remove');
      var d = getDraft();
      d.items.splice(idx, 1);
      saveDraft();
      renderInvoiceLines();
    });

    on($('resetInvoiceBtn'), 'click', function (ev) {
      ev.preventDefault();
      confirmDialog({
        title: 'پاک‌کردن فرم',
        text: 'همه اقلام و اطلاعات این فاکتور پاک شود؟',
        action: 'پاک کن',
      }).then(function (ok) {
        if (ok) {
          resetDraft(false);
          toast('فرم پاک شد.', 'info');
        }
      });
    });

    on($('saveDraftBtn'), 'click', function (ev) {
      ev.preventDefault();
      saveInvoice('draft');
    });

    on($('saveInvoiceBtn'), 'click', function (ev) {
      ev.preventDefault();
      saveInvoice('final');
    });

    on($('summarySaveBtn'), 'click', function (ev) {
      ev.preventDefault();
      saveInvoice('final');
    });

    on($('previewCurrentBtn'), 'click', function (ev) {
      ev.preventDefault();
      var d = collectEditorIntoDraft();
      if (!d.items.length) {
        toast('ابتدا حداقل یک قلم اضافه کنید.', 'error');
        return;
      }
      previewInvoice(buildInvoiceObject(d, state.editingInvoiceUuid ? 'final' : 'draft', true));
    });
  }

  /** ساخت شیء فاکتور از پیش‌نویس. */
  function buildInvoiceObject(d, status, preview) {
    var totals = computeTotals(d);
    var customer = findCustomer(d.customerUuid);
    var existing = state.editingInvoiceUuid ? findInvoice(state.editingInvoiceUuid) : null;

    return {
      uuid: existing ? existing.uuid : d.uuid || (preview ? 'preview' : DB.uuid()),
      number: existing ? existing.number : nextInvoiceNumber(),
      customerUuid: d.customerUuid || '',
      customerName: customer ? customer.name : '',
      place: d.place || '',
      issueDate: d.issueDate || todayIso(),
      status: status,
      paymentStatus: d.paymentStatus || 'unpaid',
      subtotal: totals.subtotal,
      discount: totals.discount,
      taxPercent: totals.taxPercent,
      taxAmount: totals.taxAmount,
      shipping: totals.shipping,
      total: totals.total,
      notes: d.notes || '',
      items: d.items.map(function (it) {
        return {
          productUuid: it.productUuid || '',
          name: it.name,
          unit: it.unit || 'عدد',
          unitPrice: num(it.unitPrice),
          qty: num(it.qty),
          discount: num(it.discount),
          lineTotal: Math.max(0, num(it.unitPrice) * num(it.qty) - num(it.discount)),
        };
      }),
      createdAt: existing ? existing.createdAt : nowStamp(),
      deleted: false,
    };
  }

  function saveInvoice(status) {
    var d = collectEditorIntoDraft();

    if (!d.items.length) {
      toast('فاکتور بدون قلم قابل ثبت نیست.', 'error');
      return Promise.resolve(false);
    }
    if (status === 'final' && !d.customerUuid && !d.place) {
      toast('برای ثبت نهایی، مشتری یا محل فروش را مشخص کنید.', 'error');
      return Promise.resolve(false);
    }

    var invoice = buildInvoiceObject(d, status);
    var isNew = !state.editingInvoiceUuid;

    return DB.save('invoices', invoice).then(function (saved) {
      if (isNew) state.invoices.unshift(saved);
      else {
        state.invoices = state.invoices.map(function (inv) {
          return inv.uuid === saved.uuid ? saved : inv;
        });
      }

      // شماره فاکتور بعدی فقط برای فاکتور تازه جلو می‌رود
      var chain = Promise.resolve();
      if (isNew) {
        state.settings.nextInvoiceNumber = num(state.settings.nextInvoiceNumber, 1) + 1;
        chain = DB.metaSet('settings', state.settings).then(function () {
          return Sync.saveSettings(settingsPayload()).catch(function () {});
        });
      }

      return chain.then(function () {
        resetDraft(false);
        renderInvoices();
        renderDashboard();
        renderCustomers();
        applySettingsToUi();
        toast(status === 'draft' ? 'پیش‌نویس ذخیره شد.' : 'فاکتور ' + fa(saved.number) + ' ثبت شد.', 'success');
        Sync.syncNow({ silent: true });
        if (status === 'final') previewInvoice(saved);
        return true;
      });
    });
  }

  function editInvoice(uuid) {
    var inv = findInvoice(uuid);
    if (!inv) return;
    state.editingInvoiceUuid = uuid;
    state.draft = {
      uuid: inv.uuid,
      customerUuid: inv.customerUuid || '',
      place: inv.place || '',
      issueDate: String(inv.issueDate || todayIso()).slice(0, 10),
      items: (inv.items || []).map(function (it) {
        return {
          productUuid: it.productUuid || '',
          name: it.name,
          unit: it.unit || 'عدد',
          unitPrice: num(it.unitPrice),
          qty: num(it.qty),
          discount: num(it.discount),
        };
      }),
      discount: num(inv.discount),
      taxPercent: num(inv.taxPercent),
      shipping: num(inv.shipping),
      paymentStatus: inv.paymentStatus || 'unpaid',
      notes: inv.notes || '',
    };
    saveDraft();
    navigate('new-invoice');
    fillEditorFromDraft();
    renderInvoiceLines();
    toast('فاکتور ' + fa(inv.number) + ' برای ویرایش باز شد.', 'info');
  }

  function duplicateInvoice(uuid) {
    var inv = findInvoice(uuid);
    if (!inv) return;
    state.editingInvoiceUuid = null;
    state.draft = {
      uuid: null,
      customerUuid: inv.customerUuid || '',
      place: inv.place || '',
      issueDate: todayIso(),
      items: (inv.items || []).map(function (it) {
        return {
          productUuid: it.productUuid || '',
          name: it.name,
          unit: it.unit || 'عدد',
          unitPrice: num(it.unitPrice),
          qty: num(it.qty),
          discount: num(it.discount),
        };
      }),
      discount: num(inv.discount),
      taxPercent: num(inv.taxPercent),
      shipping: num(inv.shipping),
      paymentStatus: 'unpaid',
      notes: inv.notes || '',
    };
    saveDraft();
    navigate('new-invoice');
    fillEditorFromDraft();
    renderInvoiceLines();
    toast('کپی فاکتور آماده شد.', 'success');
  }

  // =======================================================================
  // فهرست فاکتورها
  // =======================================================================

  var PAYMENT_LABEL = { unpaid: 'پرداخت‌نشده', partial: 'بخشی', paid: 'پرداخت‌شده' };
  var PAYMENT_CLASS = { unpaid: 'danger', partial: 'warn', paid: 'ok' };

  function invoiceMatchesFilter(inv) {
    var term = Voice ? Voice.normalize(state.filters.invoice) : state.filters.invoice.trim();
    if (term) {
      var hay = Voice
        ? Voice.normalize([inv.number, inv.customerName, inv.place].join(' '))
        : [inv.number, inv.customerName, inv.place].join(' ');
      if (hay.indexOf(term) < 0) return false;
    }
    var f = state.filters.invoiceStatus;
    if (f === 'all') return true;
    if (f === 'final' || f === 'draft') return inv.status === f;
    if (f === 'paid') return inv.paymentStatus === 'paid';
    if (f === 'unpaid') return inv.paymentStatus !== 'paid';
    return true;
  }

  function renderInvoices() {
    var body = $('invoicesBody');
    var empty = $('invoicesEmpty');
    if (!body) return;

    var rows = state.invoices.filter(invoiceMatchesFilter);

    body.innerHTML = rows
      .map(function (inv) {
        var itemCount = (inv.items || []).reduce(function (acc, it) {
          return acc + num(it.qty);
        }, 0);
        return (
          '<tr>' +
          '<td data-label="شماره"><b dir="ltr">' + escapeHtml(fa(inv.number)) + '</b></td>' +
          '<td data-label="خریدار / محل"><div class="cell-main"><strong>' + escapeHtml(inv.customerName || 'بدون مشتری') + '</strong>' +
          (inv.place ? '<small>' + escapeHtml(inv.place) + '</small>' : '') + '</div></td>' +
          '<td data-label="تاریخ">' + jalaliShort(inv.issueDate) + '</td>' +
          '<td data-label="تعداد اقلام">' + qtyText(itemCount) + '</td>' +
          '<td data-label="مبلغ کل"><b>' + money(inv.total) + '</b></td>' +
          '<td data-label="پرداخت"><span class="badge ' + (PAYMENT_CLASS[inv.paymentStatus] || '') + '">' +
          (PAYMENT_LABEL[inv.paymentStatus] || '—') + '</span></td>' +
          '<td data-label="نوع"><span class="badge ' + (inv.status === 'draft' ? 'muted' : 'info') + '">' +
          (inv.status === 'draft' ? 'پیش‌نویس' : 'نهایی') + '</span></td>' +
          '<td data-label="عملیات" class="row-actions">' +
          '<button class="icon-btn" data-preview-invoice="' + escapeHtml(inv.uuid) + '" aria-label="پیش‌نمایش"><svg><use href="#i-eye"></use></svg></button>' +
          '<button class="icon-btn" data-edit-invoice="' + escapeHtml(inv.uuid) + '" aria-label="ویرایش"><svg><use href="#i-edit"></use></svg></button>' +
          '<button class="icon-btn" data-copy-invoice="' + escapeHtml(inv.uuid) + '" aria-label="کپی"><svg><use href="#i-copy"></use></svg></button>' +
          '<button class="icon-btn danger" data-delete-invoice="' + escapeHtml(inv.uuid) + '" aria-label="حذف"><svg><use href="#i-trash"></use></svg></button>' +
          '</td></tr>'
        );
      })
      .join('');

    if (empty) empty.hidden = rows.length > 0;
  }

  function deleteInvoice(uuid) {
    var inv = findInvoice(uuid);
    if (!inv) return;
    confirmDialog({
      title: 'حذف فاکتور',
      text: 'فاکتور ' + fa(inv.number) + ' حذف شود؟ این کار قابل بازگشت نیست.',
    }).then(function (ok) {
      if (!ok) return;
      Sync.deleteRecord('invoice', uuid).then(function () {
        state.invoices = state.invoices.filter(function (x) {
          return x.uuid !== uuid;
        });
        renderInvoices();
        renderDashboard();
        renderCustomers();
        toast('فاکتور حذف شد.', 'success');
      });
    });
  }

  function cyclePaymentStatus(uuid) {
    var inv = findInvoice(uuid);
    if (!inv) return;
    var order = ['unpaid', 'partial', 'paid'];
    var next = order[(order.indexOf(inv.paymentStatus) + 1) % order.length];
    inv.paymentStatus = next;
    DB.save('invoices', inv).then(function (saved) {
      state.invoices = state.invoices.map(function (x) {
        return x.uuid === saved.uuid ? saved : x;
      });
      renderInvoices();
      renderDashboard();
      toast('وضعیت پرداخت: ' + PAYMENT_LABEL[next], 'success');
      Sync.syncNow({ silent: true });
    });
  }

  function initInvoiceList() {
    on(
      $('invoiceSearch'),
      'input',
      debounce(function (ev) {
        state.filters.invoice = ev.target.value;
        renderInvoices();
      }, 200)
    );

    on($('invoiceStatusFilter'), 'change', function (ev) {
      state.filters.invoiceStatus = ev.target.value;
      renderInvoices();
    });

    document.addEventListener('click', function (ev) {
      var preview = ev.target.closest('[data-preview-invoice]');
      if (preview) {
        previewInvoice(findInvoice(preview.getAttribute('data-preview-invoice')));
        return;
      }
      var edit = ev.target.closest('[data-edit-invoice]');
      if (edit) {
        editInvoice(edit.getAttribute('data-edit-invoice'));
        return;
      }
      var copy = ev.target.closest('[data-copy-invoice]');
      if (copy) {
        duplicateInvoice(copy.getAttribute('data-copy-invoice'));
        return;
      }
      var del = ev.target.closest('[data-delete-invoice]');
      if (del) {
        deleteInvoice(del.getAttribute('data-delete-invoice'));
        return;
      }
      var pay = ev.target.closest('[data-toggle-payment]');
      if (pay) cyclePaymentStatus(pay.getAttribute('data-toggle-payment'));
    });
  }

  // =======================================================================
  // پیش‌نمایش و چاپ
  // =======================================================================

  function invoiceHtml(inv) {
    var s = state.settings;
    var customer = findCustomer(inv.customerUuid);

    var rows = (inv.items || [])
      .map(function (it, i) {
        return (
          '<tr><td>' + fa(i + 1) + '</td><td class="desc">' + escapeHtml(it.name) + '</td><td>' +
          escapeHtml(it.unit || 'عدد') + '</td><td>' + qtyText(it.qty) + '</td><td>' + money(it.unitPrice) +
          '</td><td>' + money(it.discount) + '</td><td>' + money(it.lineTotal != null ? it.lineTotal : num(it.unitPrice) * num(it.qty) - num(it.discount)) + '</td></tr>'
        );
      })
      .join('');

    return (
      '<div class="paper">' +
      '<header class="paper-head">' +
      '<div class="paper-seller">' +
      (s.logo ? '<img class="paper-logo" src="' + escapeHtml(s.logo) + '" alt="">' : '') +
      '<div><h1>' + escapeHtml(s.businessName || 'کسب‌وکار من') + '</h1>' +
      (s.ownerName ? '<p>' + escapeHtml(s.ownerName) + '</p>' : '') +
      (s.phone ? '<p>تلفن: ' + fa(s.phone) + '</p>' : '') +
      (s.taxId ? '<p>شناسه: ' + fa(s.taxId) + '</p>' : '') +
      (s.address ? '<p>' + escapeHtml(s.address) + '</p>' : '') +
      '</div></div>' +
      '<div class="paper-meta">' +
      '<h2>فاکتور فروش</h2>' +
      '<p><span>شماره:</span> <b dir="ltr">' + escapeHtml(fa(inv.number)) + '</b></p>' +
      '<p><span>تاریخ:</span> ' + jalaliText(inv.issueDate) + '</p>' +
      '<p><span>وضعیت:</span> ' + (PAYMENT_LABEL[inv.paymentStatus] || '—') + '</p>' +
      '</div></header>' +
      '<section class="paper-buyer"><h3>خریدار</h3><div>' +
      '<p><span>نام:</span> ' + escapeHtml(inv.customerName || '—') + '</p>' +
      (customer && customer.phone ? '<p><span>تلفن:</span> ' + fa(customer.phone) + '</p>' : '') +
      (customer && customer.taxId ? '<p><span>شناسه:</span> ' + fa(customer.taxId) + '</p>' : '') +
      (inv.place ? '<p><span>محل:</span> ' + escapeHtml(inv.place) + '</p>' : '') +
      (customer && customer.address ? '<p><span>آدرس:</span> ' + escapeHtml(customer.address) + '</p>' : '') +
      '</div></section>' +
      '<table class="paper-table"><thead><tr><th>ردیف</th><th>شرح</th><th>واحد</th><th>تعداد</th><th>قیمت واحد</th><th>تخفیف</th><th>مبلغ</th></tr></thead><tbody>' +
      rows +
      '</tbody></table>' +
      '<section class="paper-totals">' +
      '<div><span>جمع اقلام</span><b>' + money(inv.subtotal) + '</b></div>' +
      (num(inv.discount) ? '<div><span>تخفیف</span><b>' + money(inv.discount) + '</b></div>' : '') +
      (num(inv.taxAmount) ? '<div><span>مالیات (' + fa(inv.taxPercent) + '٪)</span><b>' + money(inv.taxAmount) + '</b></div>' : '') +
      (num(inv.shipping) ? '<div><span>هزینه ارسال</span><b>' + money(inv.shipping) + '</b></div>' : '') +
      '<div class="grand"><span>مبلغ قابل پرداخت</span><b>' + money(inv.total) + ' ' + escapeHtml(currency()) + '</b></div>' +
      '</section>' +
      (inv.notes ? '<section class="paper-notes"><h3>توضیحات</h3><p>' + escapeHtml(inv.notes) + '</p></section>' : '') +
      '<footer class="paper-foot">' +
      '<div class="sign"><span>مهر و امضای فروشنده</span></div>' +
      '<div class="sign"><span>امضای خریدار</span></div>' +
      (s.invoiceFooter ? '<p class="foot-note">' + escapeHtml(s.invoiceFooter) + '</p>' : '') +
      '</footer>' +
      '</div>'
    );
  }

  function previewInvoice(inv) {
    if (!inv) return;
    var box = $('previewContent');
    if (box) box.innerHTML = invoiceHtml(inv);
    openDialog('previewDialog');
  }

  function printInvoice() {
    var box = $('previewContent');
    var area = $('printArea');
    if (!box || !area) return;
    area.innerHTML = box.innerHTML;
    document.body.classList.add('printing');
    window.setTimeout(function () {
      window.print();
      window.setTimeout(function () {
        document.body.classList.remove('printing');
        area.innerHTML = '';
      }, 400);
    }, 60);
  }

  // =======================================================================
  // پیشخوان
  // =======================================================================

  function monthStartIso() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
  }

  function previousMonthRange() {
    var d = new Date();
    var start = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    var end = new Date(d.getFullYear(), d.getMonth(), 0);
    var f = function (x) {
      return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    };
    return { from: f(start), to: f(end) };
  }

  function renderDashboard() {
    var monthStart = monthStartIso();
    var prev = previousMonthRange();

    var monthSales = 0;
    var monthCount = 0;
    var prevSales = 0;
    var receivable = 0;
    var unpaidCount = 0;

    state.invoices.forEach(function (inv) {
      if (inv.status !== 'final') return;
      var date = String(inv.issueDate || '').slice(0, 10);
      if (date >= monthStart) {
        monthSales += num(inv.total);
        monthCount++;
      } else if (date >= prev.from && date <= prev.to) {
        prevSales += num(inv.total);
      }
      if (inv.paymentStatus !== 'paid') {
        receivable += num(inv.total);
        unpaidCount++;
      }
    });

    setText('statMonthSales', money(monthSales));
    setText('statMonthInvoices', fa(monthCount));
    setText('statReceivables', money(receivable));
    setText('statUnpaidCount', fa(unpaidCount) + ' فاکتور پرداخت‌نشده');
    setText('statCustomers', fa(state.customers.length));

    var compare = $('statMonthCompare');
    if (compare) {
      if (prevSales <= 0) {
        compare.textContent = monthSales > 0 ? 'اولین ماه فروش شما' : 'بدون فروش ثبت‌شده';
        compare.className = '';
      } else {
        var change = ((monthSales - prevSales) / prevSales) * 100;
        var up = change >= 0;
        compare.textContent = (up ? '▲ ' : '▼ ') + fa(Math.abs(Math.round(change))) + '٪ نسبت به ماه گذشته';
        compare.className = up ? 'trend-up' : 'trend-down';
      }
    }

    renderRecentInvoices();
    renderDashboardChart();
  }

  function renderRecentInvoices() {
    var body = $('recentInvoicesBody');
    var empty = $('recentEmpty');
    if (!body) return;

    var rows = state.invoices.slice(0, 6);

    body.innerHTML = rows
      .map(function (inv) {
        return (
          '<tr>' +
          '<td data-label="شماره"><b dir="ltr">' + escapeHtml(fa(inv.number)) + '</b></td>' +
          '<td data-label="مشتری">' + escapeHtml(inv.customerName || 'بدون مشتری') + '</td>' +
          '<td data-label="تاریخ">' + jalaliShort(inv.issueDate) + '</td>' +
          '<td data-label="مبلغ کل"><b>' + money(inv.total) + '</b></td>' +
          '<td data-label="وضعیت"><span class="badge ' + (PAYMENT_CLASS[inv.paymentStatus] || '') + '">' +
          (PAYMENT_LABEL[inv.paymentStatus] || '—') + '</span></td>' +
          '<td data-label="عملیات" class="row-actions">' +
          '<button class="icon-btn" data-preview-invoice="' + escapeHtml(inv.uuid) + '" aria-label="پیش‌نمایش"><svg><use href="#i-eye"></use></svg></button>' +
          '</td></tr>'
        );
      })
      .join('');

    if (empty) empty.hidden = rows.length > 0;
  }

  // =======================================================================
  // نمودار (Canvas خالص، بدون کتابخانه)
  // =======================================================================

  function drawBarChart(canvas, data, emptyEl) {
    if (!canvas) return;
    var hasData = data.some(function (d) {
      return d.value > 0;
    });
    if (emptyEl) emptyEl.hidden = hasData;
    canvas.hidden = !hasData;
    if (!hasData) return;

    var dpr = window.devicePixelRatio || 1;
    var cssWidth = canvas.parentElement ? canvas.parentElement.clientWidth : 600;
    var cssHeight = canvas.getAttribute('height') ? +canvas.getAttribute('height') : 240;

    canvas.width = Math.max(200, cssWidth) * dpr;
    canvas.height = cssHeight * dpr;
    canvas.style.width = '100%';
    canvas.style.height = cssHeight + 'px';

    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    var styles = window.getComputedStyle(document.documentElement);
    var brand = (styles.getPropertyValue('--brand') || '#4f46e5').trim();
    var textColor = (styles.getPropertyValue('--text-soft') || '#64748b').trim();
    var gridColor = (styles.getPropertyValue('--border') || '#e2e8f0').trim();

    var padTop = 16;
    var padBottom = 32;
    var padSide = 12;
    var plotHeight = cssHeight - padTop - padBottom;
    var plotWidth = cssWidth - padSide * 2;

    var max = Math.max.apply(
      null,
      data.map(function (d) {
        return d.value;
      })
    );
    if (max <= 0) max = 1;

    // خطوط راهنما
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (var g = 0; g <= 4; g++) {
      var y = padTop + (plotHeight / 4) * g;
      ctx.beginPath();
      ctx.moveTo(padSide, y);
      ctx.lineTo(cssWidth - padSide, y);
      ctx.stroke();
    }

    var slot = plotWidth / data.length;
    var barWidth = Math.min(46, slot * 0.55);

    ctx.font = '11px Vazirmatn, system-ui, sans-serif';
    ctx.textAlign = 'center';

    data.forEach(function (d, i) {
      // RTL: از راست به چپ
      var center = cssWidth - padSide - slot * (i + 0.5);
      var h = (d.value / max) * plotHeight;
      var top = padTop + plotHeight - h;

      var grad = ctx.createLinearGradient(0, top, 0, padTop + plotHeight);
      grad.addColorStop(0, brand);
      grad.addColorStop(1, brand + '33');
      ctx.fillStyle = grad;

      var r = Math.min(6, barWidth / 2);
      var x = center - barWidth / 2;
      var y2 = padTop + plotHeight;
      ctx.beginPath();
      ctx.moveTo(x, y2);
      ctx.lineTo(x, top + r);
      ctx.quadraticCurveTo(x, top, x + r, top);
      ctx.lineTo(x + barWidth - r, top);
      ctx.quadraticCurveTo(x + barWidth, top, x + barWidth, top + r);
      ctx.lineTo(x + barWidth, y2);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = textColor;
      ctx.fillText(d.label, center, cssHeight - 12);
    });
  }

  function renderDashboardChart() {
    var days = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      var j = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
      days.push({ iso: iso, label: fa(j[2]), value: 0 });
    }

    state.invoices.forEach(function (inv) {
      if (inv.status !== 'final') return;
      var date = String(inv.issueDate || '').slice(0, 10);
      for (var i = 0; i < days.length; i++) {
        if (days[i].iso === date) {
          days[i].value += num(inv.total);
          break;
        }
      }
    });

    drawBarChart($('dashboardChart'), days, $('dashboardChartEmpty'));
  }

  // =======================================================================
  // گزارش‌ها
  // =======================================================================

  function runReport() {
    var from = ($('reportFrom') || {}).value || '';
    var to = ($('reportTo') || {}).value || '';
    var status = ($('reportStatus') || {}).value || 'final';

    if (!from && !to) {
      // پیش‌فرض: ۳۰ روز گذشته
      var start = new Date();
      start.setDate(start.getDate() - 29);
      from = start.getFullYear() + '-' + String(start.getMonth() + 1).padStart(2, '0') + '-' + String(start.getDate()).padStart(2, '0');
      to = todayIso();
      setValueForce('reportFrom', from);
      setValueForce('reportTo', to);
    }

    var rows = state.invoices.filter(function (inv) {
      var date = String(inv.issueDate || '').slice(0, 10);
      if (from && date < from) return false;
      if (to && date > to) return false;
      if (status === 'final') return inv.status === 'final';
      if (status === 'paid') return inv.paymentStatus === 'paid';
      if (status === 'unpaid') return inv.paymentStatus !== 'paid';
      return true;
    });

    var sales = 0;
    var due = 0;
    var items = 0;
    var productTotals = {};

    rows.forEach(function (inv) {
      sales += num(inv.total);
      if (inv.paymentStatus !== 'paid') due += num(inv.total);
      (inv.items || []).forEach(function (it) {
        items += num(it.qty);
        var key = it.productUuid || it.name;
        if (!productTotals[key]) productTotals[key] = { name: it.name, qty: 0, total: 0 };
        productTotals[key].qty += num(it.qty);
        productTotals[key].total += num(it.lineTotal != null ? it.lineTotal : num(it.unitPrice) * num(it.qty));
      });
    });

    state.report = { rows: rows, from: from, to: to, status: status, sales: sales };

    setText('reportSales', money(sales));
    setText('reportInvoiceCount', fa(rows.length) + ' فاکتور');
    setText('reportDue', money(due));
    setText('reportAverage', rows.length ? money(sales / rows.length) : '۰');
    setText('reportItems', qtyText(items));
    setText('reportRangeLabel', (from ? jalaliText(from) : 'ابتدا') + ' تا ' + (to ? jalaliText(to) : 'امروز'));

    // جدول جزئیات
    var body = $('reportBody');
    var empty = $('reportEmpty');
    if (body) {
      body.innerHTML = rows
        .map(function (inv) {
          return (
            '<tr>' +
            '<td data-label="شماره"><b dir="ltr">' + escapeHtml(fa(inv.number)) + '</b></td>' +
            '<td data-label="مشتری">' + escapeHtml(inv.customerName || '—') + '</td>' +
            '<td data-label="تاریخ">' + jalaliShort(inv.issueDate) + '</td>' +
            '<td data-label="مبلغ"><b>' + money(inv.total) + '</b></td>' +
            '<td data-label="وضعیت"><span class="badge ' + (PAYMENT_CLASS[inv.paymentStatus] || '') + '">' +
            (PAYMENT_LABEL[inv.paymentStatus] || '—') + '</span></td>' +
            '</tr>'
          );
        })
        .join('');
      if (empty) empty.hidden = rows.length > 0;
    }

    // پرفروش‌ترین محصولات
    var ranked = Object.keys(productTotals)
      .map(function (k) {
        return productTotals[k];
      })
      .sort(function (a, b) {
        return b.total - a.total;
      })
      .slice(0, 6);

    var maxTotal = ranked.length ? ranked[0].total : 1;
    var list = $('topProductsList');
    if (list) {
      list.innerHTML = ranked.length
        ? ranked
            .map(function (p, i) {
              var pct = Math.max(4, Math.round((p.total / maxTotal) * 100));
              return (
                '<div class="rank-item"><span class="rank-index">' + fa(i + 1) + '</span>' +
                '<div class="rank-body"><div class="rank-top"><strong>' + escapeHtml(p.name) + '</strong><b>' + money(p.total) + '</b></div>' +
                '<div class="rank-bar"><span style="width:' + pct + '%"></span></div>' +
                '<small>' + qtyText(p.qty) + ' واحد فروخته‌شده</small></div></div>'
              );
            })
            .join('')
        : '<p class="muted center">در این بازه فروشی ثبت نشده است.</p>';
    }

    // نمودار بازه
    renderReportChart(rows, from, to);
  }

  function renderReportChart(rows, from, to) {
    var buckets = [];
    var startDate = from ? new Date(from) : new Date(rows.length ? rows[rows.length - 1].issueDate : todayIso());
    var endDate = to ? new Date(to) : new Date();
    var dayCount = Math.max(1, Math.round((endDate - startDate) / 86400000) + 1);

    if (dayCount <= 31) {
      for (var i = 0; i < dayCount; i++) {
        var d = new Date(startDate);
        d.setDate(d.getDate() + i);
        var iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        var j = toJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
        buckets.push({ key: iso, label: fa(j[2]), value: 0 });
      }
      rows.forEach(function (inv) {
        var date = String(inv.issueDate || '').slice(0, 10);
        for (var b = 0; b < buckets.length; b++) {
          if (buckets[b].key === date) {
            buckets[b].value += num(inv.total);
            break;
          }
        }
      });
    } else {
      // گروه‌بندی ماهانه
      var map = {};
      rows.forEach(function (inv) {
        var parts = String(inv.issueDate || '').slice(0, 10).split('-');
        if (parts.length !== 3) return;
        var jm = toJalali(+parts[0], +parts[1], +parts[2]);
        var key = jm[0] + '-' + jm[1];
        if (!map[key]) map[key] = { key: key, label: JALALI_MONTHS[jm[1] - 1].slice(0, 4), value: 0, sort: jm[0] * 12 + jm[1] };
        map[key].value += num(inv.total);
      });
      buckets = Object.keys(map)
        .map(function (k) {
          return map[k];
        })
        .sort(function (a, b) {
          return a.sort - b.sort;
        })
        .slice(-12);
    }

    if (!buckets.length) buckets = [{ label: '—', value: 0 }];
    drawBarChart($('reportChart'), buckets, $('reportChartEmpty'));
  }

  function exportReportCsv() {
    var report = state.report;
    if (!report || !report.rows.length) {
      toast('ابتدا گزارشی با داده تولید کنید.', 'error');
      return;
    }

    var header = ['شماره فاکتور', 'مشتری', 'تاریخ', 'تاریخ شمسی', 'جمع اقلام', 'تخفیف', 'مالیات', 'ارسال', 'مبلغ کل', 'وضعیت پرداخت', 'نوع'];
    var lines = [header.join(',')];

    report.rows.forEach(function (inv) {
      var cells = [
        inv.number,
        inv.customerName || '',
        String(inv.issueDate || '').slice(0, 10),
        jalaliShort(inv.issueDate),
        num(inv.subtotal),
        num(inv.discount),
        num(inv.taxAmount),
        num(inv.shipping),
        num(inv.total),
        PAYMENT_LABEL[inv.paymentStatus] || '',
        inv.status === 'draft' ? 'پیش‌نویس' : 'نهایی',
      ];
      lines.push(
        cells
          .map(function (c) {
            var v = String(c == null ? '' : c);
            return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
          })
          .join(',')
      );
    });

    // BOM تا اکسل فارسی را درست بخواند
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, 'factorino-report-' + todayIso() + '.csv');
    toast('فایل CSV دانلود شد.', 'success');
  }

  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function initReports() {
    on($('applyReportBtn'), 'click', function (ev) {
      ev.preventDefault();
      runReport();
    });
    on($('exportReportBtn'), 'click', function (ev) {
      ev.preventDefault();
      exportReportCsv();
    });
    on($('reportStatus'), 'change', runReport);
  }

  // =======================================================================
  // پشتیبان رمزنگاری‌شده (AES-GCM)
  // =======================================================================

  function cryptoAvailable() {
    return !!(window.crypto && window.crypto.subtle && window.TextEncoder);
  }

  function deriveKey(password, salt) {
    var enc = new TextEncoder();
    return window.crypto.subtle
      .importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveKey'])
      .then(function (baseKey) {
        return window.crypto.subtle.deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: 150000, hash: 'SHA-256' },
          baseKey,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
      });
  }

  function bytesToBase64(bytes) {
    var bin = '';
    var arr = new Uint8Array(bytes);
    for (var i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
    return window.btoa(bin);
  }

  function base64ToBytes(b64) {
    var bin = window.atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function exportBackup() {
    var passInput = $('backupPassword');
    var password = passInput ? passInput.value : '';

    if (!cryptoAvailable()) {
      toast('مرورگر شما رمزنگاری امن را پشتیبانی نمی‌کند.', 'error');
      return;
    }
    if (!password || password.length < 6) {
      toast('رمز پشتیبان باید حداقل ۶ کاراکتر باشد.', 'error');
      if (passInput) passInput.focus();
      return;
    }

    var payload = {
      app: 'factorino',
      version: 3,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      products: state.products,
      customers: state.customers,
      invoices: state.invoices,
    };

    var salt = window.crypto.getRandomValues(new Uint8Array(16));
    var iv = window.crypto.getRandomValues(new Uint8Array(12));

    deriveKey(password, salt)
      .then(function (key) {
        var data = new TextEncoder().encode(JSON.stringify(payload));
        return window.crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data);
      })
      .then(function (cipher) {
        var file = {
          format: 'factorino-encrypted-backup',
          version: 1,
          algorithm: 'AES-GCM-256/PBKDF2-SHA256-150000',
          salt: bytesToBase64(salt),
          iv: bytesToBase64(iv),
          data: bytesToBase64(cipher),
        };
        var blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
        downloadBlob(blob, 'factorino-backup-' + todayIso() + '.json');
        toast('پشتیبان رمزنگاری‌شده دانلود شد.', 'success');
        if (passInput) passInput.value = '';
      })
      .catch(function (err) {
        console.error(err);
        toast('ساخت پشتیبان ناموفق بود.', 'error');
      });
  }

  function importBackup(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    ev.target.value = '';

    var passInput = $('backupPassword');
    var password = passInput ? passInput.value : '';
    if (!password) {
      toast('برای بازیابی، رمز پشتیبان را در کادر بالا وارد کنید.', 'error');
      if (passInput) passInput.focus();
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(String(reader.result || ''));
      } catch (e) {
        toast('فایل پشتیبان خوانا نیست.', 'error');
        return;
      }
      if (!parsed || parsed.format !== 'factorino-encrypted-backup') {
        toast('این فایل یک پشتیبان فاکتورینو نیست.', 'error');
        return;
      }

      deriveKey(password, base64ToBytes(parsed.salt))
        .then(function (key) {
          return window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: base64ToBytes(parsed.iv) },
            key,
            base64ToBytes(parsed.data)
          );
        })
        .then(function (plain) {
          var payload = JSON.parse(new TextDecoder().decode(plain));
          return confirmDialog({
            title: 'بازیابی پشتیبان',
            text:
              'داده‌های این فایل با اطلاعات فعلی ادغام می‌شوند: ' +
              fa((payload.products || []).length) + ' محصول، ' +
              fa((payload.customers || []).length) + ' مشتری، ' +
              fa((payload.invoices || []).length) + ' فاکتور.',
            action: 'بازیابی کن',
            danger: false,
          }).then(function (ok) {
            if (!ok) return null;
            return applyBackup(payload);
          });
        })
        .then(function (applied) {
          if (applied) {
            toast('پشتیبان با موفقیت بازیابی شد.', 'success');
            if (passInput) passInput.value = '';
          }
        })
        .catch(function (err) {
          console.error(err);
          toast('رمز نادرست است یا فایل آسیب دیده.', 'error');
        });
    };
    reader.readAsText(file);
  }

  function applyBackup(payload) {
    var stamp = nowStamp();

    function normalizeRows(rows) {
      return (rows || []).map(function (r) {
        var copy = Object.assign({}, r);
        copy.uuid = copy.uuid || DB.uuid();
        copy.updatedAt = stamp;
        copy.dirty = 1;
        copy.deleted = !!copy.deleted;
        return copy;
      });
    }

    var products = normalizeRows(payload.products);
    var customers = normalizeRows(payload.customers);
    var invoices = normalizeRows(payload.invoices);

    return Promise.all([
      DB.bulkPut('products', products),
      DB.bulkPut('customers', customers),
      DB.bulkPut('invoices', invoices),
      payload.settings ? DB.metaSet('settings', Object.assign({}, state.settings, payload.settings)) : Promise.resolve(),
    ])
      .then(loadAll)
      .then(function () {
        renderAll();
        Sync.syncNow({ silent: true });
        return true;
      });
  }

  // =======================================================================
  // دستیار صوتی
  // =======================================================================

  var voiceUi = {
    setStatus: function (text, tone) {
      setText('voiceStatus', text);
      var dot = $('voiceDot');
      if (dot) dot.className = tone || '';
      var card = $('voiceCard');
      if (card) card.classList.toggle('listening', tone === 'live');
      var btn = $('voiceButton');
      if (btn) {
        btn.classList.toggle('active', tone === 'live');
        var label = btn.querySelector('strong');
        if (label) label.textContent = tone === 'live' ? 'در حال شنیدن…' : 'شروع گفتن';
      }
    },
    setTranscript: function (text) {
      setText('voiceTranscript', text || 'برای شروع روی میکروفن بزنید و واضح صحبت کنید.');
    },
    pushResult: function (html, kind) {
      var box = $('voiceResults');
      if (!box) return;
      var chip = document.createElement('div');
      chip.className = 'voice-result ' + (kind || 'ok');
      chip.innerHTML = html;
      box.insertBefore(chip, box.firstChild);
      while (box.children.length > 6) box.removeChild(box.lastChild);
    },
  };

  /** اجرای یک دستور صوتی روی وضعیت برنامه. */
  function applyVoiceCommand(cmd) {
    var d = getDraft();

    switch (cmd.type) {
      case 'add': {
        var item = addLine(cmd.product, cmd.qty, cmd.price);
        voiceUi.pushResult(
          '<svg><use href="#i-check"></use></svg><span><b>' + escapeHtml(cmd.product.name) + '</b> × ' +
            qtyText(cmd.qty) + ' ' + escapeHtml(item.unit || '') + '</span>',
          'ok'
        );
        return true;
      }

      case 'add-unknown': {
        var suggestionHtml = (cmd.suggestions || [])
          .map(function (s) {
            return '<button type="button" class="voice-suggest" data-voice-pick="' + escapeHtml(s.product.uuid) +
              '" data-voice-qty="' + cmd.qty + '">' + escapeHtml(s.product.name) + '</button>';
          })
          .join('');
        voiceUi.pushResult(
          '<svg><use href="#i-alert"></use></svg><span>«<b>' + escapeHtml(cmd.name) + '</b>» پیدا نشد.' +
            (suggestionHtml ? ' منظورتان این بود؟ ' + suggestionHtml : '') +
            ' <button type="button" class="voice-suggest" data-voice-new="' + escapeHtml(cmd.name) + '">ثبت محصول جدید</button></span>',
          'warn'
        );
        return false;
      }

      case 'remove': {
        if (cmd.target === 'all') {
          d.items = [];
          saveDraft();
          renderInvoiceLines();
          voiceUi.pushResult('<svg><use href="#i-trash"></use></svg><span>همه اقلام حذف شد.</span>', 'ok');
          return true;
        }
        if (cmd.target === 'last') {
          if (!d.items.length) return false;
          var removed = d.items.pop();
          saveDraft();
          renderInvoiceLines();
          voiceUi.pushResult('<svg><use href="#i-trash"></use></svg><span>«' + escapeHtml(removed.name) + '» حذف شد.</span>', 'ok');
          return true;
        }
        if (cmd.row) {
          var idx = cmd.row - 1;
          if (d.items[idx]) {
            var r2 = d.items.splice(idx, 1)[0];
            saveDraft();
            renderInvoiceLines();
            voiceUi.pushResult('<svg><use href="#i-trash"></use></svg><span>ردیف ' + fa(cmd.row) + ' («' + escapeHtml(r2.name) + '») حذف شد.</span>', 'ok');
            return true;
          }
          return false;
        }
        if (cmd.product) {
          var before = d.items.length;
          d.items = d.items.filter(function (it) {
            return it.productUuid !== cmd.product.uuid;
          });
          if (d.items.length !== before) {
            saveDraft();
            renderInvoiceLines();
            voiceUi.pushResult('<svg><use href="#i-trash"></use></svg><span>«' + escapeHtml(cmd.product.name) + '» حذف شد.</span>', 'ok');
            return true;
          }
        }
        voiceUi.pushResult('<svg><use href="#i-alert"></use></svg><span>موردی برای حذف پیدا نشد.</span>', 'warn');
        return false;
      }

      case 'set-qty': {
        var targets = cmd.product
          ? d.items.filter(function (it) {
              return it.productUuid === cmd.product.uuid;
            })
          : d.items.slice(-1);
        if (!targets.length) return false;
        targets.forEach(function (it) {
          it.qty = cmd.qty;
        });
        saveDraft();
        renderInvoiceLines();
        voiceUi.pushResult('<svg><use href="#i-edit"></use></svg><span>تعداد «' + escapeHtml(targets[0].name) + '» → ' + qtyText(cmd.qty) + '</span>', 'ok');
        return true;
      }

      case 'set-price': {
        var pTargets = cmd.product
          ? d.items.filter(function (it) {
              return it.productUuid === cmd.product.uuid;
            })
          : d.items.slice(-1);
        if (!pTargets.length) return false;
        pTargets.forEach(function (it) {
          it.unitPrice = cmd.price;
        });
        saveDraft();
        renderInvoiceLines();
        voiceUi.pushResult('<svg><use href="#i-edit"></use></svg><span>قیمت «' + escapeHtml(pTargets[0].name) + '» → ' + money(cmd.price) + '</span>', 'ok');
        return true;
      }

      case 'discount':
        d.discount = cmd.percent ? (computeTotals(d).subtotal * cmd.value) / 100 : cmd.value;
        saveDraft();
        fillEditorFromDraft();
        renderInvoiceLines();
        voiceUi.pushResult('<svg><use href="#i-check"></use></svg><span>تخفیف: ' + money(d.discount) + '</span>', 'ok');
        return true;

      case 'tax':
        d.taxPercent = Math.min(100, Math.max(0, cmd.value));
        saveDraft();
        fillEditorFromDraft();
        renderInvoiceLines();
        voiceUi.pushResult('<svg><use href="#i-check"></use></svg><span>مالیات: ' + fa(d.taxPercent) + '٪</span>', 'ok');
        return true;

      case 'shipping':
        d.shipping = cmd.value;
        saveDraft();
        fillEditorFromDraft();
        renderInvoiceLines();
        voiceUi.pushResult('<svg><use href="#i-check"></use></svg><span>هزینه ارسال: ' + money(cmd.value) + '</span>', 'ok');
        return true;

      case 'customer':
        d.customerUuid = cmd.customer.uuid;
        saveDraft();
        fillEditorFromDraft();
        voiceUi.pushResult('<svg><use href="#i-users"></use></svg><span>مشتری: <b>' + escapeHtml(cmd.customer.name) + '</b></span>', 'ok');
        return true;

      case 'customer-new':
        voiceUi.pushResult(
          '<svg><use href="#i-user-plus"></use></svg><span>مشتری «<b>' + escapeHtml(cmd.name) + '</b>» ثبت نشده. ' +
            '<button type="button" class="voice-suggest" data-voice-customer="' + escapeHtml(cmd.name) + '">ثبت مشتری</button></span>',
          'warn'
        );
        return false;

      case 'payment':
        d.paymentStatus = cmd.value;
        saveDraft();
        fillEditorFromDraft();
        voiceUi.pushResult('<svg><use href="#i-check"></use></svg><span>وضعیت پرداخت: ' + PAYMENT_LABEL[cmd.value] + '</span>', 'ok');
        return true;

      case 'notes':
        d.notes = cmd.value;
        saveDraft();
        fillEditorFromDraft();
        voiceUi.pushResult('<svg><use href="#i-edit"></use></svg><span>یادداشت ثبت شد.</span>', 'ok');
        return true;

      case 'clear':
        resetDraft(true);
        voiceUi.pushResult('<svg><use href="#i-refresh"></use></svg><span>فرم پاک شد.</span>', 'ok');
        return true;

      case 'new-invoice':
        resetDraft(false);
        navigate('new-invoice');
        voiceUi.pushResult('<svg><use href="#i-plus-receipt"></use></svg><span>فاکتور جدید آماده است.</span>', 'ok');
        return true;

      case 'finalize':
        Voice.stop();
        saveInvoice('final');
        return true;

      case 'draft':
        saveInvoice('draft');
        return true;

      case 'print':
        previewInvoice(buildInvoiceObject(collectEditorIntoDraft(), 'draft', true));
        return true;

      case 'help':
        voiceUi.pushResult(
          '<svg><use href="#i-info"></use></svg><span>می‌توانید بگویید: «دو تا قهوه»، «نیم کیلو پنیر»، «برای علی رضایی»، ' +
            '«تخفیف پنجاه هزار»، «مالیات نه درصد»، «قهوه را حذف کن»، «ثبت نهایی».</span>',
          'info'
        );
        return true;

      default:
        voiceUi.pushResult('<svg><use href="#i-alert"></use></svg><span>متوجه نشدم: «' + escapeHtml(cmd.text || '') + '»</span>', 'warn');
        return false;
    }
  }

  function handleVoiceCommands(commands, transcript) {
    if (!commands || !commands.length) {
      voiceUi.pushResult('<svg><use href="#i-alert"></use></svg><span>چیزی برای اجرا پیدا نشد.</span>', 'warn');
      return;
    }
    if (state.route !== 'new-invoice') navigate('new-invoice');

    var applied = 0;
    commands.forEach(function (cmd) {
      if (applyVoiceCommand(cmd)) applied++;
    });

    if (applied) {
      collectEditorIntoDraft();
      renderInvoiceLines();
    }
  }

  function initVoice() {
    var card = $('voiceCard');
    var unsupported = $('voiceUnsupported');
    var button = $('voiceButton');

    if (!Voice) return;

    if (!Voice.isSupported()) {
      if (unsupported) unsupported.hidden = false;
      if (button) {
        button.disabled = true;
        button.classList.add('disabled');
      }
      if (card) card.classList.add('unsupported');
    }

    Voice.configure({
      lang: 'fa-IR',
      getProducts: function () {
        return state.products;
      },
      getCustomers: function () {
        return state.customers;
      },
      onState: function (kind, detail) {
        if (kind === 'listening' || kind === 'speaking') voiceUi.setStatus(kind === 'speaking' ? 'در حال شنیدن…' : 'آماده؛ بفرمایید', 'live');
        else if (kind === 'starting') voiceUi.setStatus('در حال اتصال به میکروفن…', 'pending');
        else if (kind === 'error') voiceUi.setStatus(detail.message || 'خطا در تشخیص گفتار', 'error');
        else if (kind === 'unsupported') voiceUi.setStatus('پشتیبانی نمی‌شود', 'error');
        else voiceUi.setStatus('آماده شنیدن', '');
      },
      onTranscript: function (text, isFinal) {
        voiceUi.setTranscript(text);
        if (isFinal) {
          var el = $('voiceTranscript');
          if (el) el.classList.add('final');
          window.setTimeout(function () {
            if (el) el.classList.remove('final');
          }, 700);
        }
      },
      onCommands: handleVoiceCommands,
      onError: function (code, message) {
        toast(message, 'error');
      },
    });

    on(button, 'click', function (ev) {
      ev.preventDefault();
      if (!Voice.isSupported()) {
        toast('مرورگر شما تشخیص گفتار فارسی را پشتیبانی نمی‌کند.', 'error');
        return;
      }
      Voice.toggle();
    });

    // دکمه‌های نمونه — موتور را بدون میکروفن آزمایش می‌کنند
    qsa('[data-sample-voice]').forEach(function (btn) {
      on(btn, 'click', function (ev) {
        ev.preventDefault();
        var sample = btn.getAttribute('data-sample-voice');
        voiceUi.setTranscript(sample);
        handleVoiceCommands(Voice.parse(sample, { products: state.products, customers: state.customers }), sample);
      });
    });

    // شروع سریع از پیشخوان
    document.addEventListener('click', function (ev) {
      var quick = ev.target.closest('[data-action="start-voice-invoice"]');
      if (quick) {
        ev.preventDefault();
        navigate('new-invoice');
        window.setTimeout(function () {
          if (Voice.isSupported()) Voice.start();
          var el = $('voiceCard');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 220);
      }
    });

    // کنش روی پیشنهادهای صوتی
    on($('voiceResults'), 'click', function (ev) {
      var pick = ev.target.closest('[data-voice-pick]');
      if (pick) {
        var product = findProduct(pick.getAttribute('data-voice-pick'));
        if (product) {
          addLine(product, num(pick.getAttribute('data-voice-qty'), 1));
          toast('«' + product.name + '» اضافه شد.', 'success');
        }
        return;
      }
      var makeNew = ev.target.closest('[data-voice-new]');
      if (makeNew) {
        openProductDialog(null);
        $('productName').value = makeNew.getAttribute('data-voice-new');
        $('productPrice').focus();
        return;
      }
      var newCustomer = ev.target.closest('[data-voice-customer]');
      if (newCustomer) openCustomerDialog(null, newCustomer.getAttribute('data-voice-customer'));
    });
  }

  // =======================================================================
  // PWA: نصب، سرویس‌ورکر، وضعیت اتصال
  // =======================================================================

  function initPwa() {
    // ثبت سرویس‌ورکر (مسیر نسبی تا روی زیرپوشه cPanel هم کار کند)
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker
          .register('sw.js')
          .then(function (reg) {
            reg.addEventListener('updatefound', function () {
              var sw = reg.installing;
              if (!sw) return;
              sw.addEventListener('statechange', function () {
                if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                  toast('نسخه جدید برنامه آماده است؛ صفحه را تازه کنید.', 'info', 6000);
                }
              });
            });
          })
          .catch(function (err) {
            console.warn('[factorino] ثبت سرویس‌ورکر ناموفق بود:', err);
          });
      });
    }

    var installButtons = ['installBtn', 'mobileInstallBtn', 'settingsInstallBtn'].map($).filter(Boolean);

    function showInstall(show) {
      installButtons.forEach(function (btn) {
        if (btn.id === 'settingsInstallBtn') btn.disabled = !show;
        else btn.hidden = !show;
      });
      var text = $('pwaStatusText');
      var icon = $('pwaStatusIcon');
      var standalone =
        window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
      if (text) text.textContent = standalone ? 'نصب‌شده روی این دستگاه' : show ? 'آماده نصب' : 'از منوی مرورگر «افزودن به صفحه اصلی» را بزنید';
      if (icon) icon.className = 'status-icon' + (standalone ? ' ok' : '');
    }

    showInstall(false);

    window.addEventListener('beforeinstallprompt', function (ev) {
      ev.preventDefault();
      state.deferredPrompt = ev;
      showInstall(true);
    });

    window.addEventListener('appinstalled', function () {
      state.deferredPrompt = null;
      showInstall(false);
      toast('فاکتورینو روی دستگاه شما نصب شد.', 'success');
    });

    installButtons.forEach(function (btn) {
      on(btn, 'click', function (ev) {
        ev.preventDefault();
        if (!state.deferredPrompt) {
          toast('برای نصب، از منوی مرورگر گزینه «افزودن به صفحه اصلی» را انتخاب کنید.', 'info', 5000);
          return;
        }
        state.deferredPrompt.prompt();
        state.deferredPrompt.userChoice.then(function () {
          state.deferredPrompt = null;
          showInstall(false);
        });
      });
    });

    // نوار آفلاین
    var bar = $('offlineBar');
    function updateOnline() {
      var online = navigator.onLine !== false;
      if (bar) bar.hidden = online;
      document.body.classList.toggle('is-offline', !online);
    }
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    updateOnline();

    // درخواست ذخیره‌سازی پایدار
    DB.persist();
  }

  // =======================================================================
  // راه‌اندازی
  // =======================================================================

  function initGlobalHandlers() {
    on($('printInvoiceBtn'), 'click', function (ev) {
      ev.preventDefault();
      printInvoice();
    });

    // بستن دیالوگ با کلیک روی پس‌زمینه
    qsa('dialog').forEach(function (dialog) {
      on(dialog, 'click', function (ev) {
        if (ev.target === dialog && typeof dialog.close === 'function') dialog.close();
      });
    });

    // ترسیم مجدد نمودارها با تغییر اندازه
    window.addEventListener(
      'resize',
      debounce(function () {
        renderDashboardChart();
        if (state.report) renderReportChart(state.report.rows, state.report.from, state.report.to);
      }, 250)
    );

    // به‌روزرسانی رابط پس از همگام‌سازی
    window.addEventListener('factorino:sync', function (ev) {
      var detail = ev.detail || {};
      if (detail.status === 'done') {
        loadAll().then(renderAll);
      }
      var note = document.querySelector('.storage-note span:last-child');
      if (note) {
        if (detail.status === 'start') note.textContent = 'در حال همگام‌سازی…';
        else if (detail.status === 'done') note.textContent = 'همگام با سرور';
        else if (detail.status === 'offline') note.textContent = 'آفلاین — ذخیره روی دستگاه';
        else if (detail.status === 'error') note.textContent = 'همگام‌سازی ناموفق';
      }
    });
  }

  var booted = false;

  function boot() {
    // در برابر اجرای دوباره (اسکریپت تکراری یا رویداد مضاعف) مقاوم باشیم؛
    // وگرنه شنونده‌های واگذارشده دوبار ثبت و هر کنش دوبار اجرا می‌شود.
    if (booted) return;
    booted = true;

    if (!Auth || !DB || !Sync) {
      console.error('[factorino] فایل‌های پایه بارگذاری نشدند.');
      return;
    }

    // ورود اجباری: در نبود توکن معتبر، به صفحه ورود هدایت می‌شویم
    if (!Auth.requireAuth()) return;

    initRouting();
    initSettings();
    initProducts();
    initCustomers();
    initInvoiceEditor();
    initInvoiceList();
    initReports();
    initVoice();
    initGlobalHandlers();
    initPwa();

    var user = Auth.user();
    if (user && user.businessName && !state.settings.businessName) {
      state.settings.businessName = user.businessName;
    }

    loadAll()
      .then(function () {
        renderAll();
        navigate(currentRoute(), { replace: true });
        state.ready = true;
      })
      .then(function () {
        // اولین همگام‌سازی و سپس زمان‌بندی خودکار
        return Sync.syncNow({ silent: true });
      })
      .then(function () {
        Sync.startAuto();
        return loadAll();
      })
      .then(renderAll)
      .catch(function (err) {
        console.error(err);
        toast('بارگذاری اطلاعات با خطا مواجه شد.', 'error');
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // برای اشکال‌زدایی در کنسول
  window.FactorinoApp = {
    state: state,
    reload: function () {
      return loadAll().then(renderAll);
    },
    navigate: navigate,
    toast: toast,
    money: money,
    jalali: jalaliText,
  };
})();
