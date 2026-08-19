<?php
/**
 * فاکتورینو — توابع کمکی عمومی
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/config/config.php';

/** فرار امن برای خروجی HTML. */
function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
}

/** ساخت UUID نسخه ۴ با تصادفی امن. */
function uuid4(): string
{
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

/** رشته تصادفی امن (hex). */
function random_token(int $bytes = 32): string
{
    return bin2hex(random_bytes($bytes));
}

/** هش توکن برای ذخیره در پایگاه داده. */
function hash_token(string $token): string
{
    return hash('sha256', $token);
}

/**
 * تبدیل ارقام فارسی/عربی به لاتین.
 * برای همه ورودی‌های عددی کاربر ضروری است.
 */
function to_latin_digits(string $input): string
{
    $map = [
        '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4',
        '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9',
        '٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4',
        '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
        '٫' => '.', '،' => ',',
    ];
    return strtr($input, $map);
}

/**
 * نرمال‌سازی متن فارسی: یکسان‌سازی ی/ک عربی، حذف اعراب و نیم‌فاصله اضافی.
 */
function normalize_fa(string $text): string
{
    $text = trim($text);
    $map = [
        'ي' => 'ی', 'ك' => 'ک', 'ة' => 'ه', 'ۀ' => 'ه',
        'أ' => 'ا', 'إ' => 'ا', 'آ' => 'ا', 'ٱ' => 'ا',
        'ؤ' => 'و', 'ئ' => 'ی',
        "\u{200C}" => ' ', // نیم‌فاصله
        "\u{200F}" => '', "\u{200E}" => '', "\u{FEFF}" => '',
    ];
    $text = strtr($text, $map);
    // حذف اعراب
    $text = preg_replace('/[\x{064B}-\x{0652}\x{0670}]/u', '', $text) ?? $text;
    // فشرده‌سازی فاصله‌ها
    $text = preg_replace('/\s+/u', ' ', $text) ?? $text;
    return trim($text);
}

/** پاک‌سازی رشته ورودی: حذف کاراکترهای کنترلی و محدود کردن طول. */
function clean_string($value, int $maxLength = 255): string
{
    if (!is_scalar($value)) {
        return '';
    }
    $value = (string) $value;
    // حذف کاراکترهای کنترلی به جز \n و \t
    $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $value) ?? '';
    $value = trim($value);
    if (mb_strlen($value, 'UTF-8') > $maxLength) {
        $value = mb_substr($value, 0, $maxLength, 'UTF-8');
    }
    return $value;
}

/** تبدیل امن به عدد اعشاری (با پشتیبانی از ارقام فارسی). */
function to_float($value, float $default = 0.0): float
{
    if (is_float($value) || is_int($value)) {
        return (float) $value;
    }
    if (!is_string($value)) {
        return $default;
    }
    $value = to_latin_digits(trim($value));
    $value = str_replace([',', ' ', "\u{00A0}"], '', $value);
    if ($value === '' || !is_numeric($value)) {
        return $default;
    }
    return (float) $value;
}

/** تبدیل امن به عدد صحیح. */
function to_int($value, int $default = 0): int
{
    return (int) round(to_float($value, (float) $default));
}

/** مقدار پولی معتبر و غیرمنفی. */
function money($value): float
{
    $n = to_float($value, 0.0);
    if (!is_finite($n) || $n < 0) {
        return 0.0;
    }
    return round(min($n, 999999999999.99), 2);
}

/** اعتبارسنجی ایمیل و نرمال‌سازی. */
function normalize_email($value): ?string
{
    $email = trim(mb_strtolower((string) $value, 'UTF-8'));
    if ($email === '' || mb_strlen($email) > 190) {
        return null;
    }
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
        return null;
    }
    return $email;
}

/** تاریخ به شکل Y-m-d یا امروز. */
function normalize_date($value): string
{
    $value = to_latin_digits(trim((string) $value));
    $d = DateTime::createFromFormat('Y-m-d', $value);
    if ($d && $d->format('Y-m-d') === $value) {
        return $value;
    }
    return date('Y-m-d');
}

/** بررسی قدرت رمز عبور. برمی‌گرداند: پیام خطا یا null در صورت معتبر بودن. */
function password_problem(string $password): ?string
{
    $len = mb_strlen($password, 'UTF-8');
    if ($len < PASSWORD_MIN_LENGTH) {
        return 'رمز عبور باید حداقل ' . PASSWORD_MIN_LENGTH . ' کاراکتر باشد.';
    }
    if ($len > 200) {
        return 'رمز عبور بیش از حد طولانی است.';
    }
    if (!preg_match('/[A-Za-z\x{0600}-\x{06FF}]/u', $password)) {
        return 'رمز عبور باید حداقل یک حرف داشته باشد.';
    }
    if (!preg_match('/[0-9۰-۹]/u', $password)) {
        return 'رمز عبور باید حداقل یک رقم داشته باشد.';
    }
    $weak = ['password', '12345678', 'qwertyui', '123456789', 'iloveyou', 'admin123'];
    if (in_array(mb_strtolower($password, 'UTF-8'), $weak, true)) {
        return 'این رمز عبور بسیار ساده است؛ رمز قوی‌تری انتخاب کنید.';
    }
    return null;
}

/** هش رمز عبور با بهترین الگوریتم موجود. */
function hash_password(string $password): string
{
    if (defined('PASSWORD_ARGON2ID') && in_array('argon2id', password_algos(), true)) {
        return password_hash($password, PASSWORD_ARGON2ID);
    }
    return password_hash($password, PASSWORD_BCRYPT, ['cost' => 11]);
}

/** ثبت رویداد در گزارش فعالیت‌ها. */
function log_activity(
    ?int $userId,
    ?int $actorId,
    string $action,
    string $message = '',
    string $entity = '',
    string $entityId = ''
): void {
    try {
        Database::run(
            'INSERT INTO activity_logs (user_id, actor_id, action, entity, entity_id, message, ip, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $userId,
                $actorId,
                clean_string($action, 60),
                clean_string($entity, 40),
                clean_string($entityId, 64),
                clean_string($message, 400),
                client_ip(),
                user_agent(),
            ]
        );
    } catch (Throwable $e) {
        error_log('[factorino] activity log failed: ' . $e->getMessage());
    }
}

/** خواندن تنظیم کلی برنامه. */
function app_setting(string $key, ?string $default = null): ?string
{
    static $cache = [];
    if (array_key_exists($key, $cache)) {
        return $cache[$key];
    }
    try {
        $val = Database::value('SELECT value FROM app_settings WHERE `key` = ?', [$key]);
    } catch (Throwable $e) {
        $val = null;
    }
    $cache[$key] = $val !== null ? (string) $val : $default;
    return $cache[$key];
}

/** نوشتن تنظیم کلی برنامه. */
function set_app_setting(string $key, string $value): void
{
    if (DB_DRIVER === 'sqlite') {
        Database::run(
            'INSERT INTO app_settings (`key`, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(`key`) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
            [$key, $value, Database::now()]
        );
        return;
    }
    Database::run(
        'INSERT INTO app_settings (`key`, value) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [$key, $value]
    );
}
