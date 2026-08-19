<?php
/**
 * فاکتورینو — تنظیمات سامانه و حساب مدیر
 */

declare(strict_types=1);

require_once __DIR__ . '/_bootstrap.php';

$admin   = Auth::requireAdmin('login.php');
$adminId = (int) $admin['id'];

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    Csrf::requireValid([], false);
    $op = (string) ($_POST['op'] ?? '');

    if ($op === 'app') {
        set_app_setting('app_name', clean_string($_POST['app_name'] ?? '', 80) ?: APP_NAME);
        set_app_setting('registration_open', isset($_POST['registration_open']) ? '1' : '0');
        set_app_setting('announcement', clean_string($_POST['announcement'] ?? '', 500));
        set_app_setting('max_products_per_user', (string) max(1, to_int($_POST['max_products_per_user'] ?? 5000, 5000)));
        set_app_setting('max_invoices_per_user', (string) max(1, to_int($_POST['max_invoices_per_user'] ?? 100000, 100000)));
        log_activity($adminId, $adminId, 'admin_settings', 'به‌روزرسانی تنظیمات سامانه');
        redirect_with('settings.php', 'ok', 'تنظیمات سامانه ذخیره شد.');
    }

    if ($op === 'password') {
        $current = (string) ($_POST['current_password'] ?? '');
        $new     = (string) ($_POST['new_password'] ?? '');
        $confirm = (string) ($_POST['confirm_password'] ?? '');

        $row = Database::first('SELECT password_hash FROM users WHERE id = ?', [$adminId]);
        if ($row === null || !password_verify($current, (string) $row['password_hash'])) {
            redirect_with('settings.php', 'err', 'رمز عبور فعلی درست نیست.');
        }
        if ($new !== $confirm) {
            redirect_with('settings.php', 'err', 'رمز جدید و تکرار آن یکسان نیستند.');
        }
        $problem = password_problem($new);
        if ($problem !== null) {
            redirect_with('settings.php', 'err', $problem);
        }

        Database::run(
            'UPDATE users SET password_hash = ?, password_changed_at = ?, updated_at = ? WHERE id = ?',
            [hash_password($new), Database::now(), Database::now(), $adminId]
        );
        log_activity($adminId, $adminId, 'admin_password', 'تغییر رمز عبور مدیر');
        redirect_with('settings.php', 'ok', 'رمز عبور شما تغییر کرد.');
    }

    if ($op === 'purge_sessions') {
        $affected = Database::run(
            'UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL AND expires_at <= ?',
            [Database::now(), Database::now()]
        )->rowCount();
        log_activity($adminId, $adminId, 'admin_purge_sessions', 'پاک‌سازی نشست‌های منقضی: ' . $affected);
        redirect_with('settings.php', 'ok', 'نشست‌های منقضی پاک‌سازی شد.');
    }

    if ($op === 'purge_attempts') {
        Database::run('DELETE FROM login_attempts WHERE created_at < ?', [date('Y-m-d H:i:s', time() - 7 * 86400)]);
        log_activity($adminId, $adminId, 'admin_purge_attempts', 'پاک‌سازی تاریخچه ورود قدیمی');
        redirect_with('settings.php', 'ok', 'تاریخچه ورودهای قدیمی‌تر از ۷ روز حذف شد.');
    }

    if ($op === 'purge_logs') {
        Database::run('DELETE FROM activity_logs WHERE created_at < ?', [date('Y-m-d H:i:s', time() - 90 * 86400)]);
        log_activity($adminId, $adminId, 'admin_purge_logs', 'پاک‌سازی گزارش‌های قدیمی');
        redirect_with('settings.php', 'ok', 'گزارش‌های قدیمی‌تر از ۹۰ روز حذف شد.');
    }

    redirect_with('settings.php', 'err', 'عملیات نامعتبر است.');
}

$appName      = app_setting('app_name', APP_NAME) ?? APP_NAME;
$regOpen      = (app_setting('registration_open', '1') ?? '1') === '1';
$announcement = app_setting('announcement', '') ?? '';
$maxProducts  = to_int(app_setting('max_products_per_user', '5000'), 5000);
$maxInvoices  = to_int(app_setting('max_invoices_per_user', '100000'), 100000);

$counts = Database::first(
    "SELECT
        (SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL AND expires_at > ?) AS live_sessions,
        (SELECT COUNT(*) FROM sessions WHERE revoked_at IS NULL AND expires_at <= ?) AS stale_sessions,
        (SELECT COUNT(*) FROM login_attempts) AS attempts,
        (SELECT COUNT(*) FROM activity_logs) AS logs",
    [Database::now(), Database::now()]
) ?? [];

$installLockExists = is_file(dirname(__DIR__) . '/storage/installed.lock');
$installerExists   = is_file(dirname(__DIR__) . '/install.php');
$envExists         = is_file(dirname(__DIR__) . '/.env');

$pageTitle = 'تنظیمات';
require __DIR__ . '/_layout.php';
?>

<div class="two-col">
  <section class="card">
    <div class="card-head"><h2>تنظیمات سامانه</h2></div>
    <form method="post" class="form-stack">
      <?= Csrf::field() ?>
      <input type="hidden" name="op" value="app">

      <div class="field">
        <label for="app_name">نام سامانه</label>
        <input type="text" id="app_name" name="app_name" maxlength="80" value="<?= e($appName) ?>" required>
      </div>

      <div class="field">
        <label class="check">
          <input type="checkbox" name="registration_open" value="1" <?= $regOpen ? 'checked' : '' ?>>
          <span>ثبت‌نام کاربران جدید باز باشد</span>
        </label>
        <p class="hint">با غیرفعال کردن این گزینه، فقط شما می‌توانید حساب بسازید.</p>
      </div>

      <div class="field">
        <label for="announcement">اطلاعیه برای کاربران</label>
        <textarea id="announcement" name="announcement" rows="3" maxlength="500"
                  placeholder="مثلاً: پنجشنبه از ساعت ۲ تا ۴ سامانه در حال به‌روزرسانی است."><?= e($announcement) ?></textarea>
      </div>

      <div class="field-row">
        <div class="field">
          <label for="max_products_per_user">سقف محصول هر کاربر</label>
          <input type="number" id="max_products_per_user" name="max_products_per_user" min="1" step="1"
                 value="<?= $maxProducts ?>" dir="ltr">
        </div>
        <div class="field">
          <label for="max_invoices_per_user">سقف فاکتور هر کاربر</label>
          <input type="number" id="max_invoices_per_user" name="max_invoices_per_user" min="1" step="1"
                 value="<?= $maxInvoices ?>" dir="ltr">
        </div>
      </div>

      <button class="btn btn-primary" type="submit">ذخیره تنظیمات</button>
    </form>
  </section>

  <section class="card">
    <div class="card-head"><h2>تغییر رمز عبور شما</h2></div>
    <form method="post" class="form-stack" autocomplete="off">
      <?= Csrf::field() ?>
      <input type="hidden" name="op" value="password">

      <div class="field">
        <label for="current_password">رمز عبور فعلی</label>
        <input type="password" id="current_password" name="current_password" required autocomplete="current-password">
      </div>
      <div class="field">
        <label for="new_password">رمز عبور جدید</label>
        <input type="password" id="new_password" name="new_password" minlength="8" required autocomplete="new-password">
        <p class="hint">حداقل ۸ کاراکتر، شامل حرف و عدد.</p>
      </div>
      <div class="field">
        <label for="confirm_password">تکرار رمز جدید</label>
        <input type="password" id="confirm_password" name="confirm_password" minlength="8" required autocomplete="new-password">
      </div>

      <button class="btn btn-primary" type="submit">تغییر رمز</button>
    </form>
  </section>
</div>

<section class="card">
  <div class="card-head"><h2>وضعیت امنیتی نصب</h2></div>
  <ul class="health">
    <li class="<?= is_https() ? 'good' : 'warn' ?>">
      <?= is_https() ? 'اتصال روی HTTPS برقرار است.' : 'اتصال HTTPS نیست؛ روی هاست واقعی حتماً SSL را فعال کنید.' ?>
    </li>
    <li class="<?= $installLockExists ? 'good' : 'warn' ?>">
      <?= $installLockExists ? 'نصب قفل شده است (storage/installed.lock موجود است).' : 'قفل نصب پیدا نشد؛ نصب‌کننده ممکن است دوباره اجرا شود.' ?>
    </li>
    <li class="<?= $installerExists ? 'warn' : 'good' ?>">
      <?= $installerExists ? 'فایل install.php هنوز روی سرور است؛ پس از نصب آن را حذف کنید.' : 'فایل install.php حذف شده است.' ?>
    </li>
    <li class="<?= $envExists ? 'good' : 'warn' ?>">
      <?= $envExists ? 'فایل .env موجود است و باید خارج از دسترس وب بماند.' : 'فایل .env پیدا نشد؛ پیکربندی از متغیرهای محیطی خوانده می‌شود.' ?>
    </li>
    <li class="<?= APP_DEBUG ? 'warn' : 'good' ?>">
      <?= APP_DEBUG ? 'حالت اشکال‌زدایی روشن است؛ روی سرور واقعی APP_DEBUG=false بگذارید.' : 'حالت اشکال‌زدایی خاموش است.' ?>
    </li>
  </ul>
</section>

<section class="card">
  <div class="card-head"><h2>نگهداری پایگاه داده</h2></div>
  <div class="stat-grid">
    <div class="stat"><div class="stat-label">نشست فعال</div><div class="stat-value"><?= fa_number($counts['live_sessions'] ?? 0) ?></div></div>
    <div class="stat"><div class="stat-label">نشست منقضی</div><div class="stat-value"><?= fa_number($counts['stale_sessions'] ?? 0) ?></div></div>
    <div class="stat"><div class="stat-label">تلاش ورود</div><div class="stat-value"><?= fa_number($counts['attempts'] ?? 0) ?></div></div>
    <div class="stat"><div class="stat-label">رویداد ثبت‌شده</div><div class="stat-value"><?= fa_number($counts['logs'] ?? 0) ?></div></div>
  </div>

  <div class="action-bar">
    <form method="post">
      <?= Csrf::field() ?><input type="hidden" name="op" value="purge_sessions">
      <button class="btn" type="submit">پاک‌سازی نشست‌های منقضی</button>
    </form>
    <form method="post" data-confirm="تاریخچه ورودهای قدیمی‌تر از ۷ روز حذف شود؟">
      <?= Csrf::field() ?><input type="hidden" name="op" value="purge_attempts">
      <button class="btn" type="submit">حذف تاریخچه ورود قدیمی</button>
    </form>
    <form method="post" data-confirm="گزارش‌های قدیمی‌تر از ۹۰ روز حذف شود؟">
      <?= Csrf::field() ?><input type="hidden" name="op" value="purge_logs">
      <button class="btn btn-warn" type="submit">حذف گزارش‌های قدیمی</button>
    </form>
  </div>
</section>

<section class="card">
  <div class="card-head"><h2>درباره نسخه</h2></div>
  <dl class="detail-grid">
    <div><dt>نسخه برنامه</dt><dd dir="ltr"><?= e(APP_VERSION) ?></dd></div>
    <div><dt>محیط اجرا</dt><dd dir="ltr"><?= e(APP_ENV) ?></dd></div>
    <div><dt>نسخه PHP</dt><dd dir="ltr"><?= e(PHP_VERSION) ?></dd></div>
    <div><dt>درایور پایگاه داده</dt><dd dir="ltr"><?= e(DB_DRIVER) ?></dd></div>
  </dl>
</section>

<?php admin_layout_end(); ?>
