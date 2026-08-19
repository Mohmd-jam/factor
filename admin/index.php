<?php
/**
 * فاکتورینو — داشبورد پنل مدیریت
 */

declare(strict_types=1);

require_once __DIR__ . '/_bootstrap.php';

$admin = Auth::requireAdmin('login.php');

$totals = Database::first(
    "SELECT
        (SELECT COUNT(*) FROM users     WHERE deleted_at IS NULL) AS users,
        (SELECT COUNT(*) FROM users     WHERE deleted_at IS NULL AND status = 'active') AS active_users,
        (SELECT COUNT(*) FROM users     WHERE deleted_at IS NULL AND status = 'suspended') AS suspended_users,
        (SELECT COUNT(*) FROM users     WHERE deleted_at IS NULL AND created_at >= ?) AS new_users,
        (SELECT COUNT(*) FROM invoices  WHERE deleted_at IS NULL) AS invoices,
        (SELECT COALESCE(SUM(total),0) FROM invoices WHERE deleted_at IS NULL AND status = 'final') AS revenue,
        (SELECT COUNT(*) FROM products  WHERE deleted_at IS NULL) AS products,
        (SELECT COUNT(*) FROM customers WHERE deleted_at IS NULL) AS customers,
        (SELECT COUNT(*) FROM sessions  WHERE revoked_at IS NULL AND expires_at > ?) AS sessions",
    [date('Y-m-d H:i:s', time() - 2592000), Database::now()]
) ?? [];

$monthRevenue = (float) Database::value(
    "SELECT COALESCE(SUM(total),0) FROM invoices
     WHERE deleted_at IS NULL AND status = 'final' AND issue_date >= ?",
    [date('Y-m-01')]
);

$todayInvoices = (int) Database::value(
    'SELECT COUNT(*) FROM invoices WHERE deleted_at IS NULL AND issue_date = ?',
    [date('Y-m-d')]
);

// فعال‌ترین کاربران
$topUsers = Database::all(
    "SELECT u.id, u.email, u.business_name, u.status, u.last_login_at,
            COUNT(i.id) AS invoice_count,
            COALESCE(SUM(i.total), 0) AS revenue
     FROM users u
     LEFT JOIN invoices i ON i.user_id = u.id AND i.deleted_at IS NULL AND i.status = 'final'
     WHERE u.deleted_at IS NULL AND u.role = 'user'
     GROUP BY u.id, u.email, u.business_name, u.status, u.last_login_at
     ORDER BY revenue DESC, invoice_count DESC
     LIMIT 8"
);

// آخرین کاربران ثبت‌نام‌شده
$newUsers = Database::all(
    'SELECT id, email, business_name, created_at, status
     FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 6'
);

// آخرین رویدادها
$logs = Database::all(
    'SELECT l.action, l.message, l.created_at, l.ip, u.email
     FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id
     ORDER BY l.id DESC LIMIT 10'
);

// نمودار ۶ ماه اخیر
$series = [];
for ($i = 5; $i >= 0; $i--) {
    $ym  = date('Y-m', strtotime("-{$i} months"));
    $row = Database::first(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(total),0) AS amount
         FROM invoices
         WHERE deleted_at IS NULL AND status = 'final' AND issue_date >= ? AND issue_date <= ?",
        [$ym . '-01', date('Y-m-t', strtotime($ym . '-01'))]
    ) ?? ['cnt' => 0, 'amount' => 0];
    $series[] = ['label' => $ym, 'count' => (int) $row['cnt'], 'amount' => (float) $row['amount']];
}
$maxAmount = max(1.0, max(array_column($series, 'amount')));

// وضعیت سلامت سامانه
$failedLogins = (int) Database::value(
    'SELECT COUNT(*) FROM login_attempts WHERE success = 0 AND created_at > ?',
    [date('Y-m-d H:i:s', time() - 86400)]
);
$installerPresent = is_file(APP_ROOT . '/install.php');
$envReadable      = is_file(APP_ROOT . '/.env');
$debugOn          = APP_DEBUG;

$pageTitle = 'داشبورد';
require __DIR__ . '/_layout.php';
?>

<div class="stat-grid">
  <div class="stat">
    <div class="stat-label">کل کاربران</div>
    <div class="stat-value"><?= fa_number($totals['users'] ?? 0) ?></div>
    <div class="stat-foot ok"><?= fa_number($totals['active_users'] ?? 0) ?> فعال ·
      <?= fa_number($totals['suspended_users'] ?? 0) ?> مسدود</div>
  </div>
  <div class="stat">
    <div class="stat-label">فاکتورهای ثبت‌شده</div>
    <div class="stat-value"><?= fa_number($totals['invoices'] ?? 0) ?></div>
    <div class="stat-foot"><?= fa_number($todayInvoices) ?> فاکتور امروز</div>
  </div>
  <div class="stat">
    <div class="stat-label">گردش مالی کل</div>
    <div class="stat-value sm"><?= fa_number($totals['revenue'] ?? 0) ?></div>
    <div class="stat-foot">این ماه: <?= fa_number($monthRevenue) ?></div>
  </div>
  <div class="stat">
    <div class="stat-label">نشست‌های فعال</div>
    <div class="stat-value"><?= fa_number($totals['sessions'] ?? 0) ?></div>
    <div class="stat-foot"><?= fa_number($totals['new_users'] ?? 0) ?> کاربر جدید (۳۰ روز)</div>
  </div>
  <div class="stat">
    <div class="stat-label">محصولات</div>
    <div class="stat-value"><?= fa_number($totals['products'] ?? 0) ?></div>
    <div class="stat-foot">در همه حساب‌ها</div>
  </div>
  <div class="stat">
    <div class="stat-label">مشتریان</div>
    <div class="stat-value"><?= fa_number($totals['customers'] ?? 0) ?></div>
    <div class="stat-foot">در همه حساب‌ها</div>
  </div>
</div>

<section class="card">
  <div class="card-head">
    <h2>روند فروش ۶ ماه اخیر</h2>
  </div>
  <div class="chart">
    <?php foreach ($series as $s): ?>
      <div class="chart-col" title="<?= e($s['label']) ?> — <?= fa_number($s['amount']) ?>">
        <div class="chart-bar" style="height:<?= max(3, (int) round($s['amount'] / $maxAmount * 100)) ?>%"></div>
        <div class="chart-amount"><?= fa_number($s['count']) ?></div>
        <div class="chart-label"><?= e($s['label']) ?></div>
      </div>
    <?php endforeach; ?>
  </div>
</section>

<section class="card">
  <div class="card-head"><h2>وضعیت امنیتی سامانه</h2></div>
  <ul class="health">
    <li class="<?= $installerPresent ? 'warn' : 'good' ?>">
      <?= $installerPresent
        ? '⚠ فایل install.php هنوز روی سرور است — آن را حذف کنید.'
        : '✔ فایل نصب‌کننده حذف شده است.' ?>
    </li>
    <li class="<?= $debugOn ? 'warn' : 'good' ?>">
      <?= $debugOn
        ? '⚠ حالت اشکال‌زدایی روشن است — در محیط عملیاتی APP_DEBUG=false بگذارید.'
        : '✔ حالت اشکال‌زدایی خاموش است.' ?>
    </li>
    <li class="<?= is_https() ? 'good' : 'warn' ?>">
      <?= is_https()
        ? '✔ اتصال از طریق HTTPS برقرار است.'
        : '⚠ اتصال HTTPS نیست — روی هاست عملیاتی گواهی SSL فعال کنید.' ?>
    </li>
    <li class="<?= $failedLogins > 50 ? 'warn' : 'good' ?>">
      <?= $failedLogins > 50 ? '⚠ ' : '✔ ' ?>
      <?= fa_number($failedLogins) ?> تلاش ناموفق ورود در ۲۴ ساعت گذشته.
    </li>
    <li class="<?= $envReadable ? 'good' : 'warn' ?>">
      <?= $envReadable ? '✔ فایل .env موجود است.' : '⚠ فایل .env پیدا نشد.' ?>
    </li>
  </ul>
</section>

<div class="two-col">
  <section class="card">
    <div class="card-head">
      <h2>فعال‌ترین کاربران</h2>
      <a class="link" href="users.php">همه کاربران ←</a>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>کسب‌وکار</th><th>فاکتور</th><th>گردش مالی</th><th>آخرین ورود</th></tr></thead>
        <tbody>
        <?php if ($topUsers === []): ?>
          <tr><td colspan="4" class="empty">هنوز کاربری فعالیتی نداشته است.</td></tr>
        <?php endif; ?>
        <?php foreach ($topUsers as $u): ?>
          <tr>
            <td data-label="کسب‌وکار">
              <a class="link" href="user.php?id=<?= (int) $u['id'] ?>"><?= e((string) $u['business_name']) ?></a>
              <div class="muted sm"><?= e((string) $u['email']) ?></div>
            </td>
            <td data-label="فاکتور"><?= fa_number($u['invoice_count']) ?></td>
            <td data-label="گردش مالی"><?= fa_number($u['revenue']) ?></td>
            <td data-label="آخرین ورود" class="muted sm"><?= e(fa_ago($u['last_login_at'])) ?></td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h2>تازه‌واردها</h2></div>
    <ul class="feed">
      <?php if ($newUsers === []): ?><li class="empty">کاربری ثبت نشده است.</li><?php endif; ?>
      <?php foreach ($newUsers as $u): ?>
        <li>
          <div>
            <a class="link" href="user.php?id=<?= (int) $u['id'] ?>"><?= e((string) $u['business_name']) ?></a>
            <span class="badge <?= $u['status'] === 'active' ? 'badge-ok' : 'badge-err' ?>">
              <?= $u['status'] === 'active' ? 'فعال' : 'مسدود' ?>
            </span>
          </div>
          <div class="muted sm"><?= e((string) $u['email']) ?> · <?= e(fa_ago($u['created_at'])) ?></div>
        </li>
      <?php endforeach; ?>
    </ul>
  </section>
</div>

<section class="card">
  <div class="card-head">
    <h2>آخرین رویدادها</h2>
    <a class="link" href="activity.php">گزارش کامل ←</a>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>رویداد</th><th>کاربر</th><th>توضیح</th><th>IP</th><th>زمان</th></tr></thead>
      <tbody>
      <?php if ($logs === []): ?>
        <tr><td colspan="5" class="empty">رویدادی ثبت نشده است.</td></tr>
      <?php endif; ?>
      <?php foreach ($logs as $l): ?>
        <tr>
          <td data-label="رویداد"><span class="chip"><?= e((string) $l['action']) ?></span></td>
          <td data-label="کاربر" class="sm"><?= e((string) ($l['email'] ?? '—')) ?></td>
          <td data-label="توضیح" class="sm"><?= e((string) $l['message']) ?></td>
          <td data-label="IP" class="sm muted" dir="ltr"><?= e((string) $l['ip']) ?></td>
          <td data-label="زمان" class="sm muted"><?= e(fa_ago($l['created_at'])) ?></td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
  </div>
</section>

<?php admin_layout_end(); ?>
