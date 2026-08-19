<?php
/**
 * فاکتورینو — API آمار و گزارش‌ها
 *
 * GET ?action=dashboard     → آمار خلاصه داشبورد
 * GET ?action=monthly       → فروش ۱۲ ماه اخیر
 * GET ?action=top-products  → پرفروش‌ترین محصولات
 * GET ?action=top-customers → بهترین مشتری‌ها
 */

declare(strict_types=1);

require_once dirname(__DIR__) . '/config/database.php';
require_once dirname(__DIR__) . '/includes/helpers.php';
require_once dirname(__DIR__) . '/includes/response.php';
require_once dirname(__DIR__) . '/includes/auth.php';

send_security_headers(false);

if (!is_installed()) {
    Response::error('برنامه هنوز نصب نشده است.', 503);
}

Response::requireMethod('GET');

$user   = Auth::requireUser();
$userId = (int) $user['id'];
$action = (string) ($_GET['action'] ?? 'dashboard');

try {
    switch ($action) {
        case 'dashboard':     stats_dashboard($userId); break;
        case 'monthly':       stats_monthly($userId); break;
        case 'top-products':  stats_top_products($userId); break;
        case 'top-customers': stats_top_customers($userId); break;
        default:              Response::notFound('عملیات درخواستی شناخته نشد.');
    }
} catch (Throwable $e) {
    Response::serverError($e);
}

function stats_dashboard(int $userId): void
{
    $today      = date('Y-m-d');
    $monthStart = date('Y-m-01');
    $yearStart  = date('Y-01-01');

    $sum = static function (string $from, string $to, int $userId): array {
        $row = Database::first(
            "SELECT COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS amount
             FROM invoices
             WHERE user_id = ? AND deleted_at IS NULL AND status = 'final'
               AND issue_date >= ? AND issue_date <= ?",
            [$userId, $from, $to]
        ) ?? ['cnt' => 0, 'amount' => 0];
        return ['count' => (int) $row['cnt'], 'amount' => (float) $row['amount']];
    };

    $unpaid = Database::first(
        "SELECT COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS amount
         FROM invoices
         WHERE user_id = ? AND deleted_at IS NULL AND status = 'final' AND payment_status <> 'paid'",
        [$userId]
    ) ?? ['cnt' => 0, 'amount' => 0];

    $counts = Database::first(
        'SELECT
            (SELECT COUNT(*) FROM products  WHERE user_id = ? AND deleted_at IS NULL AND is_active = 1) AS products,
            (SELECT COUNT(*) FROM customers WHERE user_id = ? AND deleted_at IS NULL) AS customers,
            (SELECT COUNT(*) FROM invoices  WHERE user_id = ? AND deleted_at IS NULL) AS invoices',
        [$userId, $userId, $userId]
    ) ?? ['products' => 0, 'customers' => 0, 'invoices' => 0];

    $recent = Database::all(
        "SELECT uuid, number, customer_name, issue_date, total, payment_status
         FROM invoices
         WHERE user_id = ? AND deleted_at IS NULL
         ORDER BY issue_date DESC, id DESC LIMIT 8",
        [$userId]
    );

    Response::success([
        'today'  => $sum($today, $today, $userId),
        'month'  => $sum($monthStart, date('Y-m-t'), $userId),
        'year'   => $sum($yearStart, date('Y-12-31'), $userId),
        'unpaid' => ['count' => (int) $unpaid['cnt'], 'amount' => (float) $unpaid['amount']],
        'counts' => [
            'products'  => (int) $counts['products'],
            'customers' => (int) $counts['customers'],
            'invoices'  => (int) $counts['invoices'],
        ],
        'recentInvoices' => array_map(static fn(array $r): array => [
            'uuid'          => $r['uuid'],
            'number'        => $r['number'],
            'customerName'  => $r['customer_name'],
            'issueDate'     => $r['issue_date'],
            'total'         => (float) $r['total'],
            'paymentStatus' => $r['payment_status'],
        ], $recent),
    ]);
}

function stats_monthly(int $userId): void
{
    $months = max(1, min(24, to_int($_GET['months'] ?? 12, 12)));
    $from   = date('Y-m-01', strtotime('-' . ($months - 1) . ' months'));

    $rows = Database::all(
        "SELECT SUBSTR(issue_date, 1, 7) AS ym, COUNT(*) AS cnt, COALESCE(SUM(total), 0) AS amount
         FROM invoices
         WHERE user_id = ? AND deleted_at IS NULL AND status = 'final' AND issue_date >= ?
         GROUP BY SUBSTR(issue_date, 1, 7)
         ORDER BY ym ASC",
        [$userId, $from]
    );

    $byMonth = [];
    foreach ($rows as $r) {
        $byMonth[(string) $r['ym']] = ['count' => (int) $r['cnt'], 'amount' => (float) $r['amount']];
    }

    $series = [];
    for ($i = $months - 1; $i >= 0; $i--) {
        $ym = date('Y-m', strtotime('-' . $i . ' months'));
        $series[] = [
            'month'  => $ym,
            'count'  => $byMonth[$ym]['count'] ?? 0,
            'amount' => $byMonth[$ym]['amount'] ?? 0.0,
        ];
    }

    Response::success(['series' => $series]);
}

function stats_top_products(int $userId): void
{
    $limit = max(1, min(50, to_int($_GET['limit'] ?? 10, 10)));
    $rows  = Database::all(
        "SELECT ii.name, SUM(ii.qty) AS qty, SUM(ii.line_total) AS amount, COUNT(DISTINCT i.id) AS invoices
         FROM invoice_items ii
         INNER JOIN invoices i ON i.id = ii.invoice_id
         WHERE i.user_id = ? AND i.deleted_at IS NULL AND i.status = 'final'
         GROUP BY ii.name
         ORDER BY amount DESC
         LIMIT " . $limit,
        [$userId]
    );

    Response::success([
        'products' => array_map(static fn(array $r): array => [
            'name'     => $r['name'],
            'qty'      => (float) $r['qty'],
            'amount'   => (float) $r['amount'],
            'invoices' => (int) $r['invoices'],
        ], $rows),
    ]);
}

function stats_top_customers(int $userId): void
{
    $limit = max(1, min(50, to_int($_GET['limit'] ?? 10, 10)));
    $rows  = Database::all(
        "SELECT customer_name AS name, COUNT(*) AS invoices, COALESCE(SUM(total), 0) AS amount,
                MAX(issue_date) AS last_date
         FROM invoices
         WHERE user_id = ? AND deleted_at IS NULL AND status = 'final' AND customer_name <> ''
         GROUP BY customer_name
         ORDER BY amount DESC
         LIMIT " . $limit,
        [$userId]
    );

    Response::success([
        'customers' => array_map(static fn(array $r): array => [
            'name'      => $r['name'],
            'invoices'  => (int) $r['invoices'],
            'amount'    => (float) $r['amount'],
            'lastDate'  => $r['last_date'],
        ], $rows),
    ]);
}
