<?php
/**
 * فاکتورینو — راه‌انداز مشترک پنل مدیریت
 *
 * هر صفحه پنل باید این فایل را در ابتدای خود require کند.
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/config/database.php';
require_once dirname(__DIR__) . '/includes/helpers.php';
require_once dirname(__DIR__) . '/includes/auth.php';
require_once dirname(__DIR__) . '/includes/csrf.php';

send_security_headers(true);

if (!is_installed()) {
    header('Location: ../install.php');
    exit;
}

/** صفحه جاری برای فعال‌سازی منو. */
function admin_page(): string
{
    return basename((string) ($_SERVER['SCRIPT_NAME'] ?? ''), '.php');
}

/** قالب‌بندی عدد فارسی با جداکننده هزارگان. */
function fa_number($n, int $decimals = 0): string
{
    $s = number_format((float) $n, $decimals, '.', ',');
    return strtr($s, ['0' => '۰', '1' => '۱', '2' => '۲', '3' => '۳', '4' => '۴',
                      '5' => '۵', '6' => '۶', '7' => '۷', '8' => '۸', '9' => '۹']);
}

/** تاریخ خوانا. */
function fa_datetime(?string $dt, bool $withTime = true): string
{
    if ($dt === null || $dt === '' || str_starts_with($dt, '0000')) {
        return '—';
    }
    $ts = strtotime($dt);
    if ($ts === false) {
        return '—';
    }
    return fa_number((int) date('Y', $ts)) === '' ? '—'
        : strtr(date($withTime ? 'Y/m/d H:i' : 'Y/m/d', $ts), [
            '0' => '۰', '1' => '۱', '2' => '۲', '3' => '۳', '4' => '۴',
            '5' => '۵', '6' => '۶', '7' => '۷', '8' => '۸', '9' => '۹',
        ]);
}

/** فاصله زمانی خوانا («۳ دقیقه پیش»). */
function fa_ago(?string $dt): string
{
    if ($dt === null || $dt === '') {
        return 'هرگز';
    }
    $ts = strtotime($dt);
    if ($ts === false) {
        return 'هرگز';
    }
    $diff = time() - $ts;
    if ($diff < 60)     return 'همین حالا';
    if ($diff < 3600)   return fa_number(intdiv($diff, 60)) . ' دقیقه پیش';
    if ($diff < 86400)  return fa_number(intdiv($diff, 3600)) . ' ساعت پیش';
    if ($diff < 2592000) return fa_number(intdiv($diff, 86400)) . ' روز پیش';
    return fa_datetime($dt, false);
}

/** پیام فلش ساده از طریق کوئری‌استرینگ. */
function flash_from_query(): array
{
    $out = [];
    if (isset($_GET['ok']))  { $out[] = ['ok',  clean_string($_GET['ok'], 200)]; }
    if (isset($_GET['err'])) { $out[] = ['err', clean_string($_GET['err'], 200)]; }
    return $out;
}

function redirect_with(string $page, string $type, string $message, array $extra = []): void
{
    $params = array_merge($extra, [$type => $message]);
    header('Location: ' . $page . '?' . http_build_query($params));
    exit;
}
