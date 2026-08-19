<?php
/**
 * فاکتورینو — قالب مشترک پنل مدیریت
 *
 * استفاده:
 *   $pageTitle = 'داشبورد';
 *   require __DIR__ . '/_layout.php';   // شروع
 *   ... محتوا ...
 *   admin_layout_end();
 */

declare(strict_types=1);

if (!isset($admin) || !is_array($admin)) {
    $admin = Auth::requireAdmin('login.php');
}

$pageTitle = $pageTitle ?? 'پنل مدیریت';
$current   = admin_page();

$menu = [
    'index'    => ['داشبورد',        'M3 12l9-9 9 9M5 10v10h14V10'],
    'users'    => ['کاربران',        'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8'],
    'invoices' => ['فاکتورها',       'M7 3h10l4 4v14H3V3h4zM8 12h8M8 16h5'],
    'activity' => ['گزارش رویدادها', 'M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0'],
    'settings' => ['تنظیمات سامانه', 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 008 19.4'],
];
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#4f46e5">
<title><?= e($pageTitle) ?> — پنل مدیریت فاکتورینو</title>
<link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="admin.css">
</head>
<body>

<a class="skip-link" href="#main">پرش به محتوای اصلی</a>

<header class="topbar">
  <button class="burger" type="button" id="burger" aria-label="باز کردن منو" aria-expanded="false" aria-controls="sidebar">
    <span></span><span></span><span></span>
  </button>
  <div class="brand">
    <span class="brand-dot"></span>
    <strong>فاکتورینو</strong>
    <span class="brand-sub">پنل مدیریت</span>
  </div>
  <div class="topbar-spacer"></div>
  <div class="who">
    <span class="who-name"><?= e((string) ($admin['owner_name'] ?: $admin['email'])) ?></span>
    <span class="who-role">مدیر کل</span>
  </div>
  <form method="post" action="logout.php" class="logout-form">
    <?= Csrf::field() ?>
    <button type="submit" class="btn-logout" title="خروج از حساب">خروج</button>
  </form>
</header>

<div class="shell">
  <nav class="sidebar" id="sidebar" aria-label="منوی اصلی">
    <ul>
      <?php foreach ($menu as $slug => [$label, $icon]): ?>
        <li>
          <a href="<?= e($slug) ?>.php" class="<?= $current === $slug ? 'active' : '' ?>">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="<?= e($icon) ?>"/></svg>
            <span><?= e($label) ?></span>
          </a>
        </li>
      <?php endforeach; ?>
      <li class="sep"></li>
      <li>
        <a href="../index.html" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/>
          </svg>
          <span>باز کردن برنامه</span>
        </a>
      </li>
    </ul>
    <div class="sidebar-foot">نسخه <?= e(APP_VERSION) ?></div>
  </nav>

  <div class="scrim" id="scrim" hidden></div>

  <main class="main" id="main">
    <h1 class="page-title"><?= e($pageTitle) ?></h1>

    <?php foreach (flash_from_query() as [$type, $msg]): ?>
      <div class="alert alert-<?= $type === 'ok' ? 'ok' : 'err' ?>" role="status"><?= e($msg) ?></div>
    <?php endforeach; ?>
<?php
// -------- محتوای صفحه از اینجا ادامه پیدا می‌کند --------

function admin_layout_end(): void
{
    ?>
  </main>
</div>

<script>
(function () {
  var burger = document.getElementById('burger');
  var sidebar = document.getElementById('sidebar');
  var scrim = document.getElementById('scrim');
  function setOpen(open) {
    sidebar.classList.toggle('open', open);
    scrim.hidden = !open;
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.style.overflow = open ? 'hidden' : '';
  }
  burger.addEventListener('click', function () {
    setOpen(!sidebar.classList.contains('open'));
  });
  scrim.addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setOpen(false);
  });
  window.addEventListener('resize', function () {
    if (window.innerWidth > 900) setOpen(false);
  });

  // تأیید قبل از عملیات خطرناک
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!window.confirm(f.getAttribute('data-confirm'))) e.preventDefault();
    });
  });
})();
</script>
</body>
</html>
    <?php
}
