# 🐘 راهنمای استفاده از نسخه PHP

## ✅ چی ساخته شد؟

### 1. Backend API با PHP
- ✅ `config/database.php` - اتصال PDO به MySQL
- ✅ `config/config.php` - تنظیمات کلی
- ✅ `includes/jwt.php` - مدیریت JWT با PHP خام
- ✅ `includes/response.php` - کلاس Response
- ✅ `api/auth.php` - ثبت‌نام، ورود، خروج
- ✅ `api/sync.php` - همگام‌سازی (محصولات، مشتریان، فاکتورها)

### 2. پنل ادمین
- ✅ `admin/login.php` - ورود به پنل
- ✅ `admin/index.php` - داشبورد
- ⏳ `admin/users.php` - مدیریت کاربران (در حال ساخت)

---

## 🚀 نصب و راه‌اندازی

### 1. پیش‌نیازها

- **PHP 7.4+** (بهتر PHP 8+)
- **MySQL 5.7+**
- **Apache** یا **Nginx** (یا XAMPP)

### 2. تست PHP

```bash
php --version
```

باید PHP نسخه 7.4 یا بالاتر ببینید.

### 3. راه‌اندازی با XAMPP (آسان‌ترین روش)

#### مرحله 1: نصب XAMPP
- دانلود از: https://www.apachefriends.org
- نصب کنید
- Apache و MySQL را Start کنید

#### مرحله 2: کپی پروژه
```bash
# پوشه factorino را کپی کنید به:
C:\xampp\htdocs\factorino
```

#### مرحله 3: ایجاد دیتابیس
```bash
# باز کنید: http://localhost/phpmyadmin
# New Database → factorino_db
# Import → database/schema.sql
```

یا با CLI:
```bash
mysql -u root -p < database/schema.sql
```

#### مرحله 4: تنظیم .env
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=          # خالی بگذارید اگر رمز ندارید
DB_NAME=factorino_db

JWT_SECRET=your-random-secret-key-here
```

#### مرحله 5: تست API
باز کنید: `http://localhost/factorino/api/auth.php?action=profile`

باید ببینید: `{"success":false,"error":"نیاز به احراز هویت"...}`

---

## 📁 ساختار فایل‌ها

```
factorino/
├── api/
│   ├── auth.php         # Authentication API
│   └── sync.php         # Sync API
├── admin/
│   ├── login.php        # ورود ادمین
│   ├── index.php        # داشبورد
│   └── users.php        # مدیریت کاربران
├── config/
│   ├── database.php     # کلاس Database (PDO)
│   └── config.php       # تنظیمات
├── includes/
│   ├── jwt.php          # کلاس JWT
│   └── response.php     # کلاس Response
└── .env                 # تنظیمات محیطی
```

---

## 🔧 تغییرات در Frontend (JS)

### تغییر 1: به‌روزرسانی `js/auth.js`

**قدیمی:**
```javascript
const API_BASE = window.location.origin + '/api';
```

**جدید:**
```javascript
const API_BASE = 'http://localhost/factorino/api';
```

### تغییر 2: به‌روزرسانی endpoint‌ها

**ثبت‌نام:**
```javascript
fetch(`${API_BASE}/auth.php?action=register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
})
```

**ورود:**
```javascript
fetch(`${API_BASE}/auth.php?action=login`, {...})
```

**Sync محصولات:**
```javascript
fetch(`${API_BASE}/sync.php?action=products`, {...})
```

---

## 🔐 پنل ادمین

### ساخت اولین ادمین

```sql
-- وارد MySQL شوید
mysql -u root -p

USE factorino_db;

-- ساخت ادمین با رمز "admin123"
INSERT INTO users (id, email, password, business_name, role, active, created_at) VALUES (
    'admin-001',
    'admin@factorino.com',
    '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',  -- admin123
    'مدیر سیستم',
    'admin',
    1,
    NOW()
);
```

### ورود به پنل

```
URL: http://localhost/factorino/admin/login.php
Username: admin@factorino.com
Password: admin123
```

---

## 🧪 تست API با Postman

### 1. ثبت‌نام کاربر

**POST** `http://localhost/factorino/api/auth.php?action=register`

**Body (JSON):**
```json
{
    "email": "test@test.com",
    "password": "123456",
    "businessName": "فروشگاه تست",
    "owner": "علی رضایی",
    "phone": "09123456789"
}
```

**پاسخ:**
```json
{
    "success": true,
    "message": "ثبت‌نام موفق",
    "data": {
        "token": "eyJ0eXAiOiJKV1QiLC...",
        "user": {...}
    }
}
```

### 2. ورود

**POST** `http://localhost/factorino/api/auth.php?action=login`

**Body:**
```json
{
    "email": "test@test.com",
    "password": "123456"
}
```

### 3. Sync محصولات

**POST** `http://localhost/factorino/api/sync.php?action=products`

**Headers:**
```
Authorization: Bearer YOUR_TOKEN_HERE
Content-Type: application/json
```

**Body:**
```json
{
    "products": [
        {
            "id": "product-123",
            "name": "قهوه",
            "price": 50000,
            "unit": "عدد",
            "sku": "COFFEE-001",
            "category": "نوشیدنی",
            "aliases": ["اسپرسو"],
            "active": true
        }
    ]
}
```

---

## 🐛 عیب‌یابی

### خطا: Call to undefined function password_hash()

**حل:**
```bash
# در php.ini این خط را uncomment کنید:
extension=openssl
```

### خطا: PDO driver not found

**حل:**
```bash
# در php.ini:
extension=pdo_mysql
```

### خطا: Headers already sent

**حل:**
- بررسی کنید قبل از `<?php` هیچ فاصله یا BOM نباشد
- بررسی کنید `echo` یا `print` قبل از `header()` نباشد

### خطا: Access denied for user

**حل:**
- رمز MySQL را در `.env` چک کنید
- یوزر `root` دسترسی داشته باشد

---

## 📝 مقایسه Node.js vs PHP

| ویژگی | Node.js (قبلی) | PHP (جدید) |
|------|---------------|-----------|
| نصب Dependencies | `npm install` | ندارد! |
| اجرا | `npm start` | Apache auto |
| دیباگ | Console logs | `error_log()` |
| Hot Reload | با nodemon | خودکار |
| Deploy | نیاز به Node | فقط آپلود |

---

## ✅ مزایای PHP

1. **بدون Dependencies**: هیچ `node_modules` نمی‌خواهد
2. **آشنایی**: شما با PHP راحت‌ترید
3. **Deploy آسان**: فقط آپلود فایل‌ها
4. **Shared Hosting**: روی هر هاستی کار می‌کند
5. **دیباگ آسان**: خطاها واضح‌تر هستند

---

## 🚀 مراحل نهایی

```bash
# 1. کپی پروژه
cp -r factorino C:/xampp/htdocs/

# 2. ایجاد دیتابیس
mysql -u root < database/schema.sql

# 3. تنظیم .env
# ویرایش و ذخیره

# 4. ساخت ادمین
mysql -u root -p
# اجرای SQL بالا

# 5. باز کردن پنل
http://localhost/factorino/admin/login.php
```

---

**تمام! حالا با PHP کار می‌کنید! 🐘🎉**
