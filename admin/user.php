<?php
/**
 * فاکتورینو — جزئیات یک کاربر
 */

declare(strict_types=1);

require_once __DIR__ . '/_bootstrap.php';

$admin   = Auth::requireAdmin('login.php');
$adminId = (int) $admin['id'];

$userId = to_int($_GET['id'] ?? 0);
if ($userId <= 0) {
    redirect_with('users.php', 'err', 'شناسه کاربر نامعتبر است.');
}

$user = Database::first('SELECT * FROM users WHERE id = ?', [$userId]);
if ($user === null) {
    redirect_with('users.php', 'err', 'کاربر پیدا نشد.');
}

$self = $userId === $adminId;

// ---------------------------------------------------------------------------
// عملیات
// ---------------------------------------------------------------------------
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    Csrf::requireValid([], false);
    $op   = (string) ($_POST['op'] ?? '');
    $back = 'user.php?id=' . $userId;

    if ($op === 'note') {
        $note = clean_string($_POST['note'] ?? '', 255);
        Database::run('UPDATE users SET note = ?, updated_at = ? WHERE id = ?', [$note, Database::now(), $userId]);
        log_activity($userId, $adminId, 'admin_note', 'به‌روزرسانی یادداشت داخلی');
        redirect_with($back, 'ok', 'یادداشت ذخیره شد.');
    }

    if ($self) {
        redirect_with($back, 'err', 'روی حساب خودتان نمی‌توانید این عملیات را انجام دهید.');
    }

    switch ($op) {
        case 'suspend':
            Database::run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', ['suspended', Database::now(), $userId]);
            Auth::revokeAllSessions($userId);
            log_activity($userId, $adminId, 'admin_suspend', 'مسدودسازی حساب توسط مدیر');
            redirect_with($back, 'ok', 'حساب مسدود شد.');
            break;

        case 'activate':
            Database::run(
                'UPDATE users SET status = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
                ['active', Database::now(), $userId]
            );
            log_activity($userId, $adminId, 'admin_activate', 'فعال‌سازی حساب توسط مدیر');
            redirect_with($back, 'ok', 'حساب فعال شد.');
            break;

        case 'logout_all':
            Auth::revokeAllSessions($userId);
            log_activity($userId, $adminId, 'admin_logout_all', 'خروج اجباری از همه دستگاه‌ها');
            redirect_with($back, 'ok', 'همه نشست‌های کاربر بسته شد.');
            break;

        case 'reset_password':
            $newPass = (string) ($_POST['new_password'] ?? '');
            $problem = password_problem($newPass);
            if ($problem !== null) {
                redirect_with($back, 'err', $problem);
            }
            Database::run(
                'UPDATE users SET password_hash = ?, password_changed_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?',
                [hash_password($newPass), Database::now(), $userId]
            );
            Auth::revokeAllSessions($userId);
            log_activity($userId, $adminId, 'admin_reset_password', 'بازنشانی رمز عبور توسط مدیر');
            redirect_with($back, 'ok', 'رمز عبور جدید ثبت شد و کاربر از همه دستگاه‌ها خارج شد.');
            break;

        case 'delete':
            Database::run(
                'UPDATE users SET deleted_at = ?, status = ?, updated_at = ? WHERE id = ?',
                [Database::now(), 'suspended', Database::now(), $userId]
            );
            Auth::revokeAllSessions($userId);
            log_activity($userId, $adminId, 'admin_delete_user', 'حذف حساب: ' . $user['email']);
            redirect_with('users.php', 'ok', 'حساب حذف شد.');
            break;

        case 'restore':
            Database::run(
                'UPDATE users SET deleted_at = NULL, status = ?, updated_at = ? WHERE id = ?',
                ['active', Database::now(), $userId]
            );
            log_activity($userId, $adminId, 'admin_restore_user', 'بازیابی حساب: ' . $user['email']);
            redirect_with($back, 'ok', 'حساب بازیابی شد.');
            break;

        case 'make_admin':
            Database::run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', ['admin', Database::now(), $userId]);
            log_activity($userId, $adminId, 'admin_grant', 'ارتقا به مدیر');
            redirect_with($back, 'ok', 'دسترسی مدیریت داده شد.');
            break;

        case 'revoke_admin':
            Database::run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', ['user', Database::now(), $userId]);
            Auth::revokeAllSessions($userId);
            log_activity($userId, $adminId, 'admin_revoke', 'سلب دسترسی مدیریت');
            redirect_with($back, 'ok', 'دسترسی مدیریت گرفته شد.');
            break;

        default:
            redirect_with($back, 'err', 'عملیات نامعتبر است.');
    }
}

// ---------------------------------------------------------------------------
// داده‌های نمایش
// ---------------------------------------------------------------------------
$settings = Database::first('SELECT * FROM user_settings WHERE user_id = ?', [$userId]);

$stats = Database::first(
    "SELECT
        (SELECT COUNT(*) FROM products  WHERE user_id = ? AND deleted_at IS NULL) AS products,
        (SELECT COUNT(*) FROM customers WHERE user_id = ? AND deleted_at IS NULL) AS customers,
        (SELECT COUNT(*) FROM invoices  WHERE user_id = ? AND deleted_at IS NULL) AS invoices,
        (SELECT COALESCE(SUM(total),0) FROM invoices
          WHERE user_id = ? AND deleted_at IS NULL AND status = 'final') AS revenue,
        (SELECT COALESCE(SUM(total),0) FROM invoices
          WHERE user_id = ? AND deleted_at IS NULL AND status = 'final' AND payment_status <> 'paid') AS unpaid",
    [$userId, $userId, $userId, $userId, $userId]
) ?? [];

$sessions = Database::all(
    'SELECT id, scope, ip, user_agent, created_at, last_seen_at, expires_at
     FROM sessions
     WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
     ORDER BY last_seen_at DESC LIMIT 10',
    [$userId, Database::now()]
);

$invoices = Database::all(
    'SELECT uuid, number, customer_name, issue_date, total, status, payment_status
     FROM invoices WHERE user_id = ? AND deleted_at IS NULL
     ORDER BY issue_date DESC, id DESC LIMIT 15',
    [$userId]
);

$logs = Database::all(
    'SELECT action, message, ip, created_at FROM activity_logs
     WHERE user_id = ? ORDER BY id DESC LIMIT 20',
    [$userId]
);

$loginFails = (int) Database::value(
    'SELECT COUNT(*) FROM login_attempts WHERE email = ? AND success = 0 AND created_at > ?',
    [$user['email'], date('Y-m-d H:i:s', time() - 86400)]
);

$pageTitle = 'کاربر: ' . (string) $user['business_name'];
require __DIR__ . '/_layout.php';
?>

<p class="breadcrumb"><a class="link" href="users.php">← بازگشت به فهرست کاربران</a></p>

<?php if ($user['deleted_at'] !== null): ?>
  <div class="alert alert-err">این حساب حذف شده است (حذف نرم). داده‌ها هنوز در پایگاه داده موجودند.</div>
<?php endif; ?>

<section class="card">
  <div class="card-head">
    <h2>مشخصات حساب</h2>
    <span class="badge <?= $user['status'] === 'active' ? 'badge-ok' : 'badge-err' ?>">
      <?= $user['status'] === 'active' ? 'فعال' : 'مسدود' ?>
    </span>
  </div>
  <dl class="detail-grid">
    <div><dt>نام کسب‌وکار</dt><dd><?= e((string) $user['business_name']) ?></dd></div>
    <div><dt>نام مالک</dt><dd><?= e((string) ($user['owner_name'] ?: '—')) ?></dd></div>
    <div><dt>ایمیل</dt><dd dir="ltr"><?= e((string) $user['email']) ?></dd></div>
    <div><dt>تلفن</dt><dd dir="ltr"><?= e((string) ($user['phone'] ?: '—')) ?></dd></div>
    <div><dt>نقش</dt><dd><?= $user['role'] === 'admin' ? 'مدیر سیستم' : 'کاربر عادی' ?></dd></div>
    <div><dt>شناسه یکتا</dt><dd class="xs" dir="ltr"><?= e((string) $user['uuid']) ?></dd></div>
    <div><dt>تاریخ ثبت‌نام</dt><dd><?= e(fa_datetime($user['created_at'])) ?></dd></div>
    <div><dt>آخرین ورود</dt><dd><?= e(fa_ago($user['last_login_at'])) ?></dd></div>
    <div><dt>آخرین IP</dt><dd dir="ltr"><?= e((string) ($user['last_login_ip'] ?: '—')) ?></dd></div>
    <div><dt>تغییر رمز</dt><dd><?= e(fa_ago($user['password_changed_at'])) ?></dd></div>
    <div><dt>ورود ناموفق (۲۴ ساعت)</dt><dd><?= fa_number($loginFails) ?></dd></div>
    <div><dt>واحد پول</dt><dd><?= e((string) ($settings['currency'] ?? '—')) ?></dd></div>
  </dl>
</section>

<div class="stat-grid">
  <div class="stat"><div class="stat-label">فاکتورها</div><div class="stat-value"><?= fa_number($stats['invoices'] ?? 0) ?></div></div>
  <div class="stat"><div class="stat-label">محصولات</div><div class="stat-value"><?= fa_number($stats['products'] ?? 0) ?></div></div>
  <div class="stat"><div class="stat-label">مشتریان</div><div class="stat-value"><?= fa_number($stats['customers'] ?? 0) ?></div></div>
  <div class="stat"><div class="stat-label">گردش مالی</div><div class="stat-value sm"><?= fa_number($stats['revenue'] ?? 0) ?></div></div>
  <div class="stat"><div class="stat-label">پرداخت‌نشده</div><div class="stat-value sm"><?= fa_number($stats['unpaid'] ?? 0) ?></div></div>
</div>

<section class="card">
  <div class="card-head"><h2>عملیات مدیریتی</h2></div>

  <?php if ($self): ?>
    <p class="muted">این حساب خودتان است؛ برای جلوگیری از قفل شدن پنل، عملیات مدیریتی روی آن غیرفعال است.</p>
  <?php else: ?>
    <div class="action-bar">
      <?php if ($user['status'] === 'active'): ?>
        <form method="post" data-confirm="این حساب مسدود شود؟ کاربر بلافاصله از همه دستگاه‌ها خارج می‌شود.">
          <?= Csrf::field() ?><input type="hidden" name="op" value="suspend">
          <button class="btn btn-warn" type="submit">مسدودسازی حساب</button>
        </form>
      <?php else: ?>
        <form method="post">
          <?= Csrf::field() ?><input type="hidden" name="op" value="activate">
          <button class="btn btn-ok" type="submit">فعال‌سازی حساب</button>
        </form>
      <?php endif; ?>

      <form method="post" data-confirm="همه نشست‌های این کاربر بسته شود؟">
        <?= Csrf::field() ?><input type="hidden" name="op" value="logout_all">
        <button class="btn" type="submit">خروج از همه دستگاه‌ها</button>
      </form>

      <?php if ($user['role'] === 'admin'): ?>
        <form method="post" data-confirm="دسترسی مدیریت از این کاربر گرفته شود؟">
          <?= Csrf::field() ?><input type="hidden" name="op" value="revoke_admin">
          <button class="btn btn-warn" type="submit">سلب دسترسی مدیر</button>
        </form>
      <?php else: ?>
        <form method="post" data-confirm="به این کاربر دسترسی کامل مدیریت داده شود؟">
          <?= Csrf::field() ?><input type="hidden" name="op" value="make_admin">
          <button class="btn" type="submit">ارتقا به مدیر</button>
        </form>
      <?php endif; ?>

      <?php if ($user['deleted_at'] === null): ?>
        <form method="post" data-confirm="این حساب حذف شود؟ (حذف نرم — قابل بازیابی)">
          <?= Csrf::field() ?><input type="hidden" name="op" value="delete">
          <button class="btn btn-danger" type="submit">حذف حساب</button>
        </form>
      <?php else: ?>
        <form method="post">
          <?= Csrf::field() ?><input type="hidden" name="op" value="restore">
          <button class="btn btn-ok" type="submit">بازیابی حساب</button>
        </form>
      <?php endif; ?>
    </div>

    <form method="post" class="inline-form" data-confirm="رمز عبور این کاربر تغییر کند؟">
      <?= Csrf::field() ?>
      <input type="hidden" name="op" value="reset_password">
      <label for="new_password">تعیین رمز عبور جدید</label>
      <div class="inline-row">
        <input type="text" id="new_password" name="new_password" minlength="8"
               placeholder="حداقل ۸ کاراکتر، شامل حرف و عدد" required>
        <button class="btn btn-primary" type="submit">ثبت رمز</button>
      </div>
      <p class="hint">رمز را از طریق کانالی امن به کاربر اطلاع دهید. همه نشست‌های او بسته خواهد شد.</p>
    </form>
  <?php endif; ?>

  <form method="post" class="inline-form">
    <?= Csrf::field() ?>
    <input type="hidden" name="op" value="note">
    <label for="note">یادداشت داخلی (فقط مدیران می‌بینند)</label>
    <div class="inline-row">
      <input type="text" id="note" name="note" maxlength="255" value="<?= e((string) ($user['note'] ?? '')) ?>">
      <button class="btn" type="submit">ذخیره</button>
    </div>
  </form>
</section>

<div class="two-col">
  <section class="card">
    <div class="card-head"><h2>نشست‌های فعال</h2></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>نوع</th><th>IP</th><th>دستگاه</th><th>آخرین فعالیت</th></tr></thead>
        <tbody>
        <?php if ($sessions === []): ?>
          <tr><td colspan="4" class="empty">نشست فعالی وجود ندارد.</td></tr>
        <?php endif; ?>
        <?php foreach ($sessions as $s): ?>
          <tr>
            <td data-label="نوع"><span class="chip"><?= $s['scope'] === 'admin' ? 'پنل' : 'برنامه' ?></span></td>
            <td data-label="IP" dir="ltr" class="sm"><?= e((string) $s['ip']) ?></td>
            <td data-label="دستگاه" class="xs muted"><?= e(mb_substr((string) $s['user_agent'], 0, 60)) ?></td>
            <td data-label="آخرین فعالیت" class="sm muted"><?= e(fa_ago($s['last_seen_at'])) ?></td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h2>رویدادهای اخیر</h2></div>
    <ul class="feed">
      <?php if ($logs === []): ?><li class="empty">رویدادی ثبت نشده است.</li><?php endif; ?>
      <?php foreach ($logs as $l): ?>
        <li>
          <div><span class="chip"><?= e((string) $l['action']) ?></span> <?= e((string) $l['message']) ?></div>
          <div class="muted xs"><span dir="ltr"><?= e((string) $l['ip']) ?></span> · <?= e(fa_ago($l['created_at'])) ?></div>
        </li>
      <?php endforeach; ?>
    </ul>
  </section>
</div>

<section class="card">
  <div class="card-head">
    <h2>آخرین فاکتورها</h2>
    <a class="link" href="invoices.php?user=<?= $userId ?>">همه فاکتورهای این کاربر ←</a>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>شماره</th><th>مشتری</th><th>تاریخ</th><th>مبلغ</th><th>پرداخت</th></tr></thead>
      <tbody>
      <?php if ($invoices === []): ?>
        <tr><td colspan="5" class="empty">فاکتوری ثبت نشده است.</td></tr>
      <?php endif; ?>
      <?php foreach ($invoices as $i): ?>
        <tr>
          <td data-label="شماره" dir="ltr" class="sm"><?= e((string) $i['number']) ?></td>
          <td data-label="مشتری"><?= e((string) ($i['customer_name'] ?: '—')) ?></td>
          <td data-label="تاریخ" class="sm muted"><?= e(fa_datetime($i['issue_date'], false)) ?></td>
          <td data-label="مبلغ"><?= fa_number($i['total']) ?></td>
          <td data-label="پرداخت">
            <span class="badge <?= $i['payment_status'] === 'paid' ? 'badge-ok' : ($i['payment_status'] === 'partial' ? 'badge-warn' : 'badge-err') ?>">
              <?= ['unpaid' => 'پرداخت‌نشده', 'partial' => 'بخشی', 'paid' => 'پرداخت‌شده'][$i['payment_status']] ?? '—' ?>
            </span>
          </td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
  </div>
</section>

<?php admin_layout_end(); ?>
