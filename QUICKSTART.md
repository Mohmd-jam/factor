# ⚡ راهنمای سریع - 5 دقیقه

## 🎯 شما چی می‌خواهید؟

### گزینه 1: فقط می‌خوام ببینم کار می‌کنه! (بدون MySQL)
**نسخه قدیمی (v1.0)** رو اجرا کنید - نیازی به setup نداره:
```bash
# فقط یک سرور ساده
python -m http.server 8080
# یا
npx serve .
```

### گزینه 2: می‌خوام نسخه چند کاربره با MySQL رو setup کنم

---

## 🚀 Setup سریع (5 دقیقه)

### 1️⃣ پیش‌نیازها
```bash
# چک کنید نصب باشند:
node --version   # باید 18+ باشد
npm --version
mysql --version  # یا MariaDB
```

### 2️⃣ نصب Dependencies
```bash
cd factorino
npm install
```

### 3️⃣ Setup MySQL

**Windows:**
```bash
# شروع MySQL service
net start MySQL80

# یا از XAMPP/WAMP
```

**Linux/Mac:**
```bash
# شروع MySQL
sudo systemctl start mysql

# یا
brew services start mysql
```

### 4️⃣ ایجاد Database
```bash
# یک‌خطی!
npm run init-db
```

اگر خطا داد، دستی اجرا کنید:
```bash
mysql -u root -p < database/schema.sql
```

### 5️⃣ تنظیم Environment
```bash
# کپی کردن .env
copy .env.example .env    # Windows
# یا
cp .env.example .env      # Linux/Mac
```

**ویرایش `.env`:**
```env
DB_PASSWORD=رمز_mysql_خودتون
JWT_SECRET=یک_رشته_تصادفی_32_کاراکتری
```

### 6️⃣ اجرا!
```bash
npm start
```

باز کنید: http://localhost:8080

---

## 🔧 اگر مشکلی پیش اومد

### خطا: MySQL connection failed
```bash
# چک کنید MySQL در حال اجراست:
mysql -u root -p

# اگر وارد شد، رمز درسته ✅
# اگر نشد، رمز اشتباهه یا MySQL خاموشه
```

### خطا: Cannot find module 'express'
```bash
# dependencies نصب نشدن:
npm install
```

### خطا: Port 8080 in use
```bash
# پورت اشغاله، یکی دیگه بذارید:
# در .env:
PORT=3000
```

### خطا: JWT_SECRET required
```bash
# .env رو درست تنظیم کنید
```

---

## ✅ تست اینکه کار می‌کنه

### 1. ثبت‌نام
- بروید به http://localhost:8080
- "ثبت‌نام کنید" رو بزنید
- یک حساب بسازید

### 2. تست آفلاین
```
1. DevTools باز کنید (F12)
2. Network tab → Offline چک کنید
3. یک محصول جدید بسازید
4. باید ذخیره بشه!
5. Console: "syncQueue has 1 pending items"
```

### 3. تست Sync
```
1. Offline رو خاموش کنید
2. Console: "✅ 1 محصول همگام شد"
3. در MySQL چک کنید:
   mysql> SELECT * FROM products;
```

---

## 📚 مراحل بعدی

حالا که کار می‌کنه:

1. **تغییرات کد**: فایل `CHANGES.md` رو بخونید
2. **راهنمای کامل**: فایل `SETUP.md` رو بخونید
3. **مستندات API**: فایل `README.md` رو بخونید

---

## 🆘 کمک بیشتر

### دستورات مفید:
```bash
# دیدن لاگ‌های سرور
npm start

# دیدن لاگ‌های sync (در Console مرورگر)
FactorinoSync.getQueueLength()
FactorinoSync.syncNow()

# دیدن دیتابیس
mysql -u root -p
mysql> USE factorino_db;
mysql> SELECT * FROM users;
mysql> SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT 10;
```

### فایل‌های مهم:
- `SETUP.md` - راهنمای کامل نصب
- `CHANGES.md` - تغییرات لازم در کد
- `FINAL_SUMMARY.md` - خلاصه کامل پروژه
- `README.md` - معرفی و مستندات

---

## 🎉 Done!

حالا می‌تونید:
- ✅ با چند نفر همزمان کار کنید
- ✅ آفلاین کار کنید
- ✅ داده‌ها خودکار sync بشه
- ✅ همه چی در MySQL ذخیره بشه

موفق باشید! 🚀
