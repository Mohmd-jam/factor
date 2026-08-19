<?php
/**
 * فاکتورینو — محافظت CSRF
 *
 * روش «کوکی دوگانه» (double-submit cookie) با امضای HMAC:
 * توکن در کوکی قرار می‌گیرد و باید در فرم/هدر هم ارسال شود.
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

final class Csrf
{
    private static ?string $token = null;

    private static function key(): string
    {
        $key = APP_KEY;
        if ($key === '') {
            // اگر هنوز نصب نشده، از یک کلید موقت مبتنی بر مسیر استفاده می‌کنیم.
            $key = hash('sha256', APP_ROOT . '|factorino-install');
        }
        return $key;
    }

    private static function sign(string $value): string
    {
        return hash_hmac('sha256', $value, self::key());
    }

    /** توکن جاری را برمی‌گرداند و در صورت نبود، می‌سازد. */
    public static function token(): string
    {
        if (self::$token !== null) {
            return self::$token;
        }

        $cookie = $_COOKIE[COOKIE_CSRF] ?? '';
        if (is_string($cookie) && preg_match('/^[a-f0-9]{32}\.[a-f0-9]{64}$/', $cookie) === 1) {
            [$random, $sig] = explode('.', $cookie, 2);
            if (hash_equals(self::sign($random), $sig)) {
                self::$token = $cookie;
                return self::$token;
            }
        }

        $random = bin2hex(random_bytes(16));
        $token  = $random . '.' . self::sign($random);
        self::$token = $token;

        if (!headers_sent()) {
            setcookie(COOKIE_CSRF, $token, [
                'expires'  => time() + 86400,
                'path'     => '/',
                'secure'   => is_https(),
                'httponly' => false, // باید توسط JS برای هدر خوانده شود
                'samesite' => 'Lax',
            ]);
        }
        $_COOKIE[COOKIE_CSRF] = $token;

        return $token;
    }

    /** اعتبارسنجی توکن ارسالی. */
    public static function validate(?string $submitted): bool
    {
        if (!is_string($submitted) || $submitted === '') {
            return false;
        }
        if (preg_match('/^[a-f0-9]{32}\.[a-f0-9]{64}$/', $submitted) !== 1) {
            return false;
        }
        [$random, $sig] = explode('.', $submitted, 2);
        if (!hash_equals(self::sign($random), $sig)) {
            return false;
        }

        $cookie = $_COOKIE[COOKIE_CSRF] ?? '';
        if (!is_string($cookie) || $cookie === '') {
            return false;
        }
        return hash_equals($cookie, $submitted);
    }

    /** توکن ارسال‌شده در هدر یا بدنه فرم. */
    public static function fromRequest(array $jsonBody = []): ?string
    {
        $header = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? null;
        if (is_string($header) && $header !== '') {
            return $header;
        }
        if (isset($_POST['_csrf']) && is_string($_POST['_csrf'])) {
            return $_POST['_csrf'];
        }
        if (isset($jsonBody['_csrf']) && is_string($jsonBody['_csrf'])) {
            return $jsonBody['_csrf'];
        }
        return null;
    }

    /**
     * اجبار به داشتن توکن معتبر برای درخواست‌های تغییردهنده.
     * در صورت نامعتبر بودن، اجرا متوقف می‌شود.
     */
    public static function requireValid(array $jsonBody = [], bool $json = true): void
    {
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
            return;
        }

        if (!self::validate(self::fromRequest($jsonBody))) {
            if ($json) {
                require_once __DIR__ . '/response.php';
                Response::error('توکن امنیتی نامعتبر یا منقضی است. صفحه را تازه‌سازی کنید.', 419);
            }
            http_response_code(419);
            header('Content-Type: text/html; charset=utf-8');
            echo '<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8">'
                . '<title>خطای امنیتی</title><p style="font-family:sans-serif;padding:2rem">'
                . 'توکن امنیتی نامعتبر است. لطفاً صفحه را تازه‌سازی کنید و دوباره تلاش کنید.</p></html>';
            exit;
        }
    }

    /** فیلد مخفی آماده برای فرم‌های HTML. */
    public static function field(): string
    {
        return '<input type="hidden" name="_csrf" value="' . e(self::token()) . '">';
    }
}
