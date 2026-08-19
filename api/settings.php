<?php
/**
 * فاکتورینو — API تنظیمات کاربر
 *
 * GET  ?action=get   → خواندن تنظیمات
 * POST ?action=save  → ذخیره تنظیمات
 * POST ?action=logo  → ذخیره/حذف لوگو (data URL)
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/config/database.php';
require_once dirname(__DIR__) . '/includes/helpers.php';
require_once dirname(__DIR__) . '/includes/response.php';
require_once dirname(__DIR__) . '/includes/auth.php';
require_once dirname(__DIR__) . '/includes/csrf.php';

send_security_headers(false);

if (!is_installed()) {
    Response::error('برنامه هنوز نصب نشده است.', 503);
}

$user   = Auth::requireUser();
$userId = (int) $user['id'];
$action = (string) ($_GET['action'] ?? 'get');

/** حداکثر حجم لوگو پس از رمزگشایی base64 (۱ مگابایت) */
const MAX_LOGO_BYTES = 1048576;

try {
    switch ($action) {
        case 'get':  settings_get($userId); break;
        case 'save': settings_save($userId); break;
        case 'logo': settings_logo($userId); break;
        default:     Response::notFound('عملیات درخواستی شناخته نشد.');
    }
} catch (Throwable $e) {
    Response::serverError($e);
}

function settings_row(int $userId): array
{
    $row = Database::first('SELECT * FROM user_settings WHERE user_id = ?', [$userId]);
    if ($row === null) {
        Database::run(
            'INSERT INTO user_settings (user_id, business_name, updated_at) VALUES (?, ?, ?)',
            [$userId, '', Database::now()]
        );
        $row = Database::first('SELECT * FROM user_settings WHERE user_id = ?', [$userId]) ?? [];
    }
    return $row;
}

function to_payload(array $s): array
{
    return [
        'businessName'      => $s['business_name'] ?? '',
        'ownerName'         => $s['owner_name'] ?? '',
        'phone'             => $s['phone'] ?? '',
        'taxId'             => $s['tax_id'] ?? '',
        'email'             => $s['email'] ?? '',
        'address'           => $s['address'] ?? '',
        'logo'              => $s['logo'] ?? null,
        'invoicePrefix'     => $s['invoice_prefix'] ?? 'INV-',
        'nextInvoiceNumber' => (int) ($s['next_invoice_number'] ?? 1),
        'currency'          => $s['currency'] ?? 'تومان',
        'taxPercent'        => (float) ($s['tax_percent'] ?? 0),
        'invoiceFooter'     => $s['invoice_footer'] ?? '',
        'voiceEnabled'      => (bool) ($s['voice_enabled'] ?? 1),
        'updatedAt'         => $s['updated_at'] ?? null,
    ];
}

function settings_get(int $userId): void
{
    Response::requireMethod('GET');
    Response::success([
        'settings' => to_payload(settings_row($userId)),
        'app'      => [
            'name'         => app_setting('app_name', APP_NAME),
            'version'      => APP_VERSION,
            'announcement' => app_setting('announcement', ''),
        ],
        'csrf' => Csrf::token(),
    ]);
}

function settings_save(int $userId): void
{
    Response::requireMethod('POST');
    $body = Response::jsonBody();
    Csrf::requireValid($body);

    settings_row($userId); // اطمینان از وجود ردیف

    $errors = [];

    $businessName = clean_string($body['businessName'] ?? '', 150);
    if ($businessName === '') {
        $errors['businessName'] = 'نام کسب‌وکار نمی‌تواند خالی باشد.';
    }

    $email = trim((string) ($body['email'] ?? ''));
    if ($email !== '' && normalize_email($email) === null) {
        $errors['email'] = 'ایمیل معتبر نیست.';
    }

    $prefix = clean_string($body['invoicePrefix'] ?? 'INV-', 12);
    if ($prefix !== '' && preg_match('/^[\p{L}\p{N}\-_\/]{1,12}$/u', $prefix) !== 1) {
        $errors['invoicePrefix'] = 'پیش‌شماره فاکتور فقط می‌تواند شامل حروف، عدد و - _ / باشد.';
    }

    $taxPercent = to_float($body['taxPercent'] ?? 0);
    if ($taxPercent < 0 || $taxPercent > 100) {
        $errors['taxPercent'] = 'درصد مالیات باید بین ۰ تا ۱۰۰ باشد.';
    }

    $nextNumber = to_int($body['nextInvoiceNumber'] ?? 1, 1);
    if ($nextNumber < 1 || $nextNumber > 999999999) {
        $errors['nextInvoiceNumber'] = 'شماره فاکتور بعدی معتبر نیست.';
    }

    if ($errors !== []) {
        Response::validation($errors);
    }

    Database::run(
        'UPDATE user_settings SET
            business_name = ?, owner_name = ?, phone = ?, tax_id = ?, email = ?, address = ?,
            invoice_prefix = ?, next_invoice_number = ?, currency = ?, tax_percent = ?,
            invoice_footer = ?, voice_enabled = ?, updated_at = ?
         WHERE user_id = ?',
        [
            $businessName,
            clean_string($body['ownerName'] ?? '', 150),
            clean_string(to_latin_digits((string) ($body['phone'] ?? '')), 30),
            clean_string(to_latin_digits((string) ($body['taxId'] ?? '')), 30),
            mb_strtolower($email, 'UTF-8'),
            clean_string($body['address'] ?? '', 400),
            $prefix !== '' ? $prefix : 'INV-',
            $nextNumber,
            clean_string($body['currency'] ?? 'تومان', 20) ?: 'تومان',
            round($taxPercent, 2),
            clean_string($body['invoiceFooter'] ?? '', 400),
            isset($body['voiceEnabled']) ? (int) (bool) $body['voiceEnabled'] : 1,
            Database::now(),
            $userId,
        ]
    );

    // نام کسب‌وکار در جدول کاربران هم به‌روز می‌شود تا پنل ادمین هماهنگ بماند.
    Database::run(
        'UPDATE users SET business_name = ?, owner_name = ?, phone = ?, updated_at = ? WHERE id = ?',
        [
            $businessName,
            clean_string($body['ownerName'] ?? '', 150),
            clean_string(to_latin_digits((string) ($body['phone'] ?? '')), 30),
            Database::now(),
            $userId,
        ]
    );

    log_activity($userId, $userId, 'settings_update', 'به‌روزرسانی تنظیمات کسب‌وکار');

    Response::success(['settings' => to_payload(settings_row($userId))], 'تنظیمات ذخیره شد.');
}

function settings_logo(int $userId): void
{
    Response::requireMethod('POST');
    $body = Response::jsonBody();
    Csrf::requireValid($body);

    settings_row($userId);

    $logo = $body['logo'] ?? null;

    if ($logo === null || $logo === '' || $logo === false) {
        Database::run('UPDATE user_settings SET logo = NULL, updated_at = ? WHERE user_id = ?', [Database::now(), $userId]);
        Response::success(['logo' => null], 'لوگو حذف شد.');
    }

    if (!is_string($logo)) {
        Response::validation(['logo' => 'قالب لوگو معتبر نیست.']);
    }

    if (preg_match('#^data:image/(png|jpeg|jpg|webp|gif|svg\+xml);base64,([A-Za-z0-9+/=\s]+)$#', $logo, $m) !== 1) {
        Response::validation(['logo' => 'فقط تصویر PNG، JPG، WEBP، GIF یا SVG به صورت data URL پذیرفته می‌شود.']);
    }

    $binary = base64_decode(preg_replace('/\s+/', '', $m[2]) ?? '', true);
    if ($binary === false) {
        Response::validation(['logo' => 'داده تصویر خراب است.']);
    }
    if (strlen($binary) > MAX_LOGO_BYTES) {
        Response::error('حجم لوگو نباید بیشتر از ۱ مگابایت باشد.', 413);
    }

    // SVG می‌تواند اسکریپت داشته باشد؛ نمونه‌های خطرناک رد می‌شوند.
    if ($m[1] === 'svg+xml' && preg_match('/<script|onload=|javascript:/i', $binary) === 1) {
        Response::validation(['logo' => 'فایل SVG حاوی کد اجرایی است و پذیرفته نشد.']);
    }

    // اعتبارسنجی واقعی بودن تصویر (برای فرمت‌های رستری)
    if ($m[1] !== 'svg+xml' && function_exists('getimagesizefromstring')) {
        if (@getimagesizefromstring($binary) === false) {
            Response::validation(['logo' => 'فایل ارسالی یک تصویر معتبر نیست.']);
        }
    }

    $clean = 'data:image/' . $m[1] . ';base64,' . base64_encode($binary);
    Database::run('UPDATE user_settings SET logo = ?, updated_at = ? WHERE user_id = ?', [$clean, Database::now(), $userId]);

    log_activity($userId, $userId, 'logo_update', 'به‌روزرسانی لوگوی کسب‌وکار');
    Response::success(['logo' => $clean], 'لوگو ذخیره شد.');
}
