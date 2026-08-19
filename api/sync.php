<?php
/**
 * فاکتورینو — API همگام‌سازی داده‌ها (آفلاین‑اول)
 *
 * GET  ?action=pull&since=ISO      → همه تغییرات سرور بعد از زمان داده‌شده
 * POST ?action=push                → ارسال تغییرات محلی (products/customers/invoices)
 * GET  ?action=products            → فهرست محصولات
 * GET  ?action=customers           → فهرست مشتری‌ها
 * GET  ?action=invoices            → فهرست فاکتورها (با صفحه‌بندی)
 * GET  ?action=invoice&uuid=...    → یک فاکتور با اقلامش
 * POST ?action=delete              → حذف نرم یک رکورد
 *
 * قانون طلایی: هر کوئری با user_id محدود می‌شود؛ هیچ رکوردی بین کاربران نشت نمی‌کند.
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
$action = (string) ($_GET['action'] ?? 'pull');

/** حداکثر تعداد رکورد در یک درخواست push */
const MAX_PUSH_ITEMS = 500;

try {
    switch ($action) {
        case 'pull':       action_pull($userId); break;
        case 'push':       action_push($userId); break;
        case 'products':   Response::success(['products' => fetch_products($userId)]); break;
        case 'customers':  Response::success(['customers' => fetch_customers($userId)]); break;
        case 'invoices':   action_invoices($userId); break;
        case 'invoice':    action_invoice($userId); break;
        case 'delete':     action_delete($userId); break;
        default:           Response::notFound('عملیات درخواستی شناخته نشد.');
    }
} catch (Throwable $e) {
    Response::serverError($e);
}

// ---------------------------------------------------------------------------
// خواندن
// ---------------------------------------------------------------------------

function since_param(): string
{
    $since = (string) ($_GET['since'] ?? '');
    $since = str_replace(['T', 'Z'], [' ', ''], trim($since));
    $ts = strtotime($since);
    if ($ts === false || $ts <= 0) {
        return '1970-01-01 00:00:00';
    }
    return date('Y-m-d H:i:s', $ts);
}

function fetch_products(int $userId, string $since = '1970-01-01 00:00:00'): array
{
    $rows = Database::all(
        'SELECT uuid, name, sku, category, unit, price, aliases, is_active, created_at, updated_at, deleted_at
         FROM products WHERE user_id = ? AND updated_at > ? ORDER BY name ASC',
        [$userId, $since]
    );
    return array_map(static function (array $r): array {
        return [
            'uuid'      => $r['uuid'],
            'name'      => $r['name'],
            'sku'       => $r['sku'],
            'category'  => $r['category'],
            'unit'      => $r['unit'],
            'price'     => (float) $r['price'],
            'aliases'   => $r['aliases'] === '' ? [] : array_values(array_filter(array_map('trim', explode(',', (string) $r['aliases'])))),
            'isActive'  => (bool) $r['is_active'],
            'createdAt' => $r['created_at'],
            'updatedAt' => $r['updated_at'],
            'deleted'   => $r['deleted_at'] !== null,
        ];
    }, $rows);
}

function fetch_customers(int $userId, string $since = '1970-01-01 00:00:00'): array
{
    $rows = Database::all(
        'SELECT uuid, name, phone, tax_id, city, postal_code, address, note, created_at, updated_at, deleted_at
         FROM customers WHERE user_id = ? AND updated_at > ? ORDER BY name ASC',
        [$userId, $since]
    );
    return array_map(static function (array $r): array {
        return [
            'uuid'       => $r['uuid'],
            'name'       => $r['name'],
            'phone'      => $r['phone'],
            'taxId'      => $r['tax_id'],
            'city'       => $r['city'],
            'postalCode' => $r['postal_code'],
            'address'    => $r['address'],
            'note'       => $r['note'],
            'createdAt'  => $r['created_at'],
            'updatedAt'  => $r['updated_at'],
            'deleted'    => $r['deleted_at'] !== null,
        ];
    }, $rows);
}

function fetch_invoices(int $userId, string $since = '1970-01-01 00:00:00', int $limit = 1000, int $offset = 0): array
{
    $rows = Database::all(
        'SELECT id, uuid, number, customer_uuid, customer_name, place, issue_date, status, payment_status,
                subtotal, discount, tax_percent, tax_amount, shipping, total, notes,
                created_at, updated_at, deleted_at
         FROM invoices WHERE user_id = ? AND updated_at > ?
         ORDER BY issue_date DESC, id DESC LIMIT ' . $limit . ' OFFSET ' . $offset,
        [$userId, $since]
    );
    if ($rows === []) {
        return [];
    }

    $ids = array_column($rows, 'id');
    $ph  = implode(',', array_fill(0, count($ids), '?'));
    $itemRows = Database::all(
        'SELECT invoice_id, product_uuid, name, unit, unit_price, qty, discount, line_total
         FROM invoice_items WHERE invoice_id IN (' . $ph . ') ORDER BY invoice_id, sort_order, id',
        $ids
    );

    $byInvoice = [];
    foreach ($itemRows as $it) {
        $byInvoice[(int) $it['invoice_id']][] = [
            'productUuid' => $it['product_uuid'],
            'name'        => $it['name'],
            'unit'        => $it['unit'],
            'unitPrice'   => (float) $it['unit_price'],
            'qty'         => (float) $it['qty'],
            'discount'    => (float) $it['discount'],
            'lineTotal'   => (float) $it['line_total'],
        ];
    }

    return array_map(static function (array $r) use ($byInvoice): array {
        return [
            'uuid'          => $r['uuid'],
            'number'        => $r['number'],
            'customerUuid'  => $r['customer_uuid'],
            'customerName'  => $r['customer_name'],
            'place'         => $r['place'],
            'issueDate'     => $r['issue_date'],
            'status'        => $r['status'],
            'paymentStatus' => $r['payment_status'],
            'subtotal'      => (float) $r['subtotal'],
            'discount'      => (float) $r['discount'],
            'taxPercent'    => (float) $r['tax_percent'],
            'taxAmount'     => (float) $r['tax_amount'],
            'shipping'      => (float) $r['shipping'],
            'total'         => (float) $r['total'],
            'notes'         => $r['notes'],
            'items'         => $byInvoice[(int) $r['id']] ?? [],
            'createdAt'     => $r['created_at'],
            'updatedAt'     => $r['updated_at'],
            'deleted'       => $r['deleted_at'] !== null,
        ];
    }, $rows);
}

function action_pull(int $userId): void
{
    Response::requireMethod('GET');
    $since = since_param();

    $settings = Database::first('SELECT * FROM user_settings WHERE user_id = ?', [$userId]);

    Response::success([
        'serverTime' => Database::now(),
        'since'      => $since,
        'products'   => fetch_products($userId, $since),
        'customers'  => fetch_customers($userId, $since),
        'invoices'   => fetch_invoices($userId, $since),
        'settings'   => $settings === null ? null : settings_payload($settings),
    ]);
}

function settings_payload(array $s): array
{
    return [
        'businessName'      => $s['business_name'],
        'ownerName'         => $s['owner_name'],
        'phone'             => $s['phone'],
        'taxId'             => $s['tax_id'],
        'email'             => $s['email'],
        'address'           => $s['address'],
        'logo'              => $s['logo'],
        'invoicePrefix'     => $s['invoice_prefix'],
        'nextInvoiceNumber' => (int) $s['next_invoice_number'],
        'currency'          => $s['currency'],
        'taxPercent'        => (float) $s['tax_percent'],
        'invoiceFooter'     => $s['invoice_footer'],
        'voiceEnabled'      => (bool) $s['voice_enabled'],
        'updatedAt'         => $s['updated_at'],
    ];
}

function action_invoices(int $userId): void
{
    Response::requireMethod('GET');
    $limit  = max(1, min(200, to_int($_GET['limit'] ?? 50, 50)));
    $offset = max(0, to_int($_GET['offset'] ?? 0, 0));
    $total  = (int) Database::value(
        'SELECT COUNT(*) FROM invoices WHERE user_id = ? AND deleted_at IS NULL',
        [$userId]
    );
    Response::success([
        'invoices' => fetch_invoices($userId, '1970-01-01 00:00:00', $limit, $offset),
        'total'    => $total,
        'limit'    => $limit,
        'offset'   => $offset,
    ]);
}

function action_invoice(int $userId): void
{
    Response::requireMethod('GET');
    $uuid = clean_string($_GET['uuid'] ?? '', 64);
    if ($uuid === '') {
        Response::validation(['uuid' => 'شناسه فاکتور را مشخص کنید.']);
    }
    $row = Database::first('SELECT * FROM invoices WHERE user_id = ? AND uuid = ?', [$userId, $uuid]);
    if ($row === null) {
        Response::notFound('فاکتور مورد نظر پیدا نشد.');
    }
    $items = Database::all(
        'SELECT product_uuid, name, unit, unit_price, qty, discount, line_total
         FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id',
        [(int) $row['id']]
    );
    Response::success([
        'invoice' => [
            'uuid'          => $row['uuid'],
            'number'        => $row['number'],
            'customerUuid'  => $row['customer_uuid'],
            'customerName'  => $row['customer_name'],
            'place'         => $row['place'],
            'issueDate'     => $row['issue_date'],
            'status'        => $row['status'],
            'paymentStatus' => $row['payment_status'],
            'subtotal'      => (float) $row['subtotal'],
            'discount'      => (float) $row['discount'],
            'taxPercent'    => (float) $row['tax_percent'],
            'taxAmount'     => (float) $row['tax_amount'],
            'shipping'      => (float) $row['shipping'],
            'total'         => (float) $row['total'],
            'notes'         => $row['notes'],
            'items'         => array_map(static fn(array $i): array => [
                'productUuid' => $i['product_uuid'],
                'name'        => $i['name'],
                'unit'        => $i['unit'],
                'unitPrice'   => (float) $i['unit_price'],
                'qty'         => (float) $i['qty'],
                'discount'    => (float) $i['discount'],
                'lineTotal'   => (float) $i['line_total'],
            ], $items),
        ],
    ]);
}

// ---------------------------------------------------------------------------
// نوشتن
// ---------------------------------------------------------------------------

function action_push(int $userId): void
{
    Response::requireMethod('POST');
    $body = Response::jsonBody();
    Csrf::requireValid($body);

    $products  = is_array($body['products'] ?? null) ? $body['products'] : [];
    $customers = is_array($body['customers'] ?? null) ? $body['customers'] : [];
    $invoices  = is_array($body['invoices'] ?? null) ? $body['invoices'] : [];

    if (count($products) + count($customers) + count($invoices) > MAX_PUSH_ITEMS) {
        Response::error('تعداد رکوردهای ارسالی بیش از حد مجاز است (حداکثر ' . MAX_PUSH_ITEMS . ').', 413);
    }

    $result = ['products' => 0, 'customers' => 0, 'invoices' => 0, 'skipped' => [], 'conflicts' => []];

    Database::begin();
    try {
        foreach ($products as $p) {
            if (is_array($p) && upsert_product($userId, $p, $result)) {
                $result['products']++;
            }
        }
        foreach ($customers as $c) {
            if (is_array($c) && upsert_customer($userId, $c, $result)) {
                $result['customers']++;
            }
        }
        foreach ($invoices as $i) {
            if (is_array($i) && upsert_invoice($userId, $i, $result)) {
                $result['invoices']++;
            }
        }
        Database::commit();
    } catch (Throwable $e) {
        Database::rollBack();
        throw $e;
    }

    $result['serverTime'] = Database::now();
    Response::success($result, 'همگام‌سازی انجام شد.');
}

/** زمان به‌روزرسانی کلاینت را به قالب دیتابیس تبدیل می‌کند. */
function client_time($value): string
{
    $ts = is_numeric($value) ? (int) $value : strtotime((string) $value);
    if ($ts === false || $ts <= 0) {
        return Database::now();
    }
    // جلوگیری از ساعت جلوتر کلاینت
    return date('Y-m-d H:i:s', min($ts, time() + 60));
}

function upsert_product(int $userId, array $p, array &$result): bool
{
    $uuid = clean_string($p['uuid'] ?? '', 64);
    $name = clean_string($p['name'] ?? '', 120);
    if ($uuid === '' || $name === '') {
        $result['skipped'][] = ['type' => 'product', 'reason' => 'نام یا شناسه خالی', 'uuid' => $uuid];
        return false;
    }

    $aliases = $p['aliases'] ?? '';
    if (is_array($aliases)) {
        $aliases = implode(',', array_map(static fn($a) => clean_string($a, 40), $aliases));
    }

    $updatedAt = client_time($p['updatedAt'] ?? null);
    $deleted   = !empty($p['deleted']) ? $updatedAt : null;

    $existing = Database::first('SELECT id, updated_at FROM products WHERE user_id = ? AND uuid = ?', [$userId, $uuid]);

    if ($existing !== null) {
        // آخرین نوشتن برنده است
        if (strtotime((string) $existing['updated_at']) > strtotime($updatedAt)) {
            $result['conflicts'][] = ['type' => 'product', 'uuid' => $uuid];
            return false;
        }
        Database::run(
            'UPDATE products SET name = ?, sku = ?, category = ?, unit = ?, price = ?, aliases = ?,
                                 is_active = ?, updated_at = ?, deleted_at = ?
             WHERE user_id = ? AND uuid = ?',
            [
                $name,
                clean_string($p['sku'] ?? '', 40),
                clean_string($p['category'] ?? '', 60),
                clean_string($p['unit'] ?? 'عدد', 20) ?: 'عدد',
                money($p['price'] ?? 0),
                clean_string($aliases, 255),
                isset($p['isActive']) ? (int) (bool) $p['isActive'] : 1,
                $updatedAt,
                $deleted,
                $userId,
                $uuid,
            ]
        );
        return true;
    }

    $limit = (int) app_setting('max_products_per_user', '5000');
    $count = (int) Database::value('SELECT COUNT(*) FROM products WHERE user_id = ? AND deleted_at IS NULL', [$userId]);
    if ($count >= $limit) {
        $result['skipped'][] = ['type' => 'product', 'reason' => 'سقف تعداد محصولات', 'uuid' => $uuid];
        return false;
    }

    Database::run(
        'INSERT INTO products (uuid, user_id, name, sku, category, unit, price, aliases, is_active, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            $uuid,
            $userId,
            $name,
            clean_string($p['sku'] ?? '', 40),
            clean_string($p['category'] ?? '', 60),
            clean_string($p['unit'] ?? 'عدد', 20) ?: 'عدد',
            money($p['price'] ?? 0),
            clean_string($aliases, 255),
            isset($p['isActive']) ? (int) (bool) $p['isActive'] : 1,
            client_time($p['createdAt'] ?? null),
            $updatedAt,
            $deleted,
        ]
    );
    return true;
}

function upsert_customer(int $userId, array $c, array &$result): bool
{
    $uuid = clean_string($c['uuid'] ?? '', 64);
    $name = clean_string($c['name'] ?? '', 150);
    if ($uuid === '' || $name === '') {
        $result['skipped'][] = ['type' => 'customer', 'reason' => 'نام یا شناسه خالی', 'uuid' => $uuid];
        return false;
    }

    $updatedAt = client_time($c['updatedAt'] ?? null);
    $deleted   = !empty($c['deleted']) ? $updatedAt : null;

    $fields = [
        $name,
        clean_string(to_latin_digits((string) ($c['phone'] ?? '')), 30),
        clean_string(to_latin_digits((string) ($c['taxId'] ?? '')), 30),
        clean_string($c['city'] ?? '', 60),
        clean_string(to_latin_digits((string) ($c['postalCode'] ?? '')), 20),
        clean_string($c['address'] ?? '', 400),
        clean_string($c['note'] ?? '', 255),
    ];

    $existing = Database::first('SELECT id, updated_at FROM customers WHERE user_id = ? AND uuid = ?', [$userId, $uuid]);

    if ($existing !== null) {
        if (strtotime((string) $existing['updated_at']) > strtotime($updatedAt)) {
            $result['conflicts'][] = ['type' => 'customer', 'uuid' => $uuid];
            return false;
        }
        Database::run(
            'UPDATE customers SET name = ?, phone = ?, tax_id = ?, city = ?, postal_code = ?, address = ?, note = ?,
                                  updated_at = ?, deleted_at = ?
             WHERE user_id = ? AND uuid = ?',
            array_merge($fields, [$updatedAt, $deleted, $userId, $uuid])
        );
        return true;
    }

    Database::run(
        'INSERT INTO customers (uuid, user_id, name, phone, tax_id, city, postal_code, address, note, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        array_merge([$uuid, $userId], $fields, [client_time($c['createdAt'] ?? null), $updatedAt, $deleted])
    );
    return true;
}

function upsert_invoice(int $userId, array $inv, array &$result): bool
{
    $uuid = clean_string($inv['uuid'] ?? '', 64);
    if ($uuid === '') {
        $result['skipped'][] = ['type' => 'invoice', 'reason' => 'شناسه خالی'];
        return false;
    }

    $items = is_array($inv['items'] ?? null) ? $inv['items'] : [];
    if (count($items) > 200) {
        $result['skipped'][] = ['type' => 'invoice', 'reason' => 'تعداد اقلام بیش از حد', 'uuid' => $uuid];
        return false;
    }

    $updatedAt = client_time($inv['updatedAt'] ?? null);
    $deleted   = !empty($inv['deleted']) ? $updatedAt : null;

    // محاسبه مجدد مبالغ روی سرور (به داده کلاینت اعتماد نمی‌کنیم)
    $normalized = [];
    $subtotal   = 0.0;
    $order      = 0;
    foreach ($items as $it) {
        if (!is_array($it)) {
            continue;
        }
        $name = clean_string($it['name'] ?? '', 150);
        if ($name === '') {
            continue;
        }
        $unitPrice = money($it['unitPrice'] ?? $it['price'] ?? 0);
        $qty       = max(0.0, min(999999.999, round(to_float($it['qty'] ?? 1, 1.0), 3)));
        $lineDisc  = money($it['discount'] ?? 0);
        $lineTotal = max(0.0, round($unitPrice * $qty - $lineDisc, 2));
        $subtotal += $lineTotal;

        $normalized[] = [
            clean_string($it['productUuid'] ?? '', 64),
            $name,
            clean_string($it['unit'] ?? 'عدد', 20) ?: 'عدد',
            $unitPrice,
            $qty,
            $lineDisc,
            $lineTotal,
            $order++,
        ];
    }

    $subtotal   = round($subtotal, 2);
    $discount   = min(money($inv['discount'] ?? 0), $subtotal);
    $taxPercent = max(0.0, min(100.0, round(to_float($inv['taxPercent'] ?? 0), 2)));
    $taxAmount  = round(($subtotal - $discount) * $taxPercent / 100, 2);
    $shipping   = money($inv['shipping'] ?? 0);
    $total      = round($subtotal - $discount + $taxAmount + $shipping, 2);

    $status = in_array($inv['status'] ?? '', ['draft', 'final'], true) ? $inv['status'] : 'final';
    $pay    = in_array($inv['paymentStatus'] ?? '', ['unpaid', 'partial', 'paid'], true) ? $inv['paymentStatus'] : 'unpaid';

    $number = clean_string($inv['number'] ?? '', 40);
    if ($number === '') {
        $number = next_invoice_number($userId);
    }

    $data = [
        $number,
        clean_string($inv['customerUuid'] ?? '', 64),
        clean_string($inv['customerName'] ?? '', 150),
        clean_string($inv['place'] ?? '', 255),
        normalize_date($inv['issueDate'] ?? ''),
        $status,
        $pay,
        $subtotal,
        $discount,
        $taxPercent,
        $taxAmount,
        $shipping,
        $total,
        clean_string($inv['notes'] ?? '', 500),
    ];

    $existing = Database::first('SELECT id, updated_at FROM invoices WHERE user_id = ? AND uuid = ?', [$userId, $uuid]);

    if ($existing !== null) {
        if (strtotime((string) $existing['updated_at']) > strtotime($updatedAt)) {
            $result['conflicts'][] = ['type' => 'invoice', 'uuid' => $uuid];
            return false;
        }
        $invoiceId = (int) $existing['id'];
        Database::run(
            'UPDATE invoices SET number = ?, customer_uuid = ?, customer_name = ?, place = ?, issue_date = ?,
                                 status = ?, payment_status = ?, subtotal = ?, discount = ?, tax_percent = ?,
                                 tax_amount = ?, shipping = ?, total = ?, notes = ?, updated_at = ?, deleted_at = ?
             WHERE user_id = ? AND uuid = ?',
            array_merge($data, [$updatedAt, $deleted, $userId, $uuid])
        );
        Database::run('DELETE FROM invoice_items WHERE invoice_id = ?', [$invoiceId]);
    } else {
        $limit = (int) app_setting('max_invoices_per_user', '100000');
        $count = (int) Database::value('SELECT COUNT(*) FROM invoices WHERE user_id = ? AND deleted_at IS NULL', [$userId]);
        if ($count >= $limit) {
            $result['skipped'][] = ['type' => 'invoice', 'reason' => 'سقف تعداد فاکتورها', 'uuid' => $uuid];
            return false;
        }
        Database::run(
            'INSERT INTO invoices (uuid, user_id, number, customer_uuid, customer_name, place, issue_date, status,
                                   payment_status, subtotal, discount, tax_percent, tax_amount, shipping, total, notes,
                                   created_at, updated_at, deleted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            array_merge([$uuid, $userId], $data, [client_time($inv['createdAt'] ?? null), $updatedAt, $deleted])
        );
        $invoiceId = (int) Database::insertId();
    }

    foreach ($normalized as $row) {
        Database::run(
            'INSERT INTO invoice_items (invoice_id, product_uuid, name, unit, unit_price, qty, discount, line_total, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            array_merge([$invoiceId], $row)
        );
    }

    return true;
}

/** شماره فاکتور بعدی را از تنظیمات کاربر می‌گیرد و شمارنده را جلو می‌برد. */
function next_invoice_number(int $userId): string
{
    $s = Database::first(
        'SELECT invoice_prefix, next_invoice_number FROM user_settings WHERE user_id = ?',
        [$userId]
    );
    $prefix = $s['invoice_prefix'] ?? 'INV-';
    $n      = (int) ($s['next_invoice_number'] ?? 1);
    Database::run(
        'UPDATE user_settings SET next_invoice_number = ? WHERE user_id = ?',
        [$n + 1, $userId]
    );
    return $prefix . str_pad((string) $n, 4, '0', STR_PAD_LEFT);
}

function action_delete(int $userId): void
{
    Response::requireMethod('POST');
    $body = Response::jsonBody();
    Csrf::requireValid($body);

    $type = (string) ($body['type'] ?? '');
    $uuid = clean_string($body['uuid'] ?? '', 64);

    $tables = ['product' => 'products', 'customer' => 'customers', 'invoice' => 'invoices'];
    if (!isset($tables[$type]) || $uuid === '') {
        Response::validation(['type' => 'نوع یا شناسه رکورد معتبر نیست.']);
    }

    $table = $tables[$type];
    $now   = Database::now();
    $affected = Database::run(
        "UPDATE {$table} SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND uuid = ? AND deleted_at IS NULL",
        [$now, $now, $userId, $uuid]
    )->rowCount();

    if ($affected === 0) {
        Response::notFound('رکورد مورد نظر پیدا نشد یا قبلاً حذف شده است.');
    }

    log_activity($userId, $userId, 'delete', 'حذف رکورد', $type, $uuid);
    Response::success(['deleted' => $uuid], 'حذف انجام شد.');
}
