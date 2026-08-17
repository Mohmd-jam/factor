# راهنمای نصب و راه‌اندازی فاکتورینو v2.0

## 🎯 نیازمندی‌ها

- **Node.js** نسخه 18 یا بالاتر
- **MySQL** نسخه 5.7 یا بالاتر (یا MariaDB)
- **npm** یا **yarn**

---

## 📦 مرحله 1: نصب وابستگی‌ها

```bash
cd factorino
npm install
```

---

## 🗄️ مرحله 2: راه‌اندازی MySQL

### 2.1 ایجاد دیتابیس

وارد MySQL شوید:

```bash
mysql -u root -p
```

اجرای فایل schema:

```sql
SOURCE database/schema.sql;
```

یا به صورت دستی:

```bash
mysql -u root -p < database/schema.sql
```

### 2.2 تنظیمات دیتابیس

فایل `.env` را ویرایش کنید:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=YOUR_PASSWORD_HERE
DB_NAME=factorino_db

JWT_SECRET=CHANGE_THIS_TO_RANDOM_STRING

PORT=8080
HOST=0.0.0.0
NODE_ENV=development
```

⚠️ **هشدار امنیتی:** در محیط production حتماً `JWT_SECRET` را به یک رشته تصادفی و قوی تغییر دهید.

---

## 🚀 مرحله 3: اجرای سرور

### حالت Development (با auto-reload):

```bash
npm run dev
```

### حالت Production:

```bash
npm start
```

سرور روی `http://localhost:8080` اجرا می‌شود.

---

## 🔐 مرحله 4: ایجاد اولین کاربر

1. مرورگر را باز کنید و به `http://localhost:8080` بروید
2. صفحه **ثبت‌نام** نمایش داده می‌شود
3. اطلاعات زیر را وارد کنید:
   - نام کسب‌وکار (الزامی)
   - ایمیل (الزامی)
   - رمز عبور (حداقل 6 کاراکتر)
   - نام صاحب کسب‌وکار (اختیاری)
   - شماره تماس (اختیاری)
4. روی "ثبت‌نام و ورود" کلیک کنید
5. بعد از ثبت‌نام موفق، به صفحه اصلی منتقل می‌شوید

---

## 📱 نحوه عملکرد Offline-First

### آفلاین:
1. کاربر تغییراتی (محصول، مشتری، فاکتور) ایجاد می‌کند
2. داده در **IndexedDB** ذخیره می‌شود
3. یک رکورد در **syncQueue** با وضعیت `pending` اضافه می‌شود

### آنلاین شدن:
1. برنامه هر 30 ثانیه **syncQueue** را چک می‌کند
2. اقلام `pending` را به سرور ارسال می‌کند
3. سرور داده را در **MySQL** ذخیره می‌کند
4. در صورت موفقیت، رکورد از صف حذف می‌شود

### Pull اولیه:
- در اولین ورود، داده‌های کاربر از سرور دریافت و در IndexedDB ذخیره می‌شوند

---

## 🧪 تست عملکرد

### 1. تست آفلاین:
```bash
# در DevTools → Network → Offline را فعال کنید
# یک محصول یا مشتری جدید ایجاد کنید
# باید در IndexedDB ذخیره شود
```

### 2. تست sync:
```bash
# آنلاین شوید
# Console را باز کنید
# باید پیام "✅ X محصول همگام شد" ببینید
```

### 3. تست چند کاربره:
```bash
# با دو مرورگر مختلف (یا Incognito) دو کاربر بسازید
# هر کاربر فقط داده‌های خودش را می‌بیند
```

---

## 🛠️ ساختار API

### احراز هویت:
- `POST /api/auth/register` - ثبت‌نام
- `POST /api/auth/login` - ورود
- `POST /api/auth/logout` - خروج
- `GET /api/auth/profile` - دریافت پروفایل
- `PUT /api/auth/profile` - بروزرسانی پروفایل

### Sync:
- `POST /api/sync/products` - همگام‌سازی محصولات
- `POST /api/sync/customers` - همگام‌سازی مشتریان
- `POST /api/sync/invoices` - همگام‌سازی فاکتورها
- `GET /api/sync/pull` - دریافت تمام داده‌های کاربر

### هدرهای مورد نیاز:
```
Authorization: Bearer YOUR_JWT_TOKEN
Content-Type: application/json
```

---

## 🐛 عیب‌یابی

### خطای اتصال MySQL:
```
❌ MySQL connection failed
```
**حل:** 
- چک کنید MySQL در حال اجرا باشد: `mysql -u root -p`
- تنظیمات `.env` را بررسی کنید

### خطای توکن نامعتبر:
```
401 Unauthorized
```
**حل:**
- از صفحه logout کنید
- دوباره login کنید

### داده‌ها sync نمی‌شوند:
**حل:**
- Console مرورگر را بررسی کنید
- بررسی کنید که آنلاین باشید
- در Console بنویسید: `FactorinoSync.syncNow()`

---

## 📊 مانیتورینگ

### دیدن صف sync:
```javascript
// در Console مرورگر:
FactorinoSync.getQueueLength().then(console.log)
```

### دیدن لاگ‌های sync:
```sql
SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT 50;
```

### دیدن کاربران آنلاین:
```sql
SELECT u.email, s.created_at 
FROM sessions s 
JOIN users u ON s.user_id = u.id 
WHERE s.expires_at > NOW();
```

---

## 🔒 امنیت

### توصیه‌های Production:

1. **JWT Secret**: یک رشته 32+ کاراکتری تصادفی
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

2. **HTTPS**: حتماً با HTTPS اجرا کنید

3. **CORS**: فقط دامنه مورد نظر را مجاز کنید:
```javascript
// در server.js:
origin: ['https://yourdomain.com']
```

4. **Rate Limiting**: با `express-rate-limit` اضافه کنید

5. **پشتیبان MySQL**: پشتیبان منظم بگیرید
```bash
mysqldump -u root -p factorino_db > backup.sql
```

---

## 🎉 تمام!

حالا می‌توانید:
- ✅ با چند کاربر همزمان کار کنید
- ✅ آفلاین کار کنید
- ✅ داده‌ها خودکار همگام می‌شوند
- ✅ تمام داده‌ها در MySQL ذخیره می‌شوند

برای سؤال یا مشکل، فایل `README.md` را بخوانید.
