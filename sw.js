/* =========================================================================
 * فاکتورینو — سرویس‌ورکر
 *
 * راهبرد:
 *   • پوسته برنامه: cache-first با به‌روزرسانی پس‌زمینه (stale-while-revalidate)
 *   • ناوبری: network-first با بازگشت به نسخه کش‌شده (پشتیبانی آفلاین)
 *   • درخواست‌های api/ : هرگز کش نمی‌شوند (داده حساس و متغیر)
 *
 * توجه: همه مسیرها نسبی‌اند تا برنامه هم روی ریشه دامنه و هم داخل
 * زیرپوشه (مثل /factorino/ روی هاست اشتراکی cPanel) کار کند.
 * ========================================================================= */

const VERSION = '3.0.0';
const SHELL_CACHE = `factorino-shell-v${VERSION}`;
const RUNTIME_CACHE = `factorino-runtime-v${VERSION}`;

/** فایل‌هایی که برای اجرای آفلاین لازم‌اند. */
const APP_SHELL = [
  './',
  './index.html',
  './login.html',
  './css/styles.css',
  './css/login.css',
  './js/auth.js',
  './js/db.js',
  './js/sync.js',
  './js/voice.js',
  './js/app.js',
  './manifest.webmanifest',
  './assets/favicon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
];

// ---------------------------------------------------------------- نصب
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      // تک‌تک اضافه می‌کنیم تا نبودِ یک فایل کل نصب را شکست ندهد
      // (addAll اتمی است و با اولین ۴۰۴ همه چیز را برمی‌گرداند).
      await Promise.all(
        APP_SHELL.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            console.warn('[sw] کش نشد:', url, err && err.message);
          })
        )
      );
      await self.skipWaiting();
    })
  );
});

// -------------------------------------------------------------- فعال‌سازی
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('factorino-') && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      );

      // ناوبری‌ها را در صورت پشتیبانی سریع‌تر می‌کند
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch (e) {
          /* بی‌اهمیت */
        }
      }

      await self.clients.claim();
    })()
  );
});

// ------------------------------------------------------------------ کمکی
/** آیا این درخواست به API می‌رود؟ (نباید کش شود) */
function isApiRequest(url) {
  return /\/api\//.test(url.pathname) || /\.php($|\?)/.test(url.pathname);
}

/** آیا بخشی از پوسته ثابت است؟ */
function isShellAsset(request, url) {
  if (['style', 'script', 'font', 'manifest'].includes(request.destination)) return true;
  return /\.(?:css|js|woff2?|svg|png|webmanifest)$/.test(url.pathname);
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response && response.ok && response.type !== 'opaque') {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  return cached || network.then((r) => r || Response.error());
}

// ----------------------------------------------------------------- fetch
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // فقط GET همان‌مبدأ
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  // API هرگز کش نمی‌شود — همیشه مستقیم به شبکه
  if (isApiRequest(url)) return;

  // پنل مدیریت سمت سرور رندر می‌شود؛ دخالتی نمی‌کنیم
  if (/\/admin\//.test(url.pathname)) return;

  // ناوبری: شبکه اول، سپس کش (تا کاربر همیشه آخرین نسخه را ببیند)
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse;
          if (preloaded) return preloaded;

          const fresh = await fetch(request);
          if (fresh && fresh.ok) {
            const cache = await caches.open(SHELL_CACHE);
            cache.put(request, fresh.clone()).catch(() => {});
          }
          return fresh;
        } catch (e) {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match(request)) ||
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            new Response('<h1 dir="rtl" style="font-family:sans-serif;text-align:center;padding:3rem">آفلاین هستید</h1>', {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
              status: 503,
            })
          );
        }
      })()
    );
    return;
  }

  // دارایی‌های ثابت
  if (isShellAsset(request, url)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
    return;
  }

  // بقیه (تصاویر و…): کش اول، سپس شبکه
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response && response.ok && request.destination === 'image') {
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      } catch (e) {
        return Response.error();
      }
    })()
  );
});

// ------------------------------------------------------------------ پیام
self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'CLEAR_CACHES') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});
