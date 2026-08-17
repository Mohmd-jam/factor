# تغییرات لازم برای اضافه کردن Sync

## 🔧 تغییرات در `index.html`

### 1. اضافه کردن script tags قبل از `</body>`:

```html
</body>
```

---

## 🔧 تغییرات در `app.js`

### اضافه کردن UUID function:

در ابتدای فایل:

```javascript
const uid = prefix => {
  const uuid = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${uuid}`;
};
```

### تغییر در تابع `saveProduct`:

```javascript
async function saveProduct(event) {
  event.preventDefault();
  if (!$('#productForm').reportValidity()) return;
  
  const id = $('#productId').value || uid('product');
  const product = {
    id,
    name: $('#productName').value.trim(),
    price: numeric($('#productPrice').value),
    unit: $('#productUnit').value,
    sku: $('#productSku').value.trim(),
    category: $('#productCategory').value.trim(),
    aliases: $('#productAliases').value.split(/[،,]/).map(item => item.trim()).filter(Boolean),
    active: true,
    updatedAt: new Date().toISOString()
  };
  
  const duplicate = state.products.find(item => item.id !== id && normalize(item.name) === normalize(product.name));
  if (duplicate) {
    toast('محصولی با همین نام وجود دارد.', 'error');
    return;
  }
  
  const index = state.products.findIndex(item => item.id === id);
  if (index >= 0) {
    state.products[index] = { ...state.products[index], ...product };
  } else {
    product.createdAt = new Date().toISOString();
    state.products.unshift(product);
  }
  
  await persist(true);
  
  // اضافه کردن به صف sync
  await window.FactorinoSync.addToQueue(
    index >= 0 ? 'update' : 'create',
    'product',
    id,
    product
  );
  
  $('#productDialog').close();
  renderProducts();
  renderProductOptions();
  renderDashboard();
  toast(index >= 0 ? 'محصول ویرایش شد.' : 'محصول اضافه شد.');
}
```

### تغییر در تابع `saveCustomer`:

```javascript
async function saveCustomer(event) {
  event.preventDefault();
  if (!$('#customerForm').reportValidity()) return;
  
  const id = $('#customerId').value || uid('customer');
  const customer = {
    id,
    name: $('#customerName').value.trim(),
    phone: $('#customerPhone').value.trim(),
    taxId: $('#customerTaxId').value.trim(),
    city: $('#customerCity').value.trim(),
    postalCode: $('#customerPostal').value.trim(),
    address: $('#customerAddress').value.trim(),
    note: $('#customerNote').value.trim(),
    updatedAt: new Date().toISOString()
  };
  
  const index = state.customers.findIndex(item => item.id === id);
  if (index >= 0) {
    state.customers[index] = { ...state.customers[index], ...customer };
  } else {
    customer.createdAt = new Date().toISOString();
    state.customers.unshift(customer);
  }
  
  await persist(true);
  
  // اضافه کردن به صف sync
  await window.FactorinoSync.addToQueue(
    index >= 0 ? 'update' : 'create',
    'customer',
    id,
    customer
  );
  
  $('#customerDialog').close();
  renderCustomers();
  renderCustomerOptions();
  renderDashboard();
  
  if (activeRoute === 'new-invoice' && !editor.customerId) {
    editor.customerId = id;
    editor.place = customer.address || customer.city || editor.place;
    renderEditor();
    persist();
  }
  
  toast(index >= 0 ? 'اطلاعات مشتری ویرایش شد.' : 'مشتری اضافه شد.');
}
```

### تغییر در تابع `saveInvoice`:

```javascript
async function saveInvoice(status) {
  syncEditorFields();
  const error = validateInvoice(editor, status === 'final');
  if (error) {
    toast(error, 'error');
    return null;
  }
  
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
  if (index >= 0) {
    state.invoices[index] = clone(editor);
  } else {
    state.invoices.unshift(clone(editor));
  }
  
  await persist(true);
  
  // اضافه کردن به صف sync
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
  } else {
    toast('پیش‌نویس ذخیره شد.');
  }
  
  return editor;
}
```

---

## ✅ خلاصه تغییرات

1. ✅ فایل‌های جدید ساخته شدند:
   - `login.html` - صفحه ورود/ثبت‌نام
   - `css/login.css` - استایل صفحه لاگین
   - `js/auth.js` - مدیریت authentication
   - `js/sync.js` - موتور Offline-First sync
   - `api/` - تمام backend API
   - `database/schema.sql` - ساختار دیتابیس

2. ✅ فایل‌های بروز شدند:
   - `package.json` - dependencies جدید
   - `server.js` - سرور Express با API
   - `js/db.js` - پشتیبانی syncQueue

3. ⚠️ نیاز به تغییر دستی:
   - `index.html` - اضافه کردن script tags (بالا)
   - `app.js` - تغییر توابع save (بالا)

---

## 🚀 مراحل بعدی

1. اضافه کردن script tags به `index.html`
2. اعمال تغییرات در `app.js`
3. اجرای `npm install`
4. راه‌اندازی MySQL و اجرای schema
5. تنظیم `.env`
6. اجرای سرور با `npm start`

همه چیز آماده است! 🎉
