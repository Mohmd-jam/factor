# 📝 تغییرات دقیق کد - کپی/پیست آماده

این فایل شامل تمام تغییرات لازم است که باید در کد اعمال کنید.

---

## 1️⃣ فایل: `index.html`

### محل: قبل از `</body>` (آخرین خط)

**پیدا کنید:**
```html
</body>
</html>
```

**تبدیل کنید به:**
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

---

## 2️⃣ فایل: `js/app.js`

### تغییر A: UUID function (خط 7 تقریباً)

**پیدا کنید:**
```javascript
const uid = prefix => `${prefix}-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
```

**جایگزین کنید:**
```javascript
const uid = prefix => {
  const uuid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${uuid}`;
};
```

---

### تغییر B: تابع `saveProduct`

**پیدا کنید این تابع (حدود خط 360):**
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

**جایگزین کنید با این:**
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
  
  // ⭐ اضافه کردن به صف sync
  await window.FactorinoSync.addToQueue(
    index >= 0 ? 'update' : 'create',
    'product',
    id,
    product
  );
  
  $('#productDialog').close();
  renderProducts(); renderProductOptions(); renderDashboard();
  toast(index >= 0 ? 'محصول ویرایش شد.' : 'محصول اضافه شد.');
}
```

---

### تغییر C: تابع `saveCustomer`

**پیدا کنید این تابع (حدود خط 380):**
```javascript
async function saveCustomer(event) {
  event.preventDefault();
  if (!$('#customerForm').reportValidity()) return;
  const id = $('#customerId').value || uid('customer');
  const customer = {
    id, name: $('#customerName').value.trim(), phone: $('#customerPhone').value.trim(),
    taxId: $('#customerTaxId').value.trim(), city: $('#customerCity').value.trim(),
    postalCode: $('#customerPostal').value.trim(), address: $('#customerAddress').value.trim(),
    note: $('#customerNote').value.trim(), updatedAt: new Date().toISOString()
  };
  const index = state.customers.findIndex(item => item.id === id);
  if (index >= 0) state.customers[index] = { ...state.customers[index], ...customer };
  else state.customers.unshift({ ...customer, createdAt: new Date().toISOString() });
  await persist(true);
  $('#customerDialog').close();
  renderCustomers(); renderCustomerOptions(); renderDashboard();
  if (activeRoute === 'new-invoice' && !editor.customerId) {
    editor.customerId = id;
    editor.place = customer.address || customer.city || editor.place;
    renderEditor(); persist();
  }
  toast(index >= 0 ? 'اطلاعات مشتری ویرایش شد.' : 'مشتری اضافه شد.');
}
```

**جایگزین کنید با این:**
```javascript
async function saveCustomer(event) {
  event.preventDefault();
  if (!$('#customerForm').reportValidity()) return;
  const id = $('#customerId').value || uid('customer');
  const customer = {
    id, name: $('#customerName').value.trim(), phone: $('#customerPhone').value.trim(),
    taxId: $('#customerTaxId').value.trim(), city: $('#customerCity').value.trim(),
    postalCode: $('#customerPostal').value.trim(), address: $('#customerAddress').value.trim(),
    note: $('#customerNote').value.trim(), updatedAt: new Date().toISOString()
  };
  const index = state.customers.findIndex(item => item.id === id);
  if (index >= 0) state.customers[index] = { ...state.customers[index], ...customer };
  else state.customers.unshift({ ...customer, createdAt: new Date().toISOString() });
  await persist(true);
  
  // ⭐ اضافه کردن به صف sync
  await window.FactorinoSync.addToQueue(
    index >= 0 ? 'update' : 'create',
    'customer',
    id,
    customer
  );
  
  $('#customerDialog').close();
  renderCustomers(); renderCustomerOptions(); renderDashboard();
  if (activeRoute === 'new-invoice' && !editor.customerId) {
    editor.customerId = id;
    editor.place = customer.address || customer.city || editor.place;
    renderEditor(); persist();
  }
  toast(index >= 0 ? 'اطلاعات مشتری ویرایش شد.' : 'مشتری اضافه شد.');
}
```

---

### تغییر D: تابع `saveInvoice`

**پیدا کنید این تابع (حدود خط 270):**
```javascript
async function saveInvoice(status) {
  syncEditorFields();
  const error = validateInvoice(editor, status === 'final');
  if (error) { toast(error, 'error'); return null; }
  const isNew = !editor.id;
  if (isNew) {
    editor.id = uid('invoice');
    editor.number = `${state.settings.invoicePrefix}${state.settings.nextInvoiceNumber}`;
    state.settings.nextInvoiceNumber += 1;
    editor.createdAt = new Date().toISOString();
  }
  editor.status = status;
  editor.updatedAt = new Date().toISOString();
  editor.customerName = customerById(editor.customerId)?.name || '';
  const index = state.invoices.findIndex(inv => inv.id === editor.id);
  if (index >= 0) state.invoices[index] = clone(editor);
  else state.invoices.unshift(clone(editor));
  await persist(true);
  renderAll();
  if (status === 'final') {
    toast('فاکتور با موفقیت ثبت شد.');
    openPreview(editor);
  } else toast('پیش‌نویس ذخیره شد.');
  return editor;
}
```

**جایگزین کنید با این:**
```javascript
async function saveInvoice(status) {
  syncEditorFields();
  const error = validateInvoice(editor, status === 'final');
  if (error) { toast(error, 'error'); return null; }
  const isNew = !editor.id;
  if (isNew) {
    editor.id = uid('invoice');
    editor.number = `${state.settings.invoicePrefix}${state.settings.nextInvoiceNumber}`;
    state.settings.nextInvoiceNumber += 1;
    editor.createdAt = new Date().toISOString();
  }
  editor.status = status;
  editor.updatedAt = new Date().toISOString();
  editor.customerName = customerById(editor.customerId)?.name || '';
  const index = state.invoices.findIndex(inv => inv.id === editor.id);
  if (index >= 0) state.invoices[index] = clone(editor);
  else state.invoices.unshift(clone(editor));
  await persist(true);
  
  // ⭐ اضافه کردن به صف sync
  await window.FactorinoSync.addToQueue(
    isNew ? 'create' : 'update',
    'invoice',
    editor.id,
    clone(editor)
  );
  
  renderAll();
  if (status === 'final') {
    toast('فاکتور با موفقیت ثبت شد.');
    openPreview(editor);
  } else toast('پیش‌نویس ذخیره شد.');
  return editor;
}
```

---

## ✅ خلاصه تغییرات

| فایل | تعداد تغییرات | خلاصه |
|------|--------------|-------|
| `index.html` | 1 مورد | اضافه کردن script tags |
| `js/app.js` | 4 مورد | UUID function + 3 تابع save |

**جمع کل:** 5 تغییر کوچک!

---

## 💡 نکات مهم

1. **فراموش نکنید**: بعد از هر تغییر فایل را **Save** کنید (Ctrl+S)
2. **دقت کنید**: فاصله‌ها (indentation) مهم هستند
3. **تست کنید**: بعد از تغییرات، برنامه را restart کنید
4. **Console**: همیشه Console مرورگر را چک کنید (F12)

---

## 🔍 چگونه تست کنم تغییرات درست است؟

بعد از اعمال تغییرات:

1. سرور را restart کنید: `npm start`
2. مرورگر را باز کنید: http://localhost:8080
3. یک محصول بسازید
4. Console را باز کنید (F12)
5. تایپ کنید: `window.FactorinoSync`
6. باید object برگرداند ✅

اگر `undefined` برگرداند، یعنی script tags اضافه نشده‌اند.

---

**تمام! 🎉**
