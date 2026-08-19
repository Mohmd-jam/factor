<?php
/**
 * فاکتورینو — نظارت بر فاکتورهای همه کاربران
 */

declare(strict_types=1);

require_once __DIR__ . '/_bootstrap.php';

$admin = Auth::requireAdmin('login.php');

$q        = clean_string($_GET['q'] ?? '', 100);
$userFilt = to_int($_GET['user'] ?? 0);
$payment  = in_array($_GET['payment'] ?? '', ['unpaid', 'partial', 'paid'], true) ? $_GET['payment'] : '';
$from     = clean_string(to_latin_digits((string) ($_GET['from'] ?? '')), 10);
$to       = clean_string(to_latin_digits((string) ($_GET['to'] ?? '')), 10);
$page     = max(1, to_int($_GET['page'] ?? 1, 1));
$perPage  = 25;
$offset   = ($page - 1) * $perPage;

$where  = ['i.deleted_at IS NULL'];
$params = [];

if ($q !== '') {
    $where[] = '(i.number LIKE ? OR i.customer_name LIKE ?)';
    $like    = '%' . $q . '%';
    array_push($params, $like, $like);
}
if ($userFilt > 0) {
    $where[]  = 'i.user_id = ?';
    $params[] = $userFilt;
}
if ($payment !== '') {
    $where[]  = 'i.payment_status = ?';
    $params[] = $payment;
}
if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) === 1) {
    $where[]  = 'i.issue_date >= ?';
    $params[] = $from;
}
if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $to) === 1) {
    $where[]  = 'i.issue_date <= ?';
    $params[] = $to;
}

$whereSql = implode(' AND ', $where);

$agg = Database::first(
    "SELECT COUNT(*) AS cnt, COALESCE(SUM(i.total),0) AS amount
     FROM invoices i WHERE {$whereSql}",
    $params
) ?? ['cnt' => 0, 'amount' => 0];

$total = (int) $agg['cnt'];
$pages = max(1, (int) ceil($total / $perPage));

$rows = Database::all(
    "SELECT i.uuid, i.number, i.customer_name, i.issue_date, i.total, i.status, i.payment_status,
            i.created_at, u.id AS user_id, u.business_name, u.email
     FROM invoices i
     INNER JOIN users u ON u.id = i.user_id
     WHERE {$whereSql}
     ORDER BY i.issue_date DESC, i.id DESC
     LIMIT {$perPage} OFFSET {$offset}",
    $params
);

$userOptions = Database::all(
    'SELECT id, business_name FROM users WHERE deleted_at IS NULL ORDER BY business_name LIMIT 300'
);

$buildQuery = static function (array $override) use ($q, $userFilt, $payment, $from, $to): string {
    $base = array_filter([
        'q'       => $q,
        'user'    => $userFilt > 0 ? (string) $userFilt : '',
        'payment' => $payment,
        'from'    => $from,
        'to'      => $to,
    ], static fn($v) => $v !== '');
    return 'invoices.php?' . http_build_query(array_merge($base, $override));
};

$pageTitle = 'فاکتورها';
require __DIR__ . '/_layout.php';
?>

<form class="filters" method="get" action="invoices.php">
  <input type="search" name="q" value="<?= e($q) ?>" placeholder="شماره فاکتور یا نام مشتری…" aria-label="جستجو">
  <select name="user" aria-label="کاربر">
    <option value="">همه کاربران</option>
    <?php foreach ($userOptions as $u): ?>
      <option value="<?= (int) $u['id'] ?>" <?= $userFilt === (int) $u['id'] ? 'selected' : '' ?>>
        <?= e((string) $u['business_name']) ?>
      </option>
    <?php endforeach; ?>
  </select>
  <select name="payment" aria-label="وضعیت پرداخت">
    <option value="">همه پرداخت‌ها</option>
    <option value="unpaid"  <?= $payment === 'unpaid' ? 'selected' : '' ?>>پرداخت‌نشده</option>
    <option value="partial" <?= $payment === 'partial' ? 'selected' : '' ?>>بخشی</option>
    <option value="paid"    <?= $payment === 'paid' ? 'selected' : '' ?>>پرداخت‌شده</option>
  </select>
  <input type="date" name="from" value="<?= e($from) ?>" aria-label="از تاریخ">
  <input type="date" name="to"   value="<?= e($to) ?>"   aria-label="تا تاریخ">
  <button class="btn btn-primary" type="submit">اعمال</button>
  <a class="btn" href="invoices.php">پاک کردن</a>
</form>

<div class="stat-grid">
  <div class="stat"><div class="stat-label">تعداد نتایج</div><div class="stat-value"><?= fa_number($total) ?></div></div>
  <div class="stat"><div class="stat-label">مجموع مبالغ</div><div class="stat-value sm"><?= fa_number($agg['amount']) ?></div></div>
</div>

<section class="card">
  <div class="table-wrap">
    <table>
      <thead>
        <tr><th>شماره</th><th>کسب‌وکار</th><th>مشتری</th><th>تاریخ</th><th>مبلغ</th><th>نوع</th><th>پرداخت</th></tr>
      </thead>
      <tbody>
      <?php if ($rows === []): ?>
        <tr><td colspan="7" class="empty">فاکتوری با این شرایط پیدا نشد.</td></tr>
      <?php endif; ?>
      <?php foreach ($rows as $i): ?>
        <tr>
          <td data-label="شماره" dir="ltr" class="sm"><?= e((string) $i['number']) ?></td>
          <td data-label="کسب‌وکار">
            <a class="link" href="user.php?id=<?= (int) $i['user_id'] ?>"><?= e((string) $i['business_name']) ?></a>
          </td>
          <td data-label="مشتری"><?= e((string) ($i['customer_name'] ?: '—')) ?></td>
          <td data-label="تاریخ" class="sm muted"><?= e(fa_datetime($i['issue_date'], false)) ?></td>
          <td data-label="مبلغ"><?= fa_number($i['total']) ?></td>
          <td data-label="نوع">
            <span class="chip"><?= $i['status'] === 'draft' ? 'پیش‌نویس' : 'نهایی' ?></span>
          </td>
          <td data-label="پرداخت">
            <span class="badge <?= $i['payment_status'] === 'paid' ? 'badge-ok' : ($i['payment_status'] === 'partial' ? 'badge-warn' : 'badge-err') ?>">
              <?= ['unpaid' => 'پرداخت‌نشده', 'partial' => 'بخشی', 'paid' => 'پرداخت‌شده'][$i['payment_status']] ?? '—' ?>
            </span>
          </td>
        </tr>
      <?php endforeach; ?>
      </tbody>
    </table>
  </div>
</section>

<?php if ($pages > 1): ?>
  <nav class="pager" aria-label="صفحه‌بندی">
    <?php if ($page > 1): ?>
      <a class="btn btn-sm" href="<?= e($buildQuery(['page' => $page - 1])) ?>">قبلی</a>
    <?php endif; ?>
    <span class="muted sm">صفحه <?= fa_number($page) ?> از <?= fa_number($pages) ?></span>
    <?php if ($page < $pages): ?>
      <a class="btn btn-sm" href="<?= e($buildQuery(['page' => $page + 1])) ?>">بعدی</a>
    <?php endif; ?>
  </nav>
<?php endif; ?>

<?php admin_layout_end(); ?>
