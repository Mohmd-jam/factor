# 🚀 راهنمای اجرای گام‌به‌گام فاکتورینو v2.0

این راهنما دقیقاً به شما می‌گوید چه کارهایی باید انجام دهید.

---

## ✅ قبل از شروع - چک‌لیست پیش‌نیازها

باز کنید **Command Prompt** یا **PowerShell** و این دستورات را تست کنید:

```bash
# 1. Node.js نصب شده؟
node --version
# باید نسخه 18 یا بالاتر باشد (مثلاً v18.17.0)

# 2. npm نصب شده؟
npm --version
# باید یک عدد نمایش دهد (مثلاً 9.6.7)

# 3. MySQL نصب شده؟
mysql --version
# باید نسخه MySQL یا MariaDB را نمایش دهد
```

### ❌ اگر هر کدام نصب نبود:
- **Node.js**: از [nodejs.org](https://nodejs.org) نصب کنید
- **MySQL**: 
  - گزینه 1: [XAMPP](https://www.apachefriends.org) (آسان‌تر)
  - گزینه 2: [MySQL Community](https://dev.mysql.com/downloads/installer/)

---

## 📂 مرحله 1: آماده‌سازی فایل‌ها

### 1.1 باز کردن Terminal در پوشه پروژه

```bash
cd C:\Users\PC2\Desktop\factorino
```

### 1.2 نصب Dependencies

```bash
npm install
```

**انتظار داشته باشید:** این مرحله 1-2 دقیقه طول می‌کشد.

**✅ موفقیت آمیز بود؟** باید پوشه `node_modules` ایجاد شده باشد.

---

## 🗄️ مرحله 2: راه‌اندازی MySQL

### 2.1 شروع MySQL Service

**اگر XAMPP دارید:**
1. XAMPP Control Panel را باز کنید
2. روی دکمه **Start** کنار MySQL کلیک کنید
3. باید سبز شود ✅

**اگر MySQL مستقیم نصب کردید:**
```bash
net start MySQL80
```

### 2.2 تست اتصال به MySQL

باز کنید Command Prompt:

```bash
mysql -u root -p
```

**رمز عبور را وارد کنید** (اگر رمز ندارید، فقط Enter بزنید)

**✅ اگر وارد شدید:** یعنی MySQL کار می‌کند! با تایپ `exit` خارج شوید.

**❌ اگر خطا داد:** 
- بررسی کنید MySQL service در حال اجرا باشد
- رمز عبور را چک کنید

### 2.3 ایجاد دیتابیس

**روش 1 (آسان - خودکار):**
```bash

```

**روش 2 (دستی):**
```bash
mysql -u root -p < database\schema.sql
```

رمز MySQL را وارد کنید.

**✅ موفقیت:** باید پیام "دیتابیس با موفقیت راه‌اندازی شد" ببینید.

---

## ⚙️ مرحله 3: تنظیم فایل `.env`

### 3.1 کپی کردن فایل نمونه

```bash
copy .env.example .env
```

### 3.2 ویرایش فایل `.env`

با **Notepad** یا **VS Code** فایل `.env` را باز کنید:

```env
# اطلاعات MySQL خودتان را وارد کنید:
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=YOUR_MYSQL_PASSWORD_HERE    # ⚠️ رمز MySQL خودتان
DB_NAME=factorino_db

# یک رشته تصادفی 32 کاراکتری:
JWT_SECRET=change-this-to-random-32-character-string    # ⚠️ تغییر دهید

# تنظیمات سرور:
PORT=8080
HOST=0.0.0.0
NODE_ENV=development
```

**⚠️ مهم:**
- `DB_PASSWORD` را با رمز واقعی MySQL خودتان جایگزین کنید
- `JWT_SECRET` را با یک رشته تصادفی تغییر دهید

**نکته:** برای ساخت رشته تصادفی:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**ذخیره و بستن** فایل `.env`

---

## 🔧 مرحله 4: تغییرات کد (مهم!)

### 4.1 تغییرات در `index.html`

باز کنید: `c:\Users\PC2\Desktop\factorino\index.html`

**پیدا کنید:** خط `</body>` (آخرین خط قبل از `</html>`)

**قبل از آن اضافه کنید:**

```html
  <script src="js/db.js"></script>
  <script src="js/voice.js"></script>
  <script src="js/sync.js"></script>
  <script src="js/app.js"></script>
  <script>
    // چک کردن login
    (function() {
      const token = localStorage.getItem('factorino_token');
      if (!token) {
        window.location.href = '/login.html';
        return;
      }
      
      // شروع sync خودکار
      window.addEventListener('DOMContentLoaded', () => {
        window.FactorinoSync.startAutoSync();
        
        // Pull داده‌های اولیه
        window.FactorinoDB.loadState().then(state => {
          if (state.products.length === 0 && state.customers.length === 0 && state.invoices.length === 0) {
            console.log('📥 دریافت داده‌های اولیه...');
            window.FactorinoSync.pullInitialData().then(success => {
              if (success) window.location.reload();
            });
          }
        });
      });
    })();
  </script>
</body>
</html>
```

**ذخیره کنید** (Ctrl+S)

### 4.2 تغییرات در `js/app.js`

باز کنید: `c:\Users\PC2\Desktop\factorino\js\app.js`

#### تغییر 1: UUID function (در ابتدای فایل، خط 7)

**پیدا کنید:**
```javascript
const uid = prefix => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
```

**جایگزین کنید با:**
```javascript
const uid = prefix => {
  const uuid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${uuid}`;
};
```

#### تغییر 2: تابع `saveProduct` (حدود خط 360)

**پیدا کنید:**
```javascript
async function saveProduct(event) {
  event.preventDefault();
  if (!$('#productForm').reportValidity()) return;
  const id = $('#productId').value || uid('product');
  const product = {
    id, name: $('#productName').value.trim(), price: numeric($('#productPrice').value),
    unit: $('#productUnit').value, sku: $('#productSku').value.trim(), category: $('#productCategory').value.trim(),
    aliases: $('#productAliases').value.split(/[،,]/).map(item => item.trim()).filter(Boolean), active: true,
    updatedAt: new Date().toISOString()
  };
  const duplicate = state.products.find(item => item.id !== id && normalize(item.name) === normalize(product.name));
  if (duplicate) { toast('محصولی با همین نام وجود دارد.', 'error'); return; }
  const index = state.products.findIndex(item => item.id === id);
  if (index >= 0) state.products[index] = { ...state.products[index], ...product };
  else state.products.unshift({ ...product, createdAt: new Date().toISOString() });
  await persist(true);
  $('#productDialog').close();
  renderProducts(); renderProductOptions(); renderDashboard();
  toast(index >= 0 ? 'محصول ویرایش شد.' : 'محصول اضافه شد.');
}
```

**قبل از خط `$('#productDialog').close();` اضافه کنید:**
```javascript
  // اضافه کردن به صف sync
  await window.FactorinoSync.addToQueue(
    index >= 0 ? 'update' : 'create',
    'product',
    id,
    product
  );
```

#### تغییر 3: تابع `saveCustomer` (حدود خط 380)

**پیدا کنید تابع `saveCustomer`** و قبل از خط `$('#customerDialog').close();` اضافه کنید:
```javascript
  // اضافه کردن به صف sync
  await window.FactorinoSync.addToQueue(
    index >= 0 ? 'update' : 'create',
    'customer',
    id,
    customer
  );
```

#### تغییر 4: تابع `saveInvoice` (حدود خط 270)

**پیدا کنید تابع `saveInvoice`** و قبل از خط `renderAll();` اضافه کنید:
```javascript
  // اضافه کردن به صف sync
  await window.FactorinoSync.addToQueue(
    isNew ? 'create' : 'update',
    'invoice',
    editor.id,
    clone(editor)
  );
```

**ذخیره کنید** (Ctrl+S)

---

## 🚀 مرحله 5: اجرای برنامه

### 5.1 شروع سرور

در Terminal:

```bash
npm start
```

**✅ موفقیت:** باید این پیام را ببینید:

```
╔═══════════════════════════════════════════════════╗
║         🚀 Factorino Server Started              ║
╠═══════════════════════════════════════════════════╣
║  URL: http://0.0.0.0:8080                        ║
║  Mode: development                                ║
║  API: http://0.0.0.0:8080/api                    ║
╚═══════════════════════════════════════════════════╝
```

**❌ خطا؟**
- `Port 8080 in use`: پورت اشغاله، در `.env` پورت را به 3000 تغییر دهید
- `MySQL connection failed`: بررسی کنید MySQL در حال اجرا باشد و رمز در `.env` درست باشد

### 5.2 باز کردن مرورگر

باز کنید: **http://localhost:8080**

باید صفحه **ثبت‌نام** را ببینید! 🎉

---

## 👤 مرحله 6: ثبت‌نام اولین کاربر

1. روی **"ثبت‌نام کنید"** کلیک کنید
2. اطلاعات را وارد کنید:
   - **نام کسب‌وکار**: فروشگاه تست
   - **ایمیل**: test@test.com
   - **رمز عبور**: 123456
   - بقیه اختیاری است
3. روی **"ثبت‌نام و ورود"** کلیک کنید

**✅ موفقیت:** باید به صفحه اصلی منتقل شوید!

---

## 🧪 مرحله 7: تست کارکرد

### تست 1: ساخت محصول
1. از منوی سمت راست **"محصولات"** را کلیک کنید
2. **"محصول جدید"** را بزنید
3. نام: قهوه، قیمت: 50000
4. ذخیره کنید

**✅ باید در لیست ظاهر شود**

### تست 2: حالت آفلاین
1. کلید **F12** را بزنید (DevTools)
2. برگه **Network** را باز کنید
3. چک‌باکس **Offline** را فعال کنید ✅
4. یک محصول دیگر بسازید (مثلاً چای)
5. باید ذخیره شود!
6. برگه **Console** را باز کنید
7. تایپ کنید: `FactorinoSync.getQueueLength()`
8. باید عدد 1 برگرداند (یک آیتم در صف)

### تست 3: Sync خودکار
1. چک‌باکس **Offline** را غیرفعال کنید
2. صبر کنید 30 ثانیه
3. در **Console** باید ببینید: `✅ 1 محصول همگام شد`
4. تایپ کنید: `FactorinoSync.getQueueLength()`
5. باید عدد 0 برگرداند (صف خالی شد)

### تست 4: چک کردن MySQL
```bash
mysql -u root -p
```

در MySQL:
```sql
USE factorino_db;
SELECT * FROM products;
```

**✅ باید محصولات را ببینید!**

```sql
SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT 5;
```

**✅ باید لاگ‌های sync را ببینید!**

خروج: `exit`

---

## 🎉 تمام! برنامه شما آماده است

حالا می‌توانید:
- ✅ محصولات، مشتریان و فاکتور بسازید
- ✅ آفلاین کار کنید
- ✅ با چند نفر همزمان استفاده کنید
- ✅ داده‌ها خودکار sync می‌شوند

---

## 🆘 عیب‌یابی

### مشکل: "Cannot find module 'express'"
```bash
npm install
```

### مشکل: "MySQL connection failed"
1. بررسی کنید MySQL در حال اجرا باشد
2. رمز عبور در `.env` را چک کنید
3. دستور `mysql -u root -p` را تست کنید

### مشکل: "Port 8080 already in use"
در `.env` تغییر دهید:
```
PORT=3000
```

### مشکل: صفحه سفید است
1. F12 را بزنید
2. برگه Console را باز کنید
3. خطاها را بخوانید
4. احتمالاً script tags را فراموش کرده‌اید

### مشکل: "401 Unauthorized"
1. از برنامه logout کنید
2. localStorage را پاک کنید: `localStorage.clear()`
3. دوباره login کنید

---

## 📞 کمک بیشتر

- فایل `SETUP.md` - راهنمای کامل
- فایل `CHANGES.md` - جزئیات تغییرات
- فایل `QUICKSTART.md` - شروع سریع

---

**موفق باشید! 🚀🎉**
