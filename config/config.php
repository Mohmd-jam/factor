<?php
/**
 * فاکتورینو — پیکربندی مرکزی
 *
 * این فایل نباید مستقیماً از مرورگر قابل دسترسی باشد (با .htaccess مسدود شده است).
 */

declare(strict_types=1);

if (defined('FACTORINO_CONFIG_LOADED')) {
    return;
}
define('FACTORINO_CONFIG_LOADED', true);

define('APP_ROOT', dirname(__DIR__));

// ---------------------------------------------------------------------------
// خواندن فایل .env  (بدون نیاز به کتابخانه بیرونی)
// ---------------------------------------------------------------------------
function factorino_load_env(string $path): array
{
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }

    $cache = [];
    if (!is_readable($path)) {
        return $cache;
    }

    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || $line[0] === ';') {
            continue;
        }
        $pos = strpos($line, '=');
        if ($pos === false) {
            continue;
        }
        $key = trim(substr($line, 0, $pos));
        $val = trim(substr($line, $pos + 1));

        // حذف کوتیشن‌های اطراف مقدار
        $len = strlen($val);
        if ($len >= 2) {
            $first = $val[0];
            $last  = $val[$len - 1];
            if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                $val = substr($val, 1, -1);
            }
        }
        $cache[$key] = $val;
    }

    return $cache;
}

function env(string $key, $default = null)
{
    $env = factorino_load_env(APP_ROOT . '/.env');
    if (array_key_exists($key, $env)) {
        return $env[$key];
    }
    $fromServer = getenv($key);
    if ($fromServer !== false) {
        return $fromServer;
    }
    return $default;
}

function env_bool(string $key, bool $default = false): bool
{
    $value = env($key);
    if ($value === null || $value === '') {
        return $default;
    }
    return in_array(strtolower((string) $value), ['1', 'true', 'yes', 'on'], true);
}

// ---------------------------------------------------------------------------
// ثابت‌های برنامه
// ---------------------------------------------------------------------------
define('APP_NAME',    'فاکتورینو');
define('APP_VERSION', '3.0.0');
define('APP_ENV',     (string) env('APP_ENV', 'production'));
define('APP_DEBUG',   env_bool('APP_DEBUG', false));

// درایور پایگاه داده. مقدار عملیاتی: mysql
// مقدار sqlite فقط برای اجرای تست‌های محلی/دمو در نظر گرفته شده است.
define('DB_DRIVER',   strtolower((string) env('DB_DRIVER', 'mysql')));
define('DB_HOST',     (string) env('DB_HOST', 'localhost'));
define('DB_PORT',     (int)    env('DB_PORT', '3306'));
define('DB_NAME',     (string) env('DB_NAME', 'factorino_db'));
define('DB_USER',     (string) env('DB_USER', 'root'));
define('DB_PASSWORD', (string) env('DB_PASSWORD', ''));
define('DB_SQLITE_PATH', (string) env('DB_SQLITE_PATH', APP_ROOT . '/storage/factorino.sqlite'));

// کلید مخفی برای امضای مقادیر (CSRF و ...)
define('APP_KEY', (string) env('APP_KEY', ''));

// طول عمر نشست‌ها
define('SESSION_TTL_APP',   (int) env('SESSION_TTL_APP', (string) (60 * 60 * 24 * 14))); // ۱۴ روز
define('SESSION_TTL_ADMIN', (int) env('SESSION_TTL_ADMIN', (string) (60 * 60 * 4)));     // ۴ ساعت

// محدودسازی ورود
define('LOGIN_MAX_ATTEMPTS_IP',    (int) env('LOGIN_MAX_ATTEMPTS_IP', '20'));
define('LOGIN_MAX_ATTEMPTS_EMAIL', (int) env('LOGIN_MAX_ATTEMPTS_EMAIL', '6'));
define('LOGIN_WINDOW_SECONDS',     (int) env('LOGIN_WINDOW_SECONDS', '900'));  // ۱۵ دقیقه
define('LOGIN_LOCK_SECONDS',       (int) env('LOGIN_LOCK_SECONDS', '900'));

// حداقل طول رمز عبور
define('PASSWORD_MIN_LENGTH', 8);

// نام کوکی‌ها
define('COOKIE_APP_TOKEN',   'factorino_session');
define('COOKIE_ADMIN_TOKEN', 'factorino_admin');
define('COOKIE_CSRF',        'factorino_csrf');

// سقف حجم بدنه درخواست‌های JSON (بایت)
define('MAX_JSON_BODY', 4 * 1024 * 1024);

// ---------------------------------------------------------------------------
// منطقه زمانی و گزارش خطا
// ---------------------------------------------------------------------------
date_default_timezone_set((string) env('APP_TIMEZONE', 'Asia/Tehran'));

if (APP_DEBUG) {
    error_reporting(E_ALL);
    ini_set('display_errors', '1');
} else {
    error_reporting(E_ALL);
    ini_set('display_errors', '0');       // خطاها هرگز به کاربر نشان داده نمی‌شوند
    ini_set('log_errors', '1');
}

// سخت‌سازی نشست PHP (برای پنل ادمین که از session استفاده نمی‌کند نیز بی‌ضرر است)
ini_set('session.use_strict_mode', '1');
ini_set('session.cookie_httponly', '1');
ini_set('session.use_only_cookies', '1');

/**
 * آیا درخواست از طریق HTTPS است؟
 */
function is_https(): bool
{
    if (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    if (($_SERVER['SERVER_PORT'] ?? null) == 443) {
        return true;
    }
    // پشت پراکسی / لود بالانسر
    if (strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https') {
        return true;
    }
    return false;
}

/**
 * ارسال هدرهای امنیتی مشترک.
 *
 * @param bool $html اگر true باشد، CSP مناسب صفحات HTML ارسال می‌شود.
 */
function send_security_headers(bool $html = false): void
{
    if (headers_sent()) {
        return;
    }

    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: DENY');
    header('Referrer-Policy: no-referrer');
    header('Permissions-Policy: camera=(), geolocation=(), payment=(), usb=(), microphone=(self)');
    header('Cross-Origin-Opener-Policy: same-origin');
    header('Cross-Origin-Resource-Policy: same-origin');
    header_remove('X-Powered-By');

    if (is_https()) {
        header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    }

    if ($html) {
        header(
            "Content-Security-Policy: default-src 'self'; "
            . "base-uri 'self'; "
            . "object-src 'none'; "
            . "frame-ancestors 'none'; "
            . "form-action 'self'; "
            . "img-src 'self' data: blob:; "
            . "style-src 'self'; "
            . "script-src 'self'; "
            . "connect-src 'self'; "
            . "font-src 'self' data:; "
            . "media-src 'self' blob:"
        );
    }
}

/**
 * آدرس IP بازدیدکننده (با در نظر گرفتن پراکسی مورد اعتماد).
 */
function client_ip(): string
{
    $trustProxy = env_bool('TRUST_PROXY', false);
    if ($trustProxy && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $parts = explode(',', (string) $_SERVER['HTTP_X_FORWARDED_FOR']);
        $ip = trim($parts[0]);
        if (filter_var($ip, FILTER_VALIDATE_IP)) {
            return $ip;
        }
    }
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    return filter_var($ip, FILTER_VALIDATE_IP) ? $ip : '0.0.0.0';
}

function user_agent(): string
{
    return mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 250);
}

/**
 * آیا برنامه نصب شده است؟ (وجود .env با APP_KEY)
 */
function is_installed(): bool
{
    return APP_KEY !== '' && is_file(APP_ROOT . '/.env');
}
