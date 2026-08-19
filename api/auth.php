<?php
/**
 * فاکتورینو — API احراز هویت
 *
 * POST ?action=register  → ثبت‌نام
 * POST ?action=login     → ورود
 * POST ?action=logout    → خروج
 * GET  ?action=profile   → اطلاعات کاربر جاری
 * POST ?action=password  → تغییر رمز عبور
 * GET  ?action=csrf      → دریافت توکن CSRF
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/config/database.php';
require_once dirname(__DIR__) . '/includes/helpers.php';
require_once dirname(__DIR__) . '/includes/response.php';
require_once dirname(__DIR__) . '/includes/auth.php';
require_once dirname(__DIR__) . '/includes/csrf.php';

send_security_headers(false);

if (!is_installed()) {
    Response::error('برنامه هنوز نصب نشده است. فایل install.php را در مرورگر باز کنید.', 503);
}

$action = (string) ($_GET['action'] ?? '');

try {
    switch ($action) {
        case 'csrf':
            Response::requireMethod('GET');
            Response::success(['csrf' => Csrf::token()]);
            break;

        case 'register':
            handle_register();
            break;

        case 'login':
            handle_login();
            break;

        case 'logout':
            handle_logout();
            break;

        case 'profile':
            handle_profile();
            break;

        case 'password':
            handle_password_change();
            break;

        default:
            Response::notFound('عملیات درخواستی شناخته نشد.');
    }
} catch (Throwable $e) {
    Response::serverError($e);
}

// ---------------------------------------------------------------------------

function handle_register(): void
{
    Response::requireMethod('POST');
    $body = Response::jsonBody();
    Csrf::requireValid($body);

    if (app_setting('registration_open', '1') !== '1') {
        Response::forbidden('ثبت‌نام کاربران جدید موقتاً غیرفعال است.');
    }

    $errors = [];

    $email = normalize_email($body['email'] ?? '');
    if ($email === null) {
        $errors['email'] = 'ایمیل معتبر وارد کنید.';
    }

    $password = is_string($body['password'] ?? null) ? $body['password'] : '';
    $pwError  = password_problem($password);
    if ($pwError !== null) {
        $errors['password'] = $pwError;
    }

    $businessName = clean_string($body['businessName'] ?? '', 150);
    if (mb_strlen($businessName, 'UTF-8') < 2) {
        $errors['businessName'] = 'نام کسب‌وکار را وارد کنید (حداقل ۲ کاراکتر).';
    }

    $ownerName = clean_string($body['ownerName'] ?? '', 150);
    $phone     = clean_string(to_latin_digits((string) ($body['phone'] ?? '')), 30);
    if ($phone !== '' && preg_match('/^[0-9+\-\s()]{5,30}$/', $phone) !== 1) {
        $errors['phone'] = 'شماره تماس معتبر نیست.';
    }

    if ($errors !== []) {
        Response::validation($errors);
    }

    // محدودسازی ثبت‌نام از یک IP
    $recent = (int) Database::value(
        'SELECT COUNT(*) FROM users WHERE last_login_ip = ? AND created_at > ?',
        [client_ip(), date('Y-m-d H:i:s', time() - 3600)]
    );
    if ($recent >= 5) {
        Response::tooMany('تعداد ثبت‌نام از این دستگاه زیاد است؛ کمی بعد تلاش کنید.');
    }

    $exists = Database::value('SELECT id FROM users WHERE email = ?', [$email]);
    if ($exists !== null) {
        Response::error('این ایمیل قبلاً ثبت شده است. اگر حساب دارید وارد شوید.', 409);
    }

    Database::begin();
    try {
        Database::run(
            'INSERT INTO users (uuid, email, password_hash, business_name, owner_name, phone, role, status, last_login_ip, password_changed_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                uuid4(),
                $email,
                hash_password($password),
                $businessName,
                $ownerName,
                $phone,
                'user',
                'active',
                client_ip(),
                Database::now(),
                Database::now(),
                Database::now(),
            ]
        );
        $userId = (int) Database::insertId();

        Database::run(
            'INSERT INTO user_settings (user_id, business_name, owner_name, phone, email, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)',
            [$userId, $businessName, $ownerName, $phone, $email, Database::now()]
        );

        Database::commit();
    } catch (Throwable $e) {
        Database::rollBack();
        throw $e;
    }

    $token = Auth::createSession($userId, 'app');
    log_activity($userId, $userId, 'register', 'ثبت‌نام کاربر جدید');

    Response::success([
        'token' => $token,
        'csrf'  => Csrf::token(),
        'user'  => [
            'id'           => $userId,
            'email'        => $email,
            'businessName' => $businessName,
            'ownerName'    => $ownerName,
            'phone'        => $phone,
            'role'         => 'user',
        ],
    ], 'حساب کاربری با موفقیت ساخته شد.', 201);
}

function handle_login(): void
{
    Response::requireMethod('POST');
    $body = Response::jsonBody();
    Csrf::requireValid($body);

    $email    = is_string($body['email'] ?? null) ? $body['email'] : '';
    $password = is_string($body['password'] ?? null) ? $body['password'] : '';

    if ($email === '' || $password === '') {
        Response::validation([
            'email'    => $email === '' ? 'ایمیل را وارد کنید.' : null,
            'password' => $password === '' ? 'رمز عبور را وارد کنید.' : null,
        ]);
    }

    $result = Auth::attemptLogin($email, $password, 'app');
    if (!$result['ok']) {
        Response::error($result['error'], $result['status'] ?? 401);
    }

    $user  = $result['user'];
    $token = Auth::createSession((int) $user['id'], 'app');
    log_activity((int) $user['id'], (int) $user['id'], 'login', 'ورود موفق به برنامه');

    $settings = Database::first(
        'SELECT business_name, owner_name, phone FROM user_settings WHERE user_id = ?',
        [(int) $user['id']]
    ) ?? [];

    Response::success([
        'token' => $token,
        'csrf'  => Csrf::token(),
        'user'  => [
            'id'           => (int) $user['id'],
            'email'        => $user['email'],
            'businessName' => $settings['business_name'] ?? $user['business_name'],
            'ownerName'    => $settings['owner_name'] ?? '',
            'phone'        => $settings['phone'] ?? '',
            'role'         => $user['role'],
        ],
    ], 'خوش آمدید!');
}

function handle_logout(): void
{
    Response::requireMethod('POST');
    $body = Response::jsonBody();
    Csrf::requireValid($body);

    $user  = Auth::user('app');
    $token = Auth::tokenFromRequest('app');
    Auth::revokeToken($token, 'app');

    if ($user !== null) {
        log_activity((int) $user['id'], (int) $user['id'], 'logout', 'خروج از حساب');
    }

    Response::success(null, 'با موفقیت خارج شدید.');
}

function handle_profile(): void
{
    Response::requireMethod('GET');
    $user = Auth::requireUser();

    $settings = Database::first('SELECT * FROM user_settings WHERE user_id = ?', [(int) $user['id']]);

    $counts = Database::first(
        'SELECT
            (SELECT COUNT(*) FROM products  WHERE user_id = ? AND deleted_at IS NULL) AS products,
            (SELECT COUNT(*) FROM customers WHERE user_id = ? AND deleted_at IS NULL) AS customers,
            (SELECT COUNT(*) FROM invoices  WHERE user_id = ? AND deleted_at IS NULL) AS invoices',
        [(int) $user['id'], (int) $user['id'], (int) $user['id']]
    ) ?? ['products' => 0, 'customers' => 0, 'invoices' => 0];

    Response::success([
        'user' => [
            'id'           => (int) $user['id'],
            'email'        => $user['email'],
            'businessName' => $settings['business_name'] ?? $user['business_name'],
            'ownerName'    => $user['owner_name'] ?? '',
            'phone'        => $user['phone'] ?? '',
            'role'         => $user['role'],
            'createdAt'    => $user['created_at'],
            'lastLoginAt'  => $user['last_login_at'],
        ],
        'counts' => [
            'products'  => (int) $counts['products'],
            'customers' => (int) $counts['customers'],
            'invoices'  => (int) $counts['invoices'],
        ],
        'csrf' => Csrf::token(),
    ]);
}

function handle_password_change(): void
{
    Response::requireMethod('POST');
    $body = Response::jsonBody();
    Csrf::requireValid($body);
    $user = Auth::requireUser();

    $current = is_string($body['currentPassword'] ?? null) ? $body['currentPassword'] : '';
    $new     = is_string($body['newPassword'] ?? null) ? $body['newPassword'] : '';

    $row = Database::first('SELECT password_hash FROM users WHERE id = ?', [(int) $user['id']]);
    if ($row === null || !password_verify($current, (string) $row['password_hash'])) {
        Response::error('رمز عبور فعلی درست نیست.', 401);
    }

    $pwError = password_problem($new);
    if ($pwError !== null) {
        Response::validation(['newPassword' => $pwError]);
    }

    Database::run(
        'UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?',
        [hash_password($new), Database::now(), (int) $user['id']]
    );

    // همه نشست‌های دیگر باطل می‌شوند، سپس نشست تازه ساخته می‌شود.
    Auth::revokeAllSessions((int) $user['id']);
    $token = Auth::createSession((int) $user['id'], 'app');

    log_activity((int) $user['id'], (int) $user['id'], 'password_change', 'تغییر رمز عبور');

    Response::success(['token' => $token], 'رمز عبور با موفقیت تغییر کرد.');
}
