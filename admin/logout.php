<?php
/**
 * فاکتورینو — خروج از پنل مدیریت
 */

declare(strict_types=1);

require_once __DIR__ . '/_bootstrap.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    header('Location: index.php');
    exit;
}

Csrf::requireValid([], false);

$admin = Auth::user('admin');
$token = Auth::tokenFromRequest('admin');

if ($admin !== null) {
    log_activity((int) $admin['id'], (int) $admin['id'], 'admin_logout', 'خروج از پنل مدیریت');
}

Auth::revokeToken($token, 'admin');

header('Location: login.php');
exit;
