/* =========================================================================
 * فاکتورینو — لایه احراز هویت و ارتباط با API
 *
 * این فایل هم در صفحه ورود (login.html) و هم در برنامه اصلی (index.html)
 * بارگذاری می‌شود و شیء سراسری `window.FactorinoAuth` را فراهم می‌کند.
 * ========================================================================= */
(function () {
  'use strict';

  // ---------------------------------------------------------------- ثابت‌ها
  var TOKEN_KEY = 'factorino_token';
  var USER_KEY = 'factorino_user';
  var CSRF_COOKIE = 'factorino_csrf';
  var API_BASE = 'api/';

  // مسیر پایه را از محل خود اسکریپت پیدا می‌کنیم تا هم روی
  // http://localhost/factorino/ و هم روی ریشه دامنه درست کار کند.
  (function detectBase() {
    try {
      var cur = document.currentScript;
      if (!cur) {
        var list = document.getElementsByTagName('script');
        cur = list[list.length - 1];
      }
      if (cur && cur.src) {
        var url = new URL(cur.src, window.location.href);
        // .../js/auth.js  →  .../
        API_BASE = url.pathname.replace(/js\/auth\.js.*$/, '') + 'api/';
      }
    } catch (e) {
      /* بی‌خیال؛ مسیر نسبی پیش‌فرض استفاده می‌شود */
    }
  })();

  // ------------------------------------------------------------ ابزار عمومی
  function readCookie(name) {
    var parts = ('; ' + document.cookie).split('; ' + name + '=');
    if (parts.length === 2) {
      return decodeURIComponent(parts.pop().split(';').shift());
    }
    return '';
  }

  function safeGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      if (value === null || value === undefined) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, value);
      }
    } catch (e) {
      /* حالت مرور خصوصی */
    }
  }

  /** تبدیل ارقام فارسی/عربی به لاتین (برای ایمیل و شماره تماس) */
  function toLatinDigits(str) {
    if (typeof str !== 'string') return '';
    var fa = '۰۱۲۳۴۵۶۷۸۹';
    var ar = '٠١٢٣٤٥٦٧٨٩';
    return str.replace(/[۰-۹٠-٩]/g, function (ch) {
      var i = fa.indexOf(ch);
      if (i > -1) return String(i);
      i = ar.indexOf(ch);
      return i > -1 ? String(i) : ch;
    });
  }

  // ---------------------------------------------------------------- وضعیت
  var state = {
    token: safeGet(TOKEN_KEY) || '',
    csrf: readCookie(CSRF_COOKIE) || '',
    user: null,
  };

  try {
    var rawUser = safeGet(USER_KEY);
    if (rawUser) state.user = JSON.parse(rawUser);
  } catch (e) {
    state.user = null;
  }

  function setSession(token, user) {
    state.token = token || '';
    safeSet(TOKEN_KEY, state.token || null);
    if (user) {
      state.user = user;
      safeSet(USER_KEY, JSON.stringify(user));
    }
  }

  function clearSession() {
    state.token = '';
    state.user = null;
    safeSet(TOKEN_KEY, null);
    safeSet(USER_KEY, null);
  }

  // ------------------------------------------------------------------ خطا
  function ApiError(message, status, fields) {
    this.name = 'ApiError';
    this.message = message || 'خطای ناشناخته';
    this.status = status || 0;
    this.fields = fields || null;
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  /** پیام خطای خوانا برای کاربر */
  function friendlyError(err) {
    if (err && err.name === 'ApiError') return err.message;
    if (!navigator.onLine) return 'اتصال اینترنت برقرار نیست. تغییرات به‌صورت آفلاین ذخیره می‌شود.';
    return 'ارتباط با سرور برقرار نشد. کمی بعد دوباره تلاش کنید.';
  }

  // ------------------------------------------------------------------ CSRF
  var csrfPromise = null;

  function ensureCsrf(force) {
    var cookie = readCookie(CSRF_COOKIE);
    if (cookie && !force) {
      state.csrf = cookie;
      return Promise.resolve(cookie);
    }
    if (csrfPromise && !force) return csrfPromise;

    csrfPromise = fetch(API_BASE + 'auth.php?action=csrf', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
      .then(function (res) {
        return res.json().catch(function () {
          return {};
        });
      })
      .then(function (json) {
        var token = (json && json.data && json.data.csrf) || readCookie(CSRF_COOKIE) || '';
        state.csrf = token;
        csrfPromise = null;
        return token;
      })
      .catch(function () {
        csrfPromise = null;
        return readCookie(CSRF_COOKIE) || '';
      });

    return csrfPromise;
  }

  // ------------------------------------------------------------- درخواست‌ها
  /**
   * فراخوانی API.
   * @param {string} path  مثل 'auth.php?action=login'
   * @param {object} opts  { method, body, retryCsrf, timeout }
   */
  function request(path, opts) {
    opts = opts || {};
    var method = (opts.method || 'GET').toUpperCase();
    var needsCsrf = method !== 'GET' && method !== 'HEAD';

    var pre = needsCsrf ? ensureCsrf(false) : Promise.resolve('');

    return pre.then(function () {
      var headers = { Accept: 'application/json' };
      if (opts.body !== undefined && opts.body !== null) {
        headers['Content-Type'] = 'application/json; charset=utf-8';
      }
      if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
      if (needsCsrf && state.csrf) headers['X-CSRF-Token'] = state.csrf;

      var controller = null;
      var timer = null;
      if (typeof AbortController !== 'undefined') {
        controller = new AbortController();
        timer = setTimeout(function () {
          controller.abort();
        }, opts.timeout || 25000);
      }

      return fetch(API_BASE + path, {
        method: method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: headers,
        signal: controller ? controller.signal : undefined,
        body: opts.body !== undefined && opts.body !== null ? JSON.stringify(opts.body) : undefined,
      })
        .then(function (res) {
          if (timer) clearTimeout(timer);
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (json) {
              return { res: res, json: json };
            });
        })
        .then(function (out) {
          var res = out.res;
          var json = out.json;

          if (res.ok && json && json.success !== false) {
            return json.data !== undefined ? json.data : json;
          }

          var message = (json && (json.error || json.message)) || 'خطای سرور (' + res.status + ')';

          // توکن CSRF منقضی شده → یک بار تلاش مجدد
          if (res.status === 419 && !opts.retryCsrf) {
            return ensureCsrf(true).then(function () {
              return request(path, Object.assign({}, opts, { retryCsrf: true }));
            });
          }

          if (res.status === 401) {
            clearSession();
            if (!opts.silent401) redirectToLogin();
          }

          throw new ApiError(message, res.status, json && json.fields ? json.fields : null);
        })
        .catch(function (err) {
          if (timer) clearTimeout(timer);
          if (err && err.name === 'ApiError') throw err;
          if (err && err.name === 'AbortError') {
            throw new ApiError('پاسخی از سرور دریافت نشد (زمان انتظار تمام شد).', 0);
          }
          throw new ApiError(friendlyError(err), 0);
        });
    });
  }

  function loginUrl() {
    var path = window.location.pathname.replace(/[^/]*$/, '');
    return path + 'login.html';
  }

  function appUrl() {
    var path = window.location.pathname.replace(/[^/]*$/, '');
    return path + 'index.html';
  }

  var redirecting = false;
  function redirectToLogin() {
    if (redirecting) return;
    redirecting = true;
    window.location.replace(loginUrl());
  }

  // ------------------------------------------------------------ عملیات اصلی
  function login(email, password) {
    return request('auth.php?action=login', {
      method: 'POST',
      body: { email: toLatinDigits(String(email || '')).trim(), password: String(password || '') },
    }).then(function (data) {
      setSession(data.token, data.user);
      if (data.csrf) state.csrf = data.csrf;
      return data;
    });
  }

  function register(payload) {
    return request('auth.php?action=register', {
      method: 'POST',
      body: {
        email: toLatinDigits(String(payload.email || '')).trim(),
        password: String(payload.password || ''),
        businessName: String(payload.businessName || '').trim(),
        ownerName: String(payload.ownerName || '').trim(),
        phone: toLatinDigits(String(payload.phone || '')).trim(),
      },
    }).then(function (data) {
      setSession(data.token, data.user);
      if (data.csrf) state.csrf = data.csrf;
      return data;
    });
  }

  function logout(options) {
    var opts = options || {};
    return request('auth.php?action=logout', { method: 'POST', body: {}, silent401: true })
      .catch(function () {
        /* حتی اگر سرور در دسترس نبود، نشست محلی پاک می‌شود */
      })
      .then(function () {
        clearSession();
        if (opts.keepLocalData !== true && typeof window.FactorinoDB !== 'undefined' && window.FactorinoDB.clearAll) {
          return window.FactorinoDB.clearAll().catch(function () {});
        }
      })
      .then(function () {
        if (opts.redirect !== false) window.location.replace(loginUrl());
      });
  }

  function profile() {
    return request('auth.php?action=profile', { method: 'GET', silent401: true }).then(function (data) {
      if (data && data.user) {
        state.user = data.user;
        safeSet(USER_KEY, JSON.stringify(data.user));
      }
      if (data && data.csrf) state.csrf = data.csrf;
      return data;
    });
  }

  function changePassword(currentPassword, newPassword) {
    return request('auth.php?action=password', {
      method: 'POST',
      body: { currentPassword: currentPassword, newPassword: newPassword },
    }).then(function (data) {
      if (data && data.token) setSession(data.token, null);
      return data;
    });
  }

  /** اگر توکن نداریم به صفحه ورود می‌رویم. برای index.html */
  function requireAuth() {
    if (!state.token) {
      redirectToLogin();
      return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- خروجی
  var Auth = {
    TOKEN_KEY: TOKEN_KEY,
    ApiError: ApiError,
    apiBase: function () {
      return API_BASE;
    },
    request: request,
    ensureCsrf: ensureCsrf,
    login: login,
    register: register,
    logout: logout,
    profile: profile,
    changePassword: changePassword,
    requireAuth: requireAuth,
    friendlyError: friendlyError,
    toLatinDigits: toLatinDigits,
    loginUrl: loginUrl,
    appUrl: appUrl,
    isLoggedIn: function () {
      return !!state.token;
    },
    token: function () {
      return state.token;
    },
    user: function () {
      return state.user;
    },
    setUser: function (user) {
      state.user = user;
      safeSet(USER_KEY, JSON.stringify(user));
    },
    clearSession: clearSession,
  };

  window.FactorinoAuth = Auth;

  /* =======================================================================
   * بخش دوم: منطق صفحه login.html
   * (فقط وقتی اجرا می‌شود که عناصر آن صفحه وجود داشته باشند)
   * ===================================================================== */
  function initLoginPage() {
    var loginFormWrap = document.getElementById('loginForm');
    var registerFormWrap = document.getElementById('registerForm');
    var loginForm = document.getElementById('loginFormElement');
    var registerForm = document.getElementById('registerFormElement');
    if (!loginForm || !registerForm) return;

    var overlay = document.getElementById('loadingOverlay');
    var loadingText = document.getElementById('loadingText');
    var toastEl = document.getElementById('toast');
    var showRegister = document.getElementById('showRegister');
    var showLogin = document.getElementById('showLogin');
    var loginBtn = document.getElementById('loginBtn');
    var registerBtn = document.getElementById('registerBtn');

    var toastTimer = null;
    function toast(message, type) {
      if (!toastEl) return;
      toastEl.textContent = message;
      toastEl.className = 'toast ' + (type || '');
      toastEl.hidden = false;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        toastEl.hidden = true;
      }, type === 'error' ? 6000 : 3500);
    }

    function busy(on, text) {
      if (overlay) overlay.hidden = !on;
      if (loadingText && text) loadingText.textContent = text;
      [loginBtn, registerBtn].forEach(function (btn) {
        if (btn) btn.disabled = !!on;
      });
    }

    function markFields(fields) {
      if (!fields) return;
      var map = {
        email: ['loginEmail', 'registerEmail'],
        password: ['loginPassword', 'registerPassword'],
        businessName: ['registerBusinessName'],
        ownerName: ['registerOwner'],
        phone: ['registerPhone'],
      };
      Object.keys(fields).forEach(function (key) {
        if (!fields[key]) return;
        (map[key] || []).forEach(function (id) {
          var el = document.getElementById(id);
          if (el && el.offsetParent !== null) {
            el.setAttribute('aria-invalid', 'true');
            el.focus();
          }
        });
      });
    }

    function clearInvalid(form) {
      Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (el) {
        el.removeAttribute('aria-invalid');
      });
    }

    function switchTo(which) {
      var toRegister = which === 'register';
      if (loginFormWrap) loginFormWrap.hidden = toRegister;
      if (registerFormWrap) registerFormWrap.hidden = !toRegister;
      var first = document.getElementById(toRegister ? 'registerBusinessName' : 'loginEmail');
      if (first) setTimeout(function () { first.focus(); }, 60);
      try {
        history.replaceState(null, '', toRegister ? '#register' : '#login');
      } catch (e) {}
    }

    if (showRegister) {
      showRegister.addEventListener('click', function (ev) {
        ev.preventDefault();
        switchTo('register');
      });
    }
    if (showLogin) {
      showLogin.addEventListener('click', function (ev) {
        ev.preventDefault();
        switchTo('login');
      });
    }
    if (window.location.hash === '#register') switchTo('register');

    // نشانگر قدرت رمز عبور در فرم ثبت‌نام
    var pwInput = document.getElementById('registerPassword');
    if (pwInput && pwInput.parentNode) {
      var meter = document.createElement('div');
      meter.className = 'pw-meter';
      meter.setAttribute('aria-hidden', 'true');
      meter.innerHTML = '<span></span><span></span><span></span><span></span>';
      var hint = document.createElement('p');
      hint.className = 'pw-hint';
      hint.textContent = 'رمز عبور باید حداقل ۸ کاراکتر باشد.';
      pwInput.parentNode.appendChild(meter);
      pwInput.parentNode.appendChild(hint);

      pwInput.addEventListener('input', function () {
        var v = pwInput.value || '';
        var score = 0;
        if (v.length >= 8) score++;
        if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
        if (/[0-9]/.test(v)) score++;
        if (/[^A-Za-z0-9]/.test(v) || v.length >= 14) score++;
        if (v.length < 8) score = Math.min(score, 1);
        meter.setAttribute('data-score', String(score));
        hint.textContent =
          v.length === 0
            ? 'رمز عبور باید حداقل ۸ کاراکتر باشد.'
            : v.length < 8
            ? 'خیلی کوتاه است؛ حداقل ۸ کاراکتر لازم است.'
            : ['بسیار ضعیف', 'ضعیف', 'متوسط', 'خوب', 'عالی'][score];
      });
    }

    // اگر از قبل وارد شده‌ایم، مستقیم به برنامه برویم
    if (Auth.isLoggedIn()) {
      busy(true, 'در حال بررسی نشست...');
      Auth.profile()
        .then(function () {
          window.location.replace(appUrl());
        })
        .catch(function () {
          clearSession();
          busy(false);
        });
    } else {
      ensureCsrf(false);
    }

    loginForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      clearInvalid(loginForm);
      var email = (document.getElementById('loginEmail') || {}).value || '';
      var password = (document.getElementById('loginPassword') || {}).value || '';

      if (!email.trim() || !password) {
        toast('ایمیل و رمز عبور را وارد کنید.', 'error');
        return;
      }

      busy(true, 'در حال ورود...');
      Auth.login(email, password)
        .then(function () {
          toast('خوش آمدید! در حال انتقال...', 'success');
          window.location.replace(appUrl());
        })
        .catch(function (err) {
          busy(false);
          toast(Auth.friendlyError(err), 'error');
          markFields(err && err.fields);
          var pw = document.getElementById('loginPassword');
          if (pw && err && err.status === 401) {
            pw.value = '';
            pw.focus();
          }
        });
    });

    registerForm.addEventListener('submit', function (ev) {
      ev.preventDefault();
      clearInvalid(registerForm);

      var payload = {
        businessName: (document.getElementById('registerBusinessName') || {}).value || '',
        email: (document.getElementById('registerEmail') || {}).value || '',
        password: (document.getElementById('registerPassword') || {}).value || '',
        ownerName: (document.getElementById('registerOwner') || {}).value || '',
        phone: (document.getElementById('registerPhone') || {}).value || '',
      };

      if (payload.password.length < 8) {
        toast('رمز عبور باید حداقل ۸ کاراکتر باشد.', 'error');
        var p = document.getElementById('registerPassword');
        if (p) p.focus();
        return;
      }

      busy(true, 'در حال ساخت حساب...');
      Auth.register(payload)
        .then(function () {
          toast('حساب شما ساخته شد. خوش آمدید!', 'success');
          window.location.replace(appUrl());
        })
        .catch(function (err) {
          busy(false);
          toast(Auth.friendlyError(err), 'error');
          markFields(err && err.fields);
        });
    });

    // پانوشت کوچک با لینک نصب/پنل مدیریت
    var container = document.querySelector('.login-container');
    if (container && !container.querySelector('.login-foot')) {
      var foot = document.createElement('div');
      foot.className = 'login-foot';
      foot.innerHTML =
        '<span>فاکتورینو نسخه ۳ — بدون نیاز به اینترنت کار می‌کند</span>' +
        '<a href="admin/login.php">ورود مدیر</a>';
      container.appendChild(foot);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLoginPage);
  } else {
    initLoginPage();
  }
})();
