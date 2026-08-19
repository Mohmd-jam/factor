<?php
/**
 * فاکتورینو — ورود به پنل مدیریت
 */

declare(strict_types=1);

require_once __DIR__ . '/_bootstrap.php';

// اگر از قبل وارد شده، مستقیم به داشبورد
if (Auth::user('admin') !== null) {
    header('Location: index.php');
    exit;
}

$error = '';
$email = '';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    Csrf::requireValid([], false);

    $email    = clean_string($_POST['email'] ?? '', 190);
    $password = (string) ($_POST['password'] ?? '');

    if ($email === '' || $password === '') {
        $error = 'ایمیل و رمز عبور را وارد کنید.';
    } else {
        try {
            $result = Auth::attemptLogin($email, $password, 'admin');
            if ($result['ok']) {
                Auth::createSession((int) $result['user']['id'], 'admin');
                log_activity(
                    (int) $result['user']['id'],
                    (int) $result['user']['id'],
                    'admin_login',
                    'ورود به پنل مدیریت'
                );
                header('Location: index.php');
                exit;
            }
            $error = $result['error'];
        } catch (Throwable $e) {
            error_log('[factorino] admin login: ' . $e->getMessage());
            $error = APP_DEBUG ? $e->getMessage() : 'اتصال به پایگاه داده برقرار نشد. تنظیمات .env را بررسی کنید.';
        }
    }
}

$csrf = Csrf::token();
?>
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<title>ورود مدیر — فاکتورینو</title>
<link rel="icon" href="../assets/favicon.svg" type="image/svg+xml">
<style>
  *{box-sizing:border-box}
  body{
    margin:0; min-height:100vh; display:grid; place-items:center; padding:20px;
    font-family:"Vazirmatn","IRANSans","Segoe UI",Tahoma,sans-serif;
    background:radial-gradient(1200px 600px at 80% -10%,#312e81,transparent),
               linear-gradient(160deg,#1e1b4b,#0f172a);
    color:#0f172a;
  }
  .box{
    width:100%; max-width:400px; background:#fff; border-radius:20px; padding:32px 28px;
    box-shadow:0 30px 70px rgba(0,0,0,.4);
  }
  .logo{
    width:56px; height:56px; border-radius:16px; display:grid; place-items:center; margin:0 auto 16px;
    background:linear-gradient(135deg,#6366f1,#4338ca); color:#fff; font-size:26px; font-weight:800;
  }
  h1{margin:0 0 4px; font-size:1.3rem; text-align:center}
  p.sub{margin:0 0 22px; text-align:center; color:#64748b; font-size:.87rem}
  label{display:block; font-size:.85rem; font-weight:600; margin:0 0 6px}
  input{
    width:100%; padding:12px 14px; margin-bottom:16px; border:1px solid #e2e8f0;
    border-radius:11px; font:inherit; background:#f8fafc;
  }
  input:focus{outline:none; border-color:#4f46e5; box-shadow:0 0 0 3px rgba(79,70,229,.15); background:#fff}
  button{
    width:100%; padding:13px; border:0; border-radius:11px; background:#4f46e5; color:#fff;
    font:inherit; font-weight:700; font-size:1rem; cursor:pointer;
  }
  button:hover{background:#4338ca}
  .err{
    background:#fef2f2; border:1px solid #fecaca; color:#991b1b; padding:11px 14px;
    border-radius:11px; font-size:.87rem; margin-bottom:18px; line-height:1.8;
  }
  .back{display:block; text-align:center; margin-top:18px; color:#64748b; font-size:.83rem; text-decoration:none}
  .back:hover{color:#4f46e5}
</style>
</head>
<body>
<form class="box" method="post" autocomplete="on">
  <div class="logo">ف</div>
  <h1>پنل مدیریت فاکتورینو</h1>
  <p class="sub">فقط حساب مدیر اصلی اجازه ورود دارد</p>

  <?php if ($error !== ''): ?>
    <div class="err" role="alert"><?= e($error) ?></div>
  <?php endif; ?>

  <input type="hidden" name="_csrf" value="<?= e($csrf) ?>">

  <label for="email">ایمیل</label>
  <input type="email" id="email" name="email" value="<?= e($email) ?>" required autocomplete="username" dir="ltr">

  <label for="password">رمز عبور</label>
  <input type="password" id="password" name="password" required autocomplete="current-password">

  <button type="submit">ورود به پنل</button>
  <a class="back" href="../index.html">بازگشت به برنامه</a>
</form>
</body>
</html>
