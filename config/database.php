<?php
/**
 * فاکتورینو — لایه اتصال به پایگاه داده (PDO)
 *
 * تمام کوئری‌ها با prepared statement اجرا می‌شوند تا امکان SQL Injection نباشد.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

final class Database
{
    private static ?PDO $pdo = null;

    private function __construct()
    {
    }

    public static function pdo(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,   // prepared statement واقعی
            PDO::ATTR_STRINGIFY_FETCHES  => false,
        ];

        try {
            if (DB_DRIVER === 'sqlite') {
                $dir = dirname(DB_SQLITE_PATH);
                if (!is_dir($dir)) {
                    @mkdir($dir, 0770, true);
                }
                self::$pdo = new PDO('sqlite:' . DB_SQLITE_PATH, null, null, $options);
                self::$pdo->exec('PRAGMA foreign_keys = ON');
                self::$pdo->exec('PRAGMA journal_mode = WAL');
            } else {
                $dsn = sprintf(
                    'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
                    DB_HOST,
                    DB_PORT,
                    DB_NAME
                );
                self::$pdo = new PDO($dsn, DB_USER, DB_PASSWORD, $options);
                self::$pdo->exec("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'");
            }
        } catch (PDOException $e) {
            error_log('[factorino] DB connection failed: ' . $e->getMessage());
            throw new RuntimeException('اتصال به پایگاه داده برقرار نشد.', 0, $e);
        }

        return self::$pdo;
    }

    /** اجرای کوئری با پارامترهای امن. */
    public static function run(string $sql, array $params = []): PDOStatement
    {
        $stmt = self::pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    /** یک ردیف یا null. */
    public static function first(string $sql, array $params = []): ?array
    {
        $row = self::run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    /** همه ردیف‌ها. */
    public static function all(string $sql, array $params = []): array
    {
        return self::run($sql, $params)->fetchAll();
    }

    /** مقدار ستون اول از ردیف اول. */
    public static function value(string $sql, array $params = [])
    {
        $val = self::run($sql, $params)->fetchColumn();
        return $val === false ? null : $val;
    }

    public static function insertId(): string
    {
        return self::pdo()->lastInsertId();
    }

    public static function begin(): void
    {
        if (!self::pdo()->inTransaction()) {
            self::pdo()->beginTransaction();
        }
    }

    public static function commit(): void
    {
        if (self::pdo()->inTransaction()) {
            self::pdo()->commit();
        }
    }

    public static function rollBack(): void
    {
        if (self::pdo()->inTransaction()) {
            self::pdo()->rollBack();
        }
    }

    /** آیا اتصال برقرار است؟ (برای صفحه نصب و health check) */
    public static function isReachable(): bool
    {
        try {
            self::pdo()->query('SELECT 1');
            return true;
        } catch (Throwable $e) {
            return false;
        }
    }

    /** آیا جدول موردنظر وجود دارد؟ */
    public static function tableExists(string $table): bool
    {
        try {
            if (DB_DRIVER === 'sqlite') {
                $row = self::first(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
                    [$table]
                );
                return $row !== null;
            }
            $row = self::first(
                'SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
                [DB_NAME, $table]
            );
            return $row !== null;
        } catch (Throwable $e) {
            return false;
        }
    }

    /** تاریخ/زمان جاری در قالب پایگاه داده. */
    public static function now(): string
    {
        return date('Y-m-d H:i:s');
    }
}
