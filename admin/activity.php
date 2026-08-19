<?php
/**
 * فاکتورینو — گزارش رویدادها و تلاش‌های ورود
 */

declare(strict_types=1);

require_once __DIR__ . '/_bootstrap.php';

$admin = Auth::requireAdmin('login.php');

$tab = ($_GET['tab'] ?? 'events') === 'logins' ? 'logins' : 'events';

$q       = clean_string($_GET['q'] ?? '', 100);
$action  = clean_string($_GET['action'] ?? '', 60);
$page    = max(1, to_int($_GET['page'] ?? 1, 1));
$perPage = 40;
$offset  = ($page - 1) * $perPage;

$actions = array_column(
    Database::all('SELECT DISTINCT action FROM activity_logs ORDER BY action LIMIT 60'),
    'action'
);

$rows  = [];
$total = 0;

if ($tab === 'events') {
    $where  = ['1=1'];
    $params = [];

    if ($q !== '') {
        $where[] = '(l.message LIKE ? OR l.ip LIKE ? OR u.email LIKE ?)';
        $like    = '%' . $q . '%';
        array_push($params, $like, $like, $like);
    }
    if ($action !== '') {
        $where[]  = 'l.action = ?';
        $params[] = $action;
    }
    $whereSql = implode(' AND ', $where);

    $total = (int) Database::value(
        "SELECT COUNT(*) FROM activity_logs l LEFT JOIN users u ON u.id = l.user_id WHERE {$whereSql}",
        $params
    );

    $rows = Database::all(
        "SELECT l.id, l.action, l.message, l.ip, l.created_at,
                l.user_id, u.business_name, u.email
         FROM activity_logs l
         LEFT JOIN users u ON u.id = l.user_id
         WHERE {$whereSql}
         ORDER BY l.id DESC
         LIMIT {$perPage} OFFSET {$offset}",
        $params
    );
} else {
    $where  = ['1=1'];
    $params = [];
    if ($q !== '') {
        $where[] = '(a.email LIKE ? OR a.ip LIKE ?)';
        $like    = '%' . $q . '%';
        array_push($params, $like, $like);
    }
    $whereSql = implode(' AND ', $where);

    $total = (int) Database::value("SELECT COUNT(*) FROM login_attempts a WHERE {$whereSql}", $params);

    $rows = Database::all(
        "SELECT a.id, a.email, a.ip, a.success, a.created_at, a.user_agent
         FROM login_attempts a
         WHERE {$whereSql}
         ORDER BY a.id DESC
         LIMIT {$perPage} OFFSET {$offset}",
        $params
    );
}

$pages = max(1, (int) ceil($total / $perPage));

$link = static function (array $override) use ($tab, $q, $action): string {
    $base = array_filter([
        'tab'    => $tab,
        'q'      => $q,
        'action' => $action,
    ], static fn($v) => $v !== '');
    return 'activity.php?' . http_build_query(array_merge($base, $override));
};

$pageTitle = 'گزارش فعالیت';
require __DIR__ . '/_layout.php';
?>

<nav class="tabs" aria-label="نوع گزارش">
  <a class="tab <?= $tab === 'events' ? 'active' : '' ?>" href="activity.php?tab=events">رویدادهای سیستم</a>
  <a class="tab <?= $tab === 'logins' ? 'active' : '' ?>" href="activity.php?tab=logins">تلاش‌های ورود</a>
</nav>

<form class="filters" method="get" action="activity.php">
  <input type="hidden" name="tab" value="<?= e($tab) ?>">
  <input type="search" name="q" value="<?= e($q) ?>"
         placeholder="<?= $tab === 'events' ? 'متن رویداد، ایمیل یا IP…' : 'ایمیل یا IP…' ?>" aria-label="جستجو">
  <?php if ($tab === 'events'): ?>
    <select name="action" aria-label="نوع رویداد">
      <option value="">همه رویدادها</option>
      <?php foreach ($actions as $a): ?>
        <option value="<?= e((string) $a) ?>" <?= $action === $a ? 'selected' : '' ?>><?= e((string) $a) ?></option>
      <?php endforeach; ?>
    </select>
  <?php endif; ?>
  <button class="btn btn-primary" type="submit">اعمال</button>
  <a class="btn" href="activity.php?tab=<?= e($tab) ?>">پاک کردن</a>
</form>

<p class="result-count muted sm"><?= fa_number($total) ?> رکورد یافت شد.</p>

<section class="card">
  <div class="table-wrap">
    <?php if ($tab === 'events'): ?>
      <table>
        <thead><tr><th>رویداد</th><th>کاربر</th><th>توضیح</th><th>IP</th><th>زمان</th></tr></thead>
        <tbody>
        <?php if ($rows === []): ?>
          <tr><td colspan="5" class="empty">رکوردی یافت نشد.</td></tr>
        <?php endif; ?>
        <?php foreach ($rows as $r): ?>
          <tr>
            <td data-label="رویداد"><span class="chip"><?= e((string) $r['action']) ?></span></td>
            <td data-label="کاربر">
              <?php if ($r['user_id'] !== null): ?>
                <a class="link" href="user.php?id=<?= (int) $r['user_id'] ?>">
                  <?= e((string) ($r['business_name'] ?: $r['email'])) ?>
                </a>
              <?php else: ?>
                <span class="muted">—</span>
              <?php endif; ?>
            </td>
            <td data-label="توضیح" class="sm"><?= e((string) $r['message']) ?></td>
            <td data-label="IP" dir="ltr" class="sm muted"><?= e((string) $r['ip']) ?></td>
            <td data-label="زمان" class="sm muted"><?= e(fa_datetime($r['created_at'])) ?></td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    <?php else: ?>
      <table>
        <thead><tr><th>ایمیل</th><th>نتیجه</th><th>IP</th><th>دستگاه</th><th>زمان</th></tr></thead>
        <tbody>
        <?php if ($rows === []): ?>
          <tr><td colspan="5" class="empty">رکوردی یافت نشد.</td></tr>
        <?php endif; ?>
        <?php foreach ($rows as $r): ?>
          <tr>
            <td data-label="ایمیل" dir="ltr" class="sm"><?= e((string) $r['email']) ?></td>
            <td data-label="نتیجه">
              <span class="badge <?= (int) $r['success'] === 1 ? 'badge-ok' : 'badge-err' ?>">
                <?= (int) $r['success'] === 1 ? 'موفق' : 'ناموفق' ?>
              </span>
            </td>
            <td data-label="IP" dir="ltr" class="sm muted"><?= e((string) $r['ip']) ?></td>
            <td data-label="دستگاه" class="xs muted"><?= e(mb_substr((string) $r['user_agent'], 0, 60)) ?></td>
            <td data-label="زمان" class="sm muted"><?= e(fa_datetime($r['created_at'])) ?></td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    <?php endif; ?>
  </div>
</section>

<?php if ($pages > 1): ?>
  <nav class="pager" aria-label="صفحه‌بندی">
    <?php if ($page > 1): ?>
      <a class="btn btn-sm" href="<?= e($link(['page' => $page - 1])) ?>">قبلی</a>
    <?php endif; ?>
    <span class="muted sm">صفحه <?= fa_number($page) ?> از <?= fa_number($pages) ?></span>
    <?php if ($page < $pages): ?>
      <a class="btn btn-sm" href="<?= e($link(['page' => $page + 1])) ?>">بعدی</a>
    <?php endif; ?>
  </nav>
<?php endif; ?>

<?php admin_layout_end(); ?>
