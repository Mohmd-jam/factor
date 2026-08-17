# فاکتورینو v2.0

یک برنامه **PWA چند کاربره** برای صدور فاکتور حرفه‌ای با قابلیت **Offline-First Sync**

## 🆕 ویژگی‌های نسخه 2.0

- ✅ **چند کاربره**: هر کاربر با ایمیل و رمز عبور خودش وارد می‌شود
- ✅ **Offline-First**: در حالت آفلاین کار می‌کند و بعداً همگام می‌شود
- ✅ **MySQL Backend**: تمام داده‌ها در دیتابیس مرکزی ذخیره می‌شوند
- ✅ **Auto-Sync**: تغییرات خودکار با سرور همگام می‌شوند
- ✅ **JWT Authentication**: احراز هویت امن با توکن
- ✅ **Sync Queue**: صف هوشمند برای مدیریت تغییرات آفلاین

## امکانات قبلی

- ثبت محصولات با نام، قیمت، کد و دسته‌بندی
- ثبت مشتریان با اطلاعات کامل
- صدور فاکتور با تخفیف، مالیات و هزینه ارسال
- **ثبت صوتی محصولات** (مثلاً "دو تا قهوه و سه آب معدنی")
- پیش‌نمایش A4 و ذخیره PDF
- گزارش‌های فروش با نمودار
- پشتیبان رمزنگاری‌شده
- طراحی کامل راست‌چین و واکنش‌گرا

## 📋 نصب و راه‌اندازی

مراحل کامل نصب را در فایل **[SETUP.md](./SETUP.md)** بخوانید.

### خلاصه:

```bash
# 1. نصب وابستگی‌ها
npm install

# 2. راه‌اندازی MySQL
mysql -u root -p < database/schema.sql

# 3. تنظیم .env
cp .env.example .env
# ویرایش .env و تنظیم DB_PASSWORD و JWT_SECRET

# 4. اجرای سرور
npm start
```

سپس به `http://localhost:8080` بروید و ثبت‌نام کنید.

## 🏗️ معماری Offline-First

### حالت آفلاین:
```
User → IndexedDB (ذخیره محلی) → syncQueue (pending)
```

### حالت آنلاین:
```
syncQueue → API (POST /api/sync/*) → MySQL → موفقیت → synced
```

### جزئیات:
1. در آفلاین، تمام تغییرات در IndexedDB ذخیره می‌شوند
2. هر تغییر یک رکورد در `syncQueue` با UUID ایجاد می‌کند
3. وقتی اینترنت وصل می‌شود، موتور sync فعال می‌شود
4. تغییرات به ترتیب به سرور ارسال می‌شوند
5. سرور داده را در MySQL ذخیره می‌کند
6. بعد از موفقیت، رکورد از صف حذف می‌شود

## 📁 ساختار پروژه

```
factorino/
├── api/                    # Backend API
│   ├── config/
│   │   └── database.js     # اتصال MySQL
│   ├── controllers/
│   │   ├── authController.js
│   │   └── syncController.js
│   ├── middleware/
│   │   └── auth.js         # JWT middleware
│   └── routes/
│       ├── auth.js
│       └── sync.js
├── assets/                 # آیکون‌ها
├── css/
│   ├── styles.css          # استایل اصلی
│   └── login.css           # استایل صفحه لاگین
├── database/
│   └── schema.sql          # ساختار MySQL
├── js/
│   ├── app.js              # منطق اصلی برنامه
│   ├── db.js               # IndexedDB wrapper
│   ├── voice.js            # تشخیص گفتار فارسی
│   ├── auth.js             # مدیریت لاگین
│   └── sync.js             # موتور Offline-First
├── index.html              # صفحه اصلی
├── login.html              # صفحه لاگین
├── manifest.webmanifest    # PWA manifest
├── sw.js                   # Service Worker
├── server.js               # سرور Express
├── package.json
├── .env                    # تنظیمات (git ignore)
├── SETUP.md                # راهنمای نصب
└── CHANGES.md              # تغییرات لازم
```

## 🔐 امنیت

- ✅ رمز عبور با **bcrypt** هش می‌شود
- ✅ JWT با 30 روز اعتبار
- ✅ هر توکن در دیتابیس ذخیره می‌شود
- ✅ CORS محدود به دامنه‌های مجاز
- ✅ Security headers (CSP, X-Content-Type-Options, ...)
- ✅ SQL Injection محافظت شده (با Prepared Statements)
- ✅ پشتیبان JSON با AES-256-GCM رمزنگاری می‌شود

## 🧪 تست

### تست آفلاین:
1. DevTools → Network → Offline
2. یک محصول جدید بسازید
3. در Console ببینید: `syncQueue has 1 pending items`

### تست sync:
1. آنلاین شوید
2. در Console ببینید: `✅ 1 محصول همگام شد`

### تست چند کاربره:
1. با دو مرورگر مختلف دو کاربر بسازید
2. هر کاربر داده‌های جداگانه دارد

## 📊 مانیتورینگ

### JavaScript Console:
```javascript
// تعداد اقلام در صف
FactorinoSync.getQueueLength()

// sync دستی
FactorinoSync.syncNow()

// چک کردن آنلاین بودن
FactorinoSync.isOnline()
```

### MySQL:
```sql
-- دیدن لاگ‌های sync
SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT 50;

-- کاربران فعال
SELECT u.email, COUNT(s.id) as active_sessions
FROM users u
LEFT JOIN sessions s ON u.id = s.user_id AND s.expires_at > NOW()
GROUP BY u.id;
```

## 🚀 Deploy در Production

1. تنظیم `NODE_ENV=production` در `.env`
2. تغییر `JWT_SECRET` به یک رشته تصادفی قوی
3. فعال کردن HTTPS
4. محدود کردن CORS به دامنه اصلی
5. افزودن Rate Limiting
6. پشتیبان منظم MySQL

## 🛠️ تکنولوژی‌ها

### Frontend:
- Vanilla JavaScript (بدون فریم‌ورک)
- IndexedDB (ذخیره محلی)
- Service Worker (PWA)
- Web Speech API (تشخیص گفتار)
- Canvas API (نمودارها)

### Backend:
- Node.js + Express
- MySQL 
- JWT (jsonwebtoken)
- bcrypt (هش رمز)

## 📝 تغییرات نسبت به v1.0

| ویژگی | v1.0 | v2.0 |
|------|------|------|
| کاربران | تک کاربره | چند کاربره |
| دیتابیس | فقط IndexedDB | IndexedDB + MySQL |
| Sync | ندارد | Offline-First Auto-Sync |
| احراز هویت | ندارد | JWT + bcrypt |
| Backend | Static Server | Express API |
| Multi-Device | خیر | بله (با sync) |

## 🐛 عیب‌یابی

مشکلات رایج و راه‌حل‌ها در فایل **[SETUP.md](./SETUP.md)** توضیح داده شده.

## 📄 لایسنس

این پروژه تحت لایسنس MIT منتشر شده است.

---

**نسخه:** 2.0.0  
**آخرین بروزرسانی:** 2024

برای سؤال یا باگ، Issue باز کنید.

