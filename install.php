<?php
/**
 * فاکتورینو — نصب‌کننده
 *
 * این صفحه یک بار اجرا می‌شود:
 *   ۱) اتصال به MySQL را می‌آزماید
 *   ۲) پایگاه داده و جدول‌ها را از روی database/schema.sql می‌سازد
 *   ۳) حساب مدیر اصلی را با رمزی که خودتان انتخاب می‌کنید ایجاد می‌کند
 *   ۴) فایل .env را با کلید امنیتی تصادفی می‌نویسد و خودش را قفل می‌کند
 *
 * پس از نصب، این فایل دیگر کار نمی‌کند. توصیه می‌شود آن را حذف کنید.
 */

declare(strict_types=1);

error_reporting(E_ALL);
ini_set('display_errors', '0');

require_once __DIR__ . '/config/config.php';
require_once __DIR__ . '/includes/helpers.php';
require_once __DIR__ . '/includes/csrf.php';

send_security_headers(true);

$lockFile = APP_ROOT . '/storage/installed.lock';
$envFile  = APP_ROOT . '/.env';

/** آیا نصب قبلاً انجام شده است؟ */
$alreadyInstalled = is_file($lockFile) || (is_file($envFile) && APP_KEY !== '');

$errors  = [];
$success = false;
$notices = [];

// مقادیر فرم (برای بازنمایی پس از خطا)
$form = [
    'db_host'   => $_POST['db_host']   ?? 'localhost',
    'db_port'   => $_POST['db_port']   ?? '3306',
    'db_name'   => $_POST['db_name']   ?? 'factorino_db',
    'db_user'   => $_POST['db_user']   ?? 'root',
    'db_pass'   => '',
    'admin_email' => $_POST['admin_email'] ?? '',
    'admin_name'  => $_POST['admin_name']  ?? 'مدیر سیستم',
    'app_url'     => $_POST['app_url']     ?? guess_base_url(),
];

// ---------------------------------------------------------------------------
// بررسی پیش‌نیازها
// ---------------------------------------------------------------------------
$requirements = [
    'نسخه PHP ۸.۰ یا بالاتر' => [PHP_VERSION_ID >= 80000, PHP_VERSION],
    'افزونه PDO'             => [extension_loaded('pdo'), extension_loaded('pdo') ? 'فعال' : 'غیرفعال'],
    'درایور pdo_mysql'       => [extension_loaded('pdo_mysql'), extension_loaded('pdo_mysql') ? 'فعال' : 'غیرفعال'],
    'افزونه mbstring'        => [extension_loaded('mbstring'), extension_loaded('mbstring') ? 'فعال' : 'غیرفعال'],
    'افزونه json'            => [extension_loaded('json'), extension_loaded('json') ? 'فعال' : 'غیرفعال'],
    'افزونه openssl'         => [extension_loaded('openssl'), extension_loaded('openssl') ? 'فعال' : 'اختیاری'],
    'قابل نوشتن بودن پوشه اصلی' => [is_writable(APP_ROOT), is_writable(APP_ROOT) ? 'بله' : 'خیر'],
];
$requirementsOk = true;
foreach ($requirements as $label => $info) {
    if (!$info[0] && $label !== 'افزونه openssl') {
        $requirementsOk = false;
    }
}

// ---------------------------------------------------------------------------
// پردازش فرم
// ---------------------------------------------------------------------------
if (!$alreadyInstalled && ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    Csrf::requireValid([], false);

    $host = clean_string(to_latin_digits((string) ($_POST['db_host'] ?? '')), 120) ?: 'localhost';
    $port = to_int($_POST['db_port'] ?? 3306, 3306);
    $name = clean_string(to_latin_digits((string) ($_POST['db_name'] ?? '')), 64);
    $user = clean_string((string) ($_POST['db_user'] ?? ''), 64);
    $pass = (string) ($_POST['db_pass'] ?? '');

    $adminEmail = normalize_email($_POST['admin_email'] ?? '');
    $adminName  = clean_string($_POST['admin_name'] ?? 'مدیر سیستم', 150) ?: 'مدیر سیستم';
    $adminPass  = (string) ($_POST['admin_pass'] ?? '');
    $adminPass2 = (string) ($_POST['admin_pass2'] ?? '');
    $appUrl     = clean_string($_POST['app_url'] ?? '', 200);

    if ($name === '' || preg_match('/^[A-Za-z0-9_]{1,64}$/', $name) !== 1) {
        $errors[] = 'نام پایگاه داده فقط می‌تواند شامل حروف انگلیسی، عدد و زیرخط باشد.';
    }
    if ($port < 1 || $port > 65535) {
        $errors[] = 'پورت پایگاه داده معتبر نیست.';
    }
    if ($user === '') {
        $errors[] = 'نام کاربری پایگاه داده را وارد کنید.';
    }
    if ($adminEmail === null) {
        $errors[] = 'ایمیل مدیر معتبر نیست.';
    }
    $pwProblem = password_problem($adminPass);
    if ($pwProblem !== null) {
        $errors[] = 'رمز مدیر: ' . $pwProblem;
    }
    if ($adminPass !== $adminPass2) {
        $errors[] = 'تکرار رمز عبور با رمز اصلی یکسان نیست.';
    }

    if ($errors === []) {
        try {
            $pdo = new PDO(
                sprintf('mysql:host=%s;port=%d;charset=utf8mb4', $host, $port),
                $user,
                $pass,
                [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES   => false,
                ]
            );

            // ساخت پایگاه داده در صورت نبود
            $pdo->exec(
                'CREATE DATABASE IF NOT EXISTS `' . $name . '` '
                . 'DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci'
            );
            $pdo->exec('USE `' . $name . '`');

            // اجرای اسکیمای پایگاه داده
            $schemaPath = APP_ROOT . '/database/schema.sql';
            if (!is_readable($schemaPath)) {
                throw new RuntimeException('فایل database/schema.sql پیدا نشد.');
            }
            $statements = split_sql((string) file_get_contents($schemaPath));
            $executed = 0;
            foreach ($statements as $sql) {
                // دستورهای مربوط به ساخت/انتخاب پایگاه داده را خودمان اجرا کردیم
                if (preg_match('/^\s*(CREATE\s+DATABASE|USE)\b/i', $sql) === 1) {
                    continue;
                }
                $pdo->exec($sql);
                $executed++;
            }

            // ساخت حساب مدیر
            $hash = hash_password($adminPass);
            $stmt = $pdo->prepare(
                'INSERT INTO users (uuid, email, password_hash, business_name, owner_name, role, status, password_changed_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())'
            );
            $stmt->execute([uuid4(), $adminEmail, $hash, $adminName, $adminName, 'admin', 'active']);
            $adminId = (int) $pdo->lastInsertId();

            $pdo->prepare(
                'INSERT INTO user_settings (user_id, business_name, owner_name, email) VALUES (?, ?, ?, ?)'
            )->execute([$adminId, $adminName, $adminName, $adminEmail]);

            // نوشتن فایل .env
            $appKey = random_token(32);
            $env = env_contents([
                'APP_ENV'     => 'production',
                'APP_DEBUG'   => 'false',
                'APP_URL'     => $appUrl,
                'APP_KEY'     => $appKey,
                'DB_DRIVER'   => 'mysql',
                'DB_HOST'     => $host,
                'DB_PORT'     => (string) $port,
                'DB_NAME'     => $name,
                'DB_USER'     => $user,
                'DB_PASSWORD' => $pass,
                'TRUST_PROXY' => 'false',
            ]);

            if (@file_put_contents($envFile, $env, LOCK_EX) === false) {
                throw new RuntimeException(
                    'فایل .env قابل نوشتن نیست. دسترسی پوشه را به 755 و فایل را به 644 تغییر دهید '
                    . 'یا محتوای زیر را دستی در فایل .env قرار دهید.'
                );
            }
            @chmod($envFile, 0640);

            // قفل کردن نصب‌کننده
            if (!is_dir(APP_ROOT . '/storage')) {
                @mkdir(APP_ROOT . '/storage', 0755, true);
            }
            @file_put_contents($lockFile, 'installed at ' . date('c') . PHP_EOL, LOCK_EX);

            $success = true;
            $notices[] = 'تعداد ' . $executed . ' دستور SQL با موفقیت اجرا شد.';
            $notices[] = 'حساب مدیر با ایمیل ' . $adminEmail . ' ساخته شد.';
        } catch (PDOException $e) {
            $msg = $e->getMessage();
            if (stripos($msg, 'Access denied') !== false) {
                $errors[] = 'نام کاربری یا رمز پایگاه داده اشتباه است.';
            } elseif (stripos($msg, 'Unknown MySQL server host') !== false || stripos($msg, 'Connection refused') !== false) {
                $errors[] = 'سرور پایگاه داده در دسترس نیست. مقدار «میزبان» را بررسی کنید (در XAMPP معمولاً localhost).';
            } elseif (stripos($msg, 'Duplicate entry') !== false) {
                $errors[] = 'این ایمیل قبلاً در پایگاه داده ثبت شده است.';
            } else {
                $errors[] = 'خطای پایگاه داده: ' . $msg;
            }
        } catch (Throwable $e) {
            $errors[] = $e->getMessage();
        }
    }
}

// ---------------------------------------------------------------------------
// توابع کمکی نصب
// ---------------------------------------------------------------------------

/** تقسیم فایل SQL به دستورهای مجزا. */
function split_sql(string $sql): array
{
    // حذف کامنت‌های خطی
    $lines = preg_split('/\R/', $sql) ?: [];
    $clean = [];
    foreach ($lines as $line) {
        $trimmed = ltrim($line);
        if (str_starts_with($trimmed, '--') || str_starts_with($trimmed, '#')) {
            continue;
        }
        $clean[] = $line;
    }
    $sql = implode("\n", $clean);
    // حذف کامنت‌های بلوکی
    $sql = preg_replace('#/\*.*?\*/#s', '', $sql) ?? $sql;

    $parts = explode(';', $sql);
    $out = [];
    foreach ($parts as $p) {
        $p = trim($p);
        if ($p !== '') {
            $out[] = $p;
        }
    }
    return $out;
}

/** ساخت محتوای .env */
function env_contents(array $values): string
{
    $out = "# فاکتورینو — فایل تنظیمات محیطی\n"
         . "# این فایل حاوی اطلاعات حساس است؛ آن را در گیت قرار ندهید.\n"
         . '# ساخته شده در ' . date('Y-m-d H:i:s') . "\n\n";
    foreach ($values as $k => $v) {
        $needsQuote = $v === '' || preg_match('/[\s#"\']/', (string) $v) === 1;
        $out .= $k . '=' . ($needsQuote ? '"' . str_replace('"', '\"', (string) $v) . '"' : $v) . "\n";
    }
    return $out;
}

/** حدس آدرس پایه برنامه. */
function guess_base_url(): string
{
    $scheme = is_https() ? 'https' : 'http';
    $host   = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
    $dir    = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/'))), '/');
    return $scheme . '://' . $host . $dir;
}

$csrf = Csrf::token();
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>نصب فاکتورینو</title>
<style>
  :root{
    --bg:#0f172a; --card:#ffffff; --ink:#0f172a; --muted:#64748b;
    --brand:#4f46e5; --brand-dark:#4338ca; --ok:#059669; --err:#dc2626; --line:#e2e8f0;
  }
  *{box-sizing:border-box}
  body{
    margin:0; min-height:100vh; padding:24px 16px;
    font-family:"Vazirmatn","IRANSans","Segoe UI",Tahoma,sans-serif;
    background:linear-gradient(160deg,#1e1b4b,#0f172a 60%); color:var(--ink);
    display:flex; align-items:flex-start; justify-content:center;
  }
  .wrap{width:100%; max-width:820px}
  .card{background:var(--card); border-radius:18px; padding:28px; box-shadow:0 24px 60px rgba(0,0,0,.35); margin-bottom:18px}
  h1{margin:0 0 6px; font-size:1.6rem}
  h2{font-size:1.05rem; margin:22px 0 10px; color:var(--brand-dark)}
  .sub{color:var(--muted); margin:0 0 18px; font-size:.92rem; line-height:1.9}
  .grid{display:grid; gap:14px; grid-template-columns:repeat(2,minmax(0,1fr))}
  @media (max-width:620px){.grid{grid-template-columns:1fr} body{padding:12px}. card{padding:20px}}
  label{display:block; font-size:.85rem; font-weight:600; margin-bottom:6px}
  input[type=text],input[type=email],input[type=password],input[type=number]{
    width:100%; padding:11px 13px; border:1px solid var(--line); border-radius:10px;
    font:inherit; background:#f8fafc; transition:border-color .15s, box-shadow .15s;
  }
  input:focus{outline:none; border-color:var(--brand); box-shadow:0 0 0 3px rgba(79,70,229,.15); background:#fff}
  .hint{font-size:.78rem; color:var(--muted); margin-top:5px}
  button{
    margin-top:22px; width:100%; padding:13px; border:0; border-radius:11px; cursor:pointer;
    background:var(--brand); color:#fff; font:inherit; font-weight:700; font-size:1rem;
    transition:background .15s, transform .05s;
  }
  button:hover{background:var(--brand-dark)} button:active{transform:translateY(1px)}
  table{width:100%; border-collapse:collapse; font-size:.88rem}
  td{padding:8px 4px; border-bottom:1px solid var(--line)}
  td:last-child{text-align:left; font-weight:700}
  .ok{color:var(--ok)} .bad{color:var(--err)}
  .alert{padding:14px 16px; border-radius:12px; margin-bottom:16px; font-size:.9rem; line-height:1.9}
  .alert-err{background:#fef2f2; border:1px solid #fecaca; color:#991b1b}
  .alert-ok{background:#ecfdf5; border:1px solid #a7f3d0; color:#065f46}
  .alert ul{margin:6px 0 0; padding-inline-start:20px}
  .steps{display:flex; gap:10px; flex-wrap:wrap; margin-bottom:18px; font-size:.8rem; color:#c7d2fe}
  .steps span{background:rgba(255,255,255,.08); padding:6px 12px; border-radius:99px}
  a.btn{display:block; text-align:center; margin-top:14px; padding:13px; border-radius:11px;
        background:var(--ok); color:#fff; text-decoration:none; font-weight:700}
  a.btn.btn-ghost{background:transparent; color:var(--muted); border:1px solid #d8dbe6; margin-top:9px}
  code{background:#f1f5f9; padding:2px 6px; border-radius:6px; font-size:.85em; direction:ltr; display:inline-block}
</style>
</head>
<body>
<div class="wrap">

  <div class="steps">
    <span>۱ — بررسی پیش‌نیازها</span>
    <span>۲ — اتصال پایگاه داده</span>
    <span>۳ — ساخت حساب مدیر</span>
    <span>۴ — پایان</span>
  </div>

<?php if ($alreadyInstalled && !$success): ?>
  <div class="card">
    <h1>فاکتورینو قبلاً نصب شده است</h1>
    <p class="sub">
      برای امنیت بیشتر، نصب‌کننده غیرفعال شده است.
      اگر می‌خواهید دوباره نصب کنید، فایل <code>storage/installed.lock</code> و <code>.env</code> را حذف کنید.
    </p>
    <a class="btn" href="login.html">رفتن به صفحه ورود</a>
    <a class="btn btn-ghost" href="admin/login.php">ورود به پنل مدیریت</a>
  </div>

<?php elseif ($success): ?>
  <div class="card">
    <h1>🎉 نصب با موفقیت انجام شد</h1>
    <div class="alert alert-ok">
      <strong>همه چیز آماده است.</strong>
      <ul>
        <?php foreach ($notices as $n): ?><li><?= e($n) ?></li><?php endforeach; ?>
      </ul>
    </div>
    <p class="sub">
      <strong>گام امنیتی مهم:</strong> فایل <code>install.php</code> را از روی سرور حذف کنید.
      همچنین مطمئن شوید فایل <code>.env</code> از طریق مرورگر قابل دسترسی نیست
      (فایل‌های <code>.htaccess</code> این کار را انجام می‌دهند).
    </p>
    <a class="btn" href="admin/login.php">ورود به پنل مدیریت</a>
    <a class="btn btn-ghost" href="login.html">صفحه ورود کاربران</a>
  </div>

<?php else: ?>

  <div class="card">
    <h1>نصب فاکتورینو <span style="font-size:.8rem;color:var(--muted)">نسخه <?= e(APP_VERSION) ?></span></h1>
    <p class="sub">
      این صفحه پایگاه داده را می‌سازد و حساب مدیر اصلی را ایجاد می‌کند.
      اگر روی XAMPP هستید معمولاً کاربر <code>root</code> بدون رمز کار می‌کند؛
      روی هاست cPanel اطلاعات پایگاه داده را از بخش «MySQL Databases» بردارید.
    </p>

    <h2>پیش‌نیازهای سرور</h2>
    <table>
      <?php foreach ($requirements as $label => $info): ?>
        <tr>
          <td><?= e($label) ?></td>
          <td class="<?= $info[0] ? 'ok' : 'bad' ?>"><?= $info[0] ? '✔ ' : '✖ ' ?><?= e((string) $info[1]) ?></td>
        </tr>
      <?php endforeach; ?>
    </table>
    <?php if (!$requirementsOk): ?>
      <div class="alert alert-err" style="margin-top:14px">
        برخی پیش‌نیازها فراهم نیستند. تا رفع آن‌ها نصب ممکن نیست.
      </div>
    <?php endif; ?>
  </div>

  <div class="card">
    <?php if ($errors !== []): ?>
      <div class="alert alert-err">
        <strong>نصب انجام نشد:</strong>
        <ul><?php foreach ($errors as $err): ?><li><?= e($err) ?></li><?php endforeach; ?></ul>
      </div>
    <?php endif; ?>

    <form method="post" autocomplete="off">
      <input type="hidden" name="_csrf" value="<?= e($csrf) ?>">

      <h2>اطلاعات پایگاه داده</h2>
      <div class="grid">
        <div>
          <label for="db_host">میزبان (Host)</label>
          <input type="text" id="db_host" name="db_host" value="<?= e((string) $form['db_host']) ?>" required dir="ltr">
          <div class="hint">XAMPP: localhost — cPanel: معمولاً localhost</div>
        </div>
        <div>
          <label for="db_port">پورت</label>
          <input type="number" id="db_port" name="db_port" value="<?= e((string) $form['db_port']) ?>" required dir="ltr">
        </div>
        <div>
          <label for="db_name">نام پایگاه داده</label>
          <input type="text" id="db_name" name="db_name" value="<?= e((string) $form['db_name']) ?>" required dir="ltr">
          <div class="hint">اگر وجود نداشته باشد ساخته می‌شود (در cPanel باید از قبل بسازید).</div>
        </div>
        <div>
          <label for="db_user">نام کاربری</label>
          <input type="text" id="db_user" name="db_user" value="<?= e((string) $form['db_user']) ?>" required dir="ltr">
        </div>
        <div style="grid-column:1/-1">
          <label for="db_pass">رمز پایگاه داده</label>
          <input type="password" id="db_pass" name="db_pass" dir="ltr">
          <div class="hint">در XAMPP معمولاً خالی است.</div>
        </div>
      </div>

      <h2>حساب مدیر اصلی</h2>
      <div class="grid">
        <div>
          <label for="admin_name">نام مدیر</label>
          <input type="text" id="admin_name" name="admin_name" value="<?= e((string) $form['admin_name']) ?>" required>
        </div>
        <div>
          <label for="admin_email">ایمیل مدیر</label>
          <input type="email" id="admin_email" name="admin_email" value="<?= e((string) $form['admin_email']) ?>" required dir="ltr">
        </div>
        <div>
          <label for="admin_pass">رمز عبور</label>
          <input type="password" id="admin_pass" name="admin_pass" required minlength="8">
          <div class="hint">حداقل ۸ کاراکتر، شامل حرف و عدد.</div>
        </div>
        <div>
          <label for="admin_pass2">تکرار رمز عبور</label>
          <input type="password" id="admin_pass2" name="admin_pass2" required minlength="8">
        </div>
      </div>

      <h2>آدرس برنامه</h2>
      <div>
        <label for="app_url">نشانی نصب</label>
        <input type="text" id="app_url" name="app_url" value="<?= e((string) $form['app_url']) ?>" dir="ltr">
        <div class="hint">به‌صورت خودکار تشخیص داده شد؛ در صورت نیاز اصلاح کنید.</div>
      </div>

      <button type="submit" <?= $requirementsOk ? '' : 'disabled style="opacity:.5;cursor:not-allowed"' ?>>
        شروع نصب
      </button>
    </form>
  </div>

<?php endif; ?>
</div>
</body>
</html>
