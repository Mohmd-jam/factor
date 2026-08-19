<?php
/**
 * فاکتورینو — لایه احراز هویت
 *
 * روش: توکن تصادفی ۳۲ بایتی که فقط هش SHA-256 آن در پایگاه داده ذخیره می‌شود.
 * توکن هم در کوکی HttpOnly قرار می‌گیرد (امن در برابر XSS) و هم برای سازگاری
 * با حالت PWA/آفلاین از هدر Authorization پذیرفته می‌شود.
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/config/database.php';
require_once __DIR__ . '/helpers.php';

final class Auth
{
    private static ?array $currentUser = null;

    // -----------------------------------------------------------------------
    // کوکی‌ها
    // -----------------------------------------------------------------------

    private static function cookieBasePath(): string
    {
        // مسیر نصب برنامه را خودکار تشخیص می‌دهد تا هم روی
        // http://localhost/factorino و هم روی دامنه اصلی کار کند.
        $script = (string) ($_SERVER['SCRIPT_NAME'] ?? '/');
        $dir = str_replace('\\', '/', dirname($script));
        // اگر داخل api/ یا admin/ هستیم، یک سطح بالاتر برو
        $dir = preg_replace('#/(api|admin)$#', '', $dir) ?? $dir;
        if ($dir === '' || $dir === '.') {
            $dir = '/';
        }
        return rtrim($dir, '/') . '/';
    }

    public static function setAuthCookie(string $name, string $token, int $ttl): void
    {
        if (headers_sent()) {
            return;
        }
        setcookie($name, $token, [
            'expires'  => time() + $ttl,
            'path'     => self::cookieBasePath(),
            'domain'   => '',
            'secure'   => is_https(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    public static function clearAuthCookie(string $name): void
    {
        if (headers_sent()) {
            return;
        }
        setcookie($name, '', [
            'expires'  => time() - 3600,
            'path'     => self::cookieBasePath(),
            'secure'   => is_https(),
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
    }

    // -----------------------------------------------------------------------
    // خواندن توکن از درخواست
    // -----------------------------------------------------------------------

    public static function bearerToken(): ?string
    {
        $header = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
        if ($header === '' && function_exists('apache_request_headers')) {
            $headers = apache_request_headers();
            foreach ($headers as $key => $value) {
                if (strcasecmp($key, 'Authorization') === 0) {
                    $header = (string) $value;
                    break;
                }
            }
        }
        if (preg_match('/^Bearer\s+([A-Za-z0-9._-]{20,255})$/i', trim($header), $m) === 1) {
            return $m[1];
        }
        return null;
    }

    public static function tokenFromRequest(string $scope = 'app'): ?string
    {
        // هدر Authorization اولویت دارد: این هدر را فقط کد جاوااسکریپت خودمان
        // به‌صورت صریح می‌فرستد، در حالی که کوکی ممکن است توسط یک زیردامنه یا
        // حمله‌ی session fixation کاشته شده باشد. با این ترتیب، خروج از حساب
        // هم همان نشستی را باطل می‌کند که درخواست با آن احراز هویت شده است.
        if ($scope === 'app') {
            $bearer = self::bearerToken();
            if ($bearer !== null) {
                return $bearer;
            }
        }

        $cookieName = $scope === 'admin' ? COOKIE_ADMIN_TOKEN : COOKIE_APP_TOKEN;
        $cookie = $_COOKIE[$cookieName] ?? null;
        if (is_string($cookie) && preg_match('/^[a-f0-9]{40,128}$/i', $cookie) === 1) {
            return $cookie;
        }

        return null;
    }

    // -----------------------------------------------------------------------
    // ساخت و ابطال نشست
    // -----------------------------------------------------------------------

    public static function createSession(int $userId, string $scope = 'app'): string
    {
        $token = random_token(32);
        $ttl   = $scope === 'admin' ? SESSION_TTL_ADMIN : SESSION_TTL_APP;

        Database::run(
            'INSERT INTO sessions (user_id, token_hash, scope, ip, user_agent, created_at, last_seen_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                $userId,
                hash_token($token),
                $scope,
                client_ip(),
                user_agent(),
                Database::now(),
                Database::now(),
                date('Y-m-d H:i:s', time() + $ttl),
            ]
        );

        self::setAuthCookie(
            $scope === 'admin' ? COOKIE_ADMIN_TOKEN : COOKIE_APP_TOKEN,
            $token,
            $ttl
        );

        // پاک‌سازی نشست‌های منقضی (نگهداری سبک)
        try {
            Database::run('DELETE FROM sessions WHERE expires_at < ?', [Database::now()]);
        } catch (Throwable $e) {
            // بی‌اهمیت
        }

        return $token;
    }

    public static function revokeToken(?string $token, string $scope = 'app'): void
    {
        if ($token !== null && $token !== '') {
            try {
                Database::run(
                    'UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
                    [Database::now(), hash_token($token)]
                );
            } catch (Throwable $e) {
                error_log('[factorino] revoke failed: ' . $e->getMessage());
            }
        }
        self::clearAuthCookie($scope === 'admin' ? COOKIE_ADMIN_TOKEN : COOKIE_APP_TOKEN);
        self::$currentUser = null;
    }

    /** ابطال همه نشست‌های یک کاربر (مثلاً پس از تغییر رمز یا تعلیق توسط ادمین). */
    public static function revokeAllSessions(int $userId): void
    {
        Database::run(
            'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
            [Database::now(), $userId]
        );
    }

    // -----------------------------------------------------------------------
    // کاربر جاری
    // -----------------------------------------------------------------------

    /**
     * کاربر جاری را برمی‌گرداند یا null.
     * وضعیت suspended و کاربر حذف‌شده به‌صورت خودکار رد می‌شود.
     */
    public static function user(string $scope = 'app'): ?array
    {
        if (self::$currentUser !== null && (self::$currentUser['_scope'] ?? '') === $scope) {
            return self::$currentUser;
        }

        $token = self::tokenFromRequest($scope);
        if ($token === null) {
            return null;
        }

        try {
            $row = Database::first(
                'SELECT s.id AS session_id, s.scope, s.expires_at,
                        u.id, u.uuid, u.email, u.business_name, u.owner_name, u.phone,
                        u.role, u.status, u.created_at, u.last_login_at
                 FROM sessions s
                 INNER JOIN users u ON u.id = s.user_id
                 WHERE s.token_hash = ?
                   AND s.revoked_at IS NULL
                   AND s.expires_at > ?
                   AND u.deleted_at IS NULL',
                [hash_token($token), Database::now()]
            );
        } catch (Throwable $e) {
            error_log('[factorino] auth lookup failed: ' . $e->getMessage());
            return null;
        }

        if ($row === null) {
            return null;
        }
        if ((string) $row['scope'] !== $scope) {
            return null;
        }
        if ((string) $row['status'] !== 'active') {
            return null;
        }
        if ($scope === 'admin' && (string) $row['role'] !== 'admin') {
            return null;
        }

        // به‌روزرسانی last_seen (حداکثر هر ۵ دقیقه یک‌بار برای کاهش بار)
        try {
            Database::run(
                'UPDATE sessions SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?',
                [Database::now(), (int) $row['session_id'], date('Y-m-d H:i:s', time() - 300)]
            );
        } catch (Throwable $e) {
            // بی‌اهمیت
        }

        $row['id']     = (int) $row['id'];
        $row['_scope'] = $scope;
        self::$currentUser = $row;
        return $row;
    }

    /** برای APIها: در صورت نبود کاربر، پاسخ 401 و پایان اجرا. */
    public static function requireUser(): array
    {
        $user = self::user('app');
        if ($user === null) {
            require_once __DIR__ . '/response.php';
            Response::unauthorized();
        }
        return $user;
    }

    /** برای پنل ادمین: در صورت نبود ادمین، هدایت به صفحه ورود. */
    public static function requireAdmin(string $loginUrl = 'login.php'): array
    {
        $user = self::user('admin');
        if ($user === null) {
            header('Location: ' . $loginUrl);
            exit;
        }
        return $user;
    }

    // -----------------------------------------------------------------------
    // محدودسازی نرخ ورود
    // -----------------------------------------------------------------------

    public static function recordLoginAttempt(?string $email, bool $success): void
    {
        try {
            Database::run(
                'INSERT INTO login_attempts (email, ip, success, created_at) VALUES (?, ?, ?, ?)',
                [$email, client_ip(), $success ? 1 : 0, Database::now()]
            );
            // نگهداری فقط ۳۰ روز اخیر
            if (random_int(1, 50) === 1) {
                Database::run(
                    'DELETE FROM login_attempts WHERE created_at < ?',
                    [date('Y-m-d H:i:s', time() - 2592000)]
                );
            }
        } catch (Throwable $e) {
            error_log('[factorino] attempt log failed: ' . $e->getMessage());
        }
    }

    /**
     * آیا این IP/ایمیل فعلاً مسدود است؟
     * برمی‌گرداند: تعداد ثانیه باقی‌مانده یا 0 اگر آزاد باشد.
     */
    public static function throttleSeconds(?string $email): int
    {
        try {
            $since = date('Y-m-d H:i:s', time() - LOGIN_WINDOW_SECONDS);

            $byIp = (int) Database::value(
                'SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND success = 0 AND created_at > ?',
                [client_ip(), $since]
            );
            if ($byIp >= LOGIN_MAX_ATTEMPTS_IP) {
                return LOGIN_LOCK_SECONDS;
            }

            if ($email !== null && $email !== '') {
                $byEmail = (int) Database::value(
                    'SELECT COUNT(*) FROM login_attempts WHERE email = ? AND success = 0 AND created_at > ?',
                    [$email, $since]
                );
                if ($byEmail >= LOGIN_MAX_ATTEMPTS_EMAIL) {
                    return LOGIN_LOCK_SECONDS;
                }
            }
        } catch (Throwable $e) {
            return 0;
        }
        return 0;
    }

    /** پاک کردن تلاش‌های ناموفق پس از ورود موفق. */
    public static function clearAttempts(string $email): void
    {
        try {
            Database::run(
                'DELETE FROM login_attempts WHERE (email = ? OR ip = ?) AND success = 0',
                [$email, client_ip()]
            );
        } catch (Throwable $e) {
            // بی‌اهمیت
        }
    }

    // -----------------------------------------------------------------------
    // ورود
    // -----------------------------------------------------------------------

    /**
     * تلاش برای ورود.
     *
     * @return array{ok:bool, user?:array, error?:string, status?:int}
     */
    public static function attemptLogin(string $email, string $password, string $scope = 'app'): array
    {
        $email = (string) normalize_email($email);

        $wait = self::throttleSeconds($email !== '' ? $email : null);
        if ($wait > 0) {
            return [
                'ok'     => false,
                'error'  => 'به دلیل تلاش‌های ناموفق زیاد، ورود موقتاً مسدود شده است. لطفاً چند دقیقه دیگر تلاش کنید.',
                'status' => 429,
            ];
        }

        $user = null;
        if ($email !== '') {
            $user = Database::first(
                'SELECT id, email, password_hash, business_name, role, status, locked_until
                 FROM users WHERE email = ? AND deleted_at IS NULL',
                [$email]
            );
        }

        // محاسبه زمان ثابت: حتی وقتی کاربر وجود ندارد یک هش ساختگی بررسی می‌شود
        // تا از حمله شمارش کاربران (user enumeration by timing) جلوگیری شود.
        $hash = $user['password_hash'] ?? '$2y$11$usesomesillystringforeadinglikeaninvalidhashvaluexxxxxxxxxxx';
        $passwordOk = password_verify($password, $hash);

        if ($user === null || !$passwordOk) {
            self::recordLoginAttempt($email !== '' ? $email : null, false);
            return [
                'ok'     => false,
                'error'  => 'ایمیل یا رمز عبور اشتباه است.',
                'status' => 401,
            ];
        }

        if ((string) $user['status'] !== 'active') {
            self::recordLoginAttempt($email, false);
            return [
                'ok'     => false,
                'error'  => 'حساب کاربری شما توسط مدیر سیستم غیرفعال شده است.',
                'status' => 403,
            ];
        }

        if ($scope === 'admin' && (string) $user['role'] !== 'admin') {
            self::recordLoginAttempt($email, false);
            return [
                'ok'     => false,
                'error'  => 'این حساب دسترسی مدیریت ندارد.',
                'status' => 403,
            ];
        }

        // ارتقای هش در صورت نیاز
        try {
            $needsRehash = defined('PASSWORD_ARGON2ID') && in_array('argon2id', password_algos(), true)
                ? password_needs_rehash($user['password_hash'], PASSWORD_ARGON2ID)
                : password_needs_rehash($user['password_hash'], PASSWORD_BCRYPT, ['cost' => 11]);
            if ($needsRehash) {
                Database::run(
                    'UPDATE users SET password_hash = ? WHERE id = ?',
                    [hash_password($password), (int) $user['id']]
                );
            }
        } catch (Throwable $e) {
            // بی‌اهمیت
        }

        self::recordLoginAttempt($email, true);
        self::clearAttempts($email);

        Database::run(
            'UPDATE users SET last_login_at = ?, last_login_ip = ?, failed_attempts = 0 WHERE id = ?',
            [Database::now(), client_ip(), (int) $user['id']]
        );

        $user['id'] = (int) $user['id'];
        return ['ok' => true, 'user' => $user];
    }
}
