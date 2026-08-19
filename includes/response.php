<?php
/**
 * فاکتورینو — پاسخ‌های JSON استاندارد برای API
 */

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

final class Response
{
    private static function emit(int $status, array $payload): void
    {
        if (!headers_sent()) {
            http_response_code($status);
            header('Content-Type: application/json; charset=utf-8');
            header('Cache-Control: no-store, no-cache, must-revalidate, private');
            header('Pragma: no-cache');
            send_security_headers(false);
        }
        echo json_encode(
            $payload,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
        );
        exit;
    }

    public static function success($data = null, string $message = '', int $status = 200): void
    {
        $payload = ['success' => true];
        if ($message !== '') {
            $payload['message'] = $message;
        }
        if ($data !== null) {
            $payload['data'] = $data;
        }
        self::emit($status, $payload);
    }

    public static function error(string $message, int $status = 400, array $extra = []): void
    {
        self::emit($status, array_merge([
            'success' => false,
            'error'   => $message,
        ], $extra));
    }

    public static function unauthorized(string $message = 'برای ادامه باید وارد حساب کاربری شوید.'): void
    {
        self::error($message, 401);
    }

    public static function forbidden(string $message = 'دسترسی شما به این بخش مجاز نیست.'): void
    {
        self::error($message, 403);
    }

    public static function notFound(string $message = 'موردی پیدا نشد.'): void
    {
        self::error($message, 404);
    }

    public static function validation(array $errors, string $message = 'اطلاعات وارد شده معتبر نیست.'): void
    {
        self::error($message, 422, ['fields' => $errors]);
    }

    public static function tooMany(string $message = 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.', int $retryAfter = 60): void
    {
        if (!headers_sent()) {
            header('Retry-After: ' . $retryAfter);
        }
        self::error($message, 429);
    }

    /** خطای داخلی؛ جزئیات فقط در لاگ سرور ثبت می‌شود نه در پاسخ. */
    public static function serverError(Throwable $e, string $message = 'خطای داخلی سرور رخ داد.'): void
    {
        error_log('[factorino] ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
        $extra = APP_DEBUG ? ['debug' => $e->getMessage()] : [];
        self::error($message, 500, $extra);
    }

    /**
     * خواندن بدنه JSON درخواست به صورت امن.
     */
    public static function jsonBody(): array
    {
        $contentLength = (int) ($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($contentLength > MAX_JSON_BODY) {
            self::error('حجم درخواست بیش از حد مجاز است.', 413);
        }

        $raw = file_get_contents('php://input', false, null, 0, MAX_JSON_BODY + 1);
        if ($raw === false || $raw === '') {
            return [];
        }
        if (strlen($raw) > MAX_JSON_BODY) {
            self::error('حجم درخواست بیش از حد مجاز است.', 413);
        }

        $data = json_decode($raw, true, 64);
        if (json_last_error() !== JSON_ERROR_NONE || !is_array($data)) {
            self::error('قالب داده ارسالی معتبر نیست (JSON نامعتبر).', 400);
        }
        return $data;
    }

    /** بررسی متد HTTP مجاز. */
    public static function requireMethod(string ...$methods): string
    {
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        if ($method === 'OPTIONS') {
            http_response_code(204);
            header('Allow: ' . implode(', ', array_merge($methods, ['OPTIONS'])));
            exit;
        }
        if (!in_array($method, array_map('strtoupper', $methods), true)) {
            if (!headers_sent()) {
                header('Allow: ' . implode(', ', $methods));
            }
            self::error('این متد برای آدرس موردنظر مجاز نیست.', 405);
        }
        return $method;
    }
}
