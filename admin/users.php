<?php
/**
 * فاکتورینو — مدیریت کاربران
 */

declare(strict_types=1);

require_once __DIR__ . '/_bootstrap.php';

$admin   = Auth::requireAdmin('login.php');
$adminId = (int) $admin['id'];

// ---------------------------------------------------------------------------
// عملیات (POST)
// ---------------------------------------------------------------------------
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    Csrf::requireValid([], false);

    $op     = (string) ($_POST['op'] ?? '');
    $userId = to_int($_POST['user_id'] ?? 0);
    $back   = 'users.php';

    if ($userId <= 0) {
        redirect_with($back, 'err', 'کاربر نامعتبر است.');
    }

    $target = Database::first('SELECT id, email, role, status FROM users WHERE id = ? AND deleted_at IS NULL', [$userId]);
    if ($target === null) {
        redirect_with($back, 'err', 'کاربر پیدا نشد.');
    }
    if ((int) $target['id'] === $adminId) {
        redirect_with($back, 'err', 'روی حساب خودتان نمی‌توانید این عملیات را انجام دهید.');
    }

    switch ($op) {
        case 'suspend':
            Database::run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', ['suspended', Database::now(), $userId]);
            Auth::revokeAllSessions($userId);
            log_activity($userId, $adminId, 'admin_suspend', 'مسدودسازی حساب توسط مدیر');
            redirect_with($back, 'ok', 'حساب ' . $target['email'] . ' مسدود شد.');
            break;

        case 'activate':
            Database::run(
                'UPDATE users SET status = ?, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
                ['active', Database::now(), $userId]
            );
            log_activity($userId, $adminId, 'admin_activate', 'فعال‌سازی حساب توسط مدیر');
            redirect_with($back, 'ok', 'حساب ' . $target['email'] . ' فعال شد.');
            break;

        case 'logout_all':
            Auth::revokeAllSessions($userId);
            log_activity($userId, $adminId, 'admin_logout_all', 'خروج اجباری از همه دستگاه‌ها');
            redirect_with($back, 'ok', 'همه نشست‌های کاربر بسته شد.');
            break;

        case 'reset_password':
            $newPass = (string) ($_POST['new_password'] ?? '');
            $problem = password_problem($newPass);
            if ($problem !== null) {
                redirect_with($back, 'err', $problem);
            }
            Database::run(
                'UPDATE users SET password_hash = ?, password_changed_at = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?',
                [hash_password($newPass), Database::now(), $userId]
            );
            Auth::revokeAllSessions($userId);
            log_activity($userId, $adminId, 'admin_reset_password', 'بازنشانی رمز عبور توسط مدیر');
            redirect_with($back, 'ok', 'رمز عبور ' . $target['email'] . ' تغییر کرد.');
            break;

        case 'delete':
            // حذف نرم — داده‌ها باقی می‌مانند ولی حساب غیرقابل استفاده می‌شود.
            Database::run(
                'UPDATE users SET deleted_at = ?, status = ?, updated_at = ? WHERE id = ?',
                [Database::now(), 'suspended', Database::now(), $userId]
            );
            Auth::revokeAllSessions($userId);
            log_activity($userId, $adminId, 'admin_delete_user', 'حذف حساب کاربر: ' . $target['email']);
            redirect_with($back, 'ok', 'حساب ' . $target['email'] . ' حذف شد.');
            break;

        case 'make_admin':
            Database::run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', ['admin', Database::now(), $userId]);
            log_activity($userId, $adminId, 'admin_grant', 'ارتقا به مدیر');
            redirect_with($back, 'ok', 'دسترسی مدیریت به ' . $target['email'] . ' داده شد.');
            break;

        case 'revoke_admin':
            Database::run('UPDATE users SET role = ?, updated_at = ? WHERE id = ?', ['user', Database::now(), $userId]);
            Auth::revokeAllSessions($userId);
            log_activity($userId, $adminId, 'admin_revoke', 'سلب دسترسی مدیریت');
            redirect_with($back, 'ok', 'دسترسی مدیریت از ' . $target['email'] . ' گرفته شد.');
            break;

        default:
            redirect_with($back, 'err', 'عملیات نامعتبر است.');
    }
}

// ---------------------------------------------------------------------------
// فهرست کاربران
// ---------------------------------------------------------------------------
$q       = clean_string($_GET['q'] ?? '', 100);
$status  = in_array($_GET['status'] ?? '', ['active', 'suspended'], true) ? $_GET['status'] : '';
$role    = in_array($_GET['role'] ?? '', ['user', 'admin'], true) ? $_GET['role'] : '';
$sort    = in_array($_GET['sort'] ?? '', ['created', 'revenue', 'invoices', 'login'], true) ? $_GET['sort'] : 'created';
$page    = max(1, to_int($_GET['page'] ?? 1, 1));
$perPage = 20;
$offset  = ($page - 1) * $perPage;

$where  = ['u.deleted_at IS NULL'];
$params = [];

if ($q !== '') {
    $where[] = '(u.email LIKE ? OR u.business_name LIKE ? OR u.owner_name LIKE ? OR u.phone LIKE ?)';
    $like    = '%' . $q . '%';
    array_push($params, $like, $like, $like, $like);
}
if ($status !== '') {
    $where[]  = 'u.status = ?';
    $params[] = $status;
}
if ($role !== '') {
    $where[]  = 'u.role = ?';
    $params[] = $role;
}

$whereSql = implode(' AND ', $where);

$total = (int) Database::value("SELECT COUNT(*) FROM users u WHERE {$whereSql}", $params);
$pages = max(1, (int) ceil($total / $perPage));

$orderBy = match ($sort) {
    'revenue'  => 'revenue DESC',
    'invoices' => 'invoice_count DESC',
    'login'    => 'u.last_login_at DESC',
    default    => 'u.created_at DESC',
};

$users = Database::all(
    "SELECT u.id, u.email, u.business_name, u.owner_name, u.phone, u.role, u.status,
            u.created_at, u.last_login_at, u.last_login_ip,
            (SELECT COUNT(*) FROM invoices i WHERE i.user_id = u.id AND i.deleted_at IS NULL) AS invoice_count,
            (SELECT COALESCE(SUM(i.total),0) FROM invoices i
              WHERE i.user_id = u.id AND i.deleted_at IS NULL AND i.status = 'final') AS revenue,
            (SELECT COUNT(*) FROM products p WHERE p.user_id = u.id AND p.deleted_at IS NULL) AS product_count
     FROM users u
     WHERE {$whereSql}
     ORDER BY {$orderBy}
     LIMIT {$perPage} OFFSET {$offset}",
    $params
);

$queryBase = static function (array $override) use ($q, $status, $role, $sort): string {
    return 'users.php?' . http_build_query(array_merge(
        array_filter(['q' => $q, 'status' => $status, 'role' => $role, 'sort' => $sort], static fn($v) => $v !== ''),
        $override
    ));
};

$pageTitle = 'کاربران';
require __DIR__ . '/_layout.php';
?>

<form class="filters" method="get" action="users.php">
  <input type="search" name="q" value="<?= e($q) ?>" placeholder="جستجو: ایمیل، کسب‌وکار، تلفن…" aria-label="جستجو">
  <select name="status" aria-label="وضعیت">
    <option value="">همه وضعیت‌ها</option>
    <option value="active"    <?= $status === 'active' ? 'selected' : '' ?>>فعال</option>
    <option value="suspended" <?= $status === 'suspended' ? 'selected' : '' ?>>مسدود</option>
  </select>
  <select name="role" aria-label="نقش">
    <option value="">همه نقش‌ها</option>
    <option value="user"  <?= $role === 'user' ? 'selected' : '' ?>>کاربر</option>
    <option value="admin" <?= $role === 'admin' ? 'selected' : '' ?>>مدیر</option>
  </select>
  <select name="sort" aria-label="مرتب‌سازی">
    <option value="created"  <?= $sort === 'created' ? 'selected' : '' ?>>جدیدترین</option>
    <option value="revenue"  <?= $sort === 'revenue' ? 'selected' : '' ?>>بیشترین گردش مالی</option>
    <option value="invoices" <?= $sort === 'invoices' ? 'selected' : '' ?>>بیشترین فاکتور</option>
    <option value="login"    <?= $sort === 'login' ? 'selected' : '' ?>>آخرین ورود</option>
  </select>
  <button type="submit" class="btn btn-primary">اعمال</button>
  <?php if ($q !== '' || $status !== '' || $role !== ''): ?>
    <a class="btn" href="users.php">پاک کردن</a>
  <?php endif; ?>
</form>

<p class="muted sm result-count"><?= fa_number($total) ?> کاربر یافت شد.</p>

<section class="card">
  <div class="table-wrap">
    <table class="table-users">
      <thead>
        <tr>
          <th>کاربر</th>
          <th>وضعیت</th>
          <th>فاکتور</th>
          <th>گردش مالی</th>
          <th>ثبت‌نام</th>
          <th>آخرین ورود</th>
          <th class="actions-col">عملیات</th>
        </tr>
      </thead>
      <tbody>
      <?php if ($users === []): ?>
        <tr><td colspan="7" class="empty">کاربری با این مشخصات پیدا نشد.</td></tr>
      <?php endif; ?>
      <?php foreach ($users as $u): $uid = (int) $u['id']; $self = $uid === $adminId; ?>
        <tr>
          <td data-label="کاربر">
            <a class="link strong" href="user.php?id=<?= $uid ?>"><?= e((string) $u['business_name']) ?></a>
            <?php if ($u['role'] === 'admin'): ?><span class="badge badge-brand">مدیر</span><?php endif; ?>
            <?php if ($self): ?><span class="badge">شما</span><?php endif; ?>
            <div class="muted sm" dir="ltr"><?= e((string) $u['email']) ?></div>
            <?php if ($u['phone'] !== ''): ?>
              <div class="muted sm" dir="ltr"><?= e((string) $u['phone']) ?></div>
            <?php endif; ?>
          </td>
          <td data-label="وضعیت">
            <span class="badge <?= $u['status'] === 'active' ? 'badge-ok' : 'badge-err' ?>">
              <?= $u['status'] === 'active' ? 'فعال' : 'مسدود' ?>
            </span>
          </td>
          <td data-label="فاکتور"><?= fa_number($u['invoice_count']) ?></td>
          <td data-label="گردش مالی"><?= fa_number($u['revenue']) ?></td>
          <td data-label="ثبت‌نام" class="sm muted"><?= e(fa_datetime($u['created_at'], false)) ?></td>
          <td data-label="آخرین ورود" class="sm muted">
            <?= e(fa_ago($u['last_login_at'])) ?>
            <?php if (!empty($u['last_login_ip'])): ?>
              <div dir="ltr" class="xs"><?= e((string) $u['last_login_ip']) ?></div>
            <?php endif; ?>
          </td>
          <td data-label="عملیات" class="actions-col">
            <?php if ($self): ?>
              <span class="muted sm">—</span>
            <?php else: ?>
              <div class="row-actions">
                <a class="btn btn-sm" href="user.php?id=<?= $uid ?>">جزئیات</a>
                <?php if ($u['status'] === 'active'): ?>
                  <form method="post" data-confirm="حساب «<?= e((string) $u['business_name']) ?>» مسدود شود؟">
                    <?= Csrf::field() ?>
                    <input type="hidden" name="op" value="suspend">
                    <input type="hidden" name="user_id" value="<?= $uid ?>">
                    <button class="btn btn-sm btn-warn" type="submit">مسدود</button>
                  </form>
                <?php else: ?>
                  <form method="post">
                    <?= Csrf::field() ?>
                    <input type="hidden" name="op" value="activate">
                    <input type="hidden" name="user_id" value="<?= $uid ?>">
                    <button class="btn btn-sm btn-ok" type="submit">فعال‌سازی</button>
                  </form>
                <?php endif; ?>
              </div>
            <?php endif; ?>
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
      <a class="btn btn-sm" href="<?= e($queryBase(['page' => $page - 1])) ?>">قبلی</a>
    <?php endif; ?>
    <span class="muted sm">صفحه <?= fa_number($page) ?> از <?= fa_number($pages) ?></span>
    <?php if ($page < $pages): ?>
      <a class="btn btn-sm" href="<?= e($queryBase(['page' => $page + 1])) ?>">بعدی</a>
    <?php endif; ?>
  </nav>
<?php endif; ?>

<?php admin_layout_end(); ?>
