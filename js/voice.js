/* =========================================================================
 * فاکتورینو — موتور دستیار صوتی فارسی
 *
 * این فایل دو بخش دارد:
 *   ۱) موتور تحلیل زبان فارسی (کاملاً آفلاین، بدون هیچ سرویس ابری)
 *      - تبدیل ارقام فارسی/عربی، عددهای حرفی («بیست و پنج»)، کسرها («نیم»، «ربع»)
 *      - واحدها («کیلو»، «گرم»، «بسته»، «تا»)
 *      - تطبیق فازی نام محصول با نام‌های مستعار و غلط‌های رایج تشخیص گفتار
 *      - دستورهای افزودن، حذف، تغییر تعداد/قیمت، تخفیف، مالیات، مشتری، ثبت، چاپ
 *   ۲) پوشش نازک روی Web Speech API مرورگر با راه‌اندازی مجدد خودکار
 *
 * وابستگی: هیچ. app.js آن را با FactorinoVoice.configure({...}) تنظیم می‌کند.
 * ========================================================================= */
(function () {
  'use strict';

  // =======================================================================
  // ۱) نرمال‌سازی متن فارسی
  // =======================================================================

  var PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  var ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

  /** ارقام فارسی و عربی را به لاتین تبدیل می‌کند. */
  function toLatinDigits(str) {
    return String(str == null ? '' : str).replace(/[۰-۹٠-٩]/g, function (ch) {
      var i = PERSIAN_DIGITS.indexOf(ch);
      if (i >= 0) return String(i);
      return String(ARABIC_DIGITS.indexOf(ch));
    });
  }

  /**
   * نرمال‌سازی کامل: حروف عربی → فارسی، حذف اعراب و نیم‌فاصله،
   * یکسان‌سازی فاصله‌ها و ارقام.
   */
  function normalize(str) {
    var s = toLatinDigits(str || '');
    s = s
      .replace(/[\u064B-\u0652\u0670\u0640]/g, '') // اعراب و کشیده
      .replace(/[\u200c\u200f\u200e]/g, ' ') // نیم‌فاصله و کاراکترهای جهت
      .replace(/[ يیۍێ]/g, function (c) {
        return c === ' ' ? ' ' : 'ی';
      })
      .replace(/[كڪﻙ]/g, 'ک')
      .replace(/[ؤئأإآا]/g, function (c) {
        return c === 'آ' || c === 'أ' || c === 'إ' || c === 'ا' ? 'ا' : c === 'ؤ' ? 'و' : 'ی';
      })
      .replace(/ة/g, 'ه')
      .replace(/[\u061F?!.,;:،؛«»"'()\[\]{}]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return s;
  }

  /** نرمال‌سازی سخت‌گیرانه برای مقایسه نام‌ها (حذف فاصله و «ه» پایانی). */
  function nameKey(str) {
    return normalize(str).replace(/\s+/g, '').replace(/ه$/, '');
  }

  // =======================================================================
  // ۲) اعداد فارسی
  // =======================================================================

  var ONES = {
    'صفر': 0, 'یک': 1, 'یه': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'چار': 4, 'پنج': 5,
    'شش': 6, 'شیش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9,
  };

  var TEENS = {
    'ده': 10, 'یازده': 11, 'دوازده': 12, 'سیزده': 13, 'چهارده': 14, 'چارده': 14,
    'پانزده': 15, 'پونزده': 15, 'شانزده': 16, 'شونزده': 16, 'هفده': 17, 'هیفده': 17,
    'هجده': 18, 'هیجده': 18, 'نوزده': 19,
  };

  var TENS = {
    'بیست': 20, 'سی': 30, 'چهل': 40, 'پنجاه': 50, 'شصت': 60,
    'هفتاد': 70, 'هشتاد': 80, 'نود': 90,
  };

  var HUNDREDS = {
    'صد': 100, 'یکصد': 100, 'دویست': 200, 'سیصد': 300, 'چهارصد': 400, 'چارصد': 400,
    'پانصد': 500, 'پونصد': 500, 'ششصد': 600, 'شیشصد': 600, 'هفتصد': 700, 'هفصد': 700,
    'هشتصد': 800, 'نهصد': 900,
  };

  var SCALES = {
    'هزار': 1000, 'میلیون': 1000000, 'ملیون': 1000000, 'میلیارد': 1000000000, 'ملیارد': 1000000000,
  };

  var FRACTIONS = {
    'نیم': 0.5, 'نصف': 0.5, 'ربع': 0.25, 'چارک': 0.25, 'سه‌ربع': 0.75, 'سه ربع': 0.75,
  };

  var NUMBER_WORDS = {};
  [ONES, TEENS, TENS, HUNDREDS, SCALES, FRACTIONS].forEach(function (map) {
    Object.keys(map).forEach(function (k) {
      NUMBER_WORDS[normalize(k)] = map[k];
    });
  });

  function isNumberWord(token) {
    return Object.prototype.hasOwnProperty.call(NUMBER_WORDS, token) || /^\d+(\.\d+)?$/.test(token);
  }

  function wordValue(token) {
    if (/^\d+(\.\d+)?$/.test(token)) return parseFloat(token);
    return NUMBER_WORDS[token];
  }

  /**
   * دنباله‌ای از توکن‌ها را به عدد تبدیل می‌کند.
   * «بیست و پنج» → 25 ، «دو هزار و سیصد» → 2300 ، «یک و نیم» → 1.5
   * @returns {{value:number, length:number}|null}
   */
  function parseNumberTokens(tokens, start) {
    var total = 0;
    var current = 0;
    var used = 0;
    var seen = false;
    var fractionAdded = false;

    for (var i = start; i < tokens.length; i++) {
      var t = tokens[i];

      if (t === 'و') {
        // «و» فقط وقتی بخشی از عدد است که بعدش هم عدد باشد
        if (i + 1 < tokens.length && isNumberWord(tokens[i + 1]) && seen) {
          used = i + 1 - start;
          continue;
        }
        break;
      }

      if (!isNumberWord(t)) break;

      var v = wordValue(t);
      seen = true;

      if (v === 0.5 || v === 0.25 || v === 0.75) {
        // «نیم» تنها → 0.5 ، «یک و نیم» → 1.5
        current += v;
        fractionAdded = true;
      } else if (v >= 1000) {
        current = (current === 0 ? 1 : current) * v;
        total += current;
        current = 0;
      } else if (v >= 100) {
        // «صد» و «دویست» خودشان مقدار کامل دارند و جمع می‌شوند
        current += v;
      } else {
        current += v;
      }

      used = i + 1 - start;

      // بعد از کسر، عدد تمام‌شده تلقی می‌شود
      if (fractionAdded && i + 1 < tokens.length && !isNumberWord(tokens[i + 1])) break;
    }

    if (!seen) return null;
    return { value: total + current, length: used };
  }

  // =======================================================================
  // ۳) واحدها
  // =======================================================================

  var UNITS = [
    { keys: ['کیلو', 'کیلوگرم', 'کیلوگرمی', 'کیلویی'], unit: 'کیلوگرم', factor: 1 },
    { keys: ['گرم', 'گرمی'], unit: 'کیلوگرم', factor: 0.001 },
    { keys: ['تن'], unit: 'کیلوگرم', factor: 1000 },
    { keys: ['لیتر', 'لیتری'], unit: 'لیتر', factor: 1 },
    { keys: ['متر', 'متری'], unit: 'متر', factor: 1 },
    { keys: ['سانت', 'سانتیمتر'], unit: 'متر', factor: 0.01 },
    { keys: ['بسته', 'پک', 'بستهای'], unit: 'بسته', factor: 1 },
    { keys: ['جعبه', 'کارتن', 'کارتون'], unit: 'کارتن', factor: 1 },
    { keys: ['شیشه', 'بطری'], unit: 'بطری', factor: 1 },
    { keys: ['جفت'], unit: 'جفت', factor: 1 },
    { keys: ['دست'], unit: 'دست', factor: 1 },
    { keys: ['عدد', 'تا', 'دانه', 'تایی', 'عددی'], unit: 'عدد', factor: 1 },
  ];

  var UNIT_LOOKUP = {};
  UNITS.forEach(function (u) {
    u.keys.forEach(function (k) {
      UNIT_LOOKUP[normalize(k)] = u;
    });
  });

  // کلمات پرکاربردی که در تطبیق نام محصول نادیده گرفته می‌شوند
  var STOPWORDS = {};
  ['را', 'رو', 'به', 'با', 'از', 'در', 'که', 'هم', 'یک', 'یه', 'تا', 'عدد', 'دانه',
    'لطفا', 'لطفن', 'بزن', 'اضافه', 'کن', 'کنید', 'بنویس', 'ثبت', 'بذار', 'بگذار',
    'برای', 'میخوام', 'می‌خوام', 'بده', 'هست', 'است', 'این', 'اون', 'آن', 'و',
  ].forEach(function (w) {
    STOPWORDS[normalize(w)] = true;
  });

  // =======================================================================
  // ۴) تطبیق فازی نام محصول
  // =======================================================================

  /** فاصله ویرایشی (Levenshtein) با سقف زودهنگام. */
  function levenshtein(a, b) {
    if (a === b) return 0;
    var m = a.length;
    var n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    var prev = new Array(n + 1);
    var cur = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      cur[0] = i;
      var ca = a.charCodeAt(i - 1);
      for (var k = 1; k <= n; k++) {
        var cost = ca === b.charCodeAt(k - 1) ? 0 : 1;
        cur[k] = Math.min(cur[k - 1] + 1, prev[k] + 1, prev[k - 1] + cost);
      }
      var tmp = prev;
      prev = cur;
      cur = tmp;
    }
    return prev[n];
  }

  /** شباهت دو رشته بین ۰ و ۱ بر پایه فاصله ویرایشی. */
  function similarity(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    var max = Math.max(a.length, b.length);
    return 1 - levenshtein(a, b) / max;
  }

  /** ضریب دایس روی دوتایی‌های حروف — برای نام‌های چندکلمه‌ای بهتر عمل می‌کند. */
  function diceCoefficient(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
    var bigrams = {};
    var count = 0;
    var i;
    for (i = 0; i < a.length - 1; i++) {
      var g = a.substr(i, 2);
      bigrams[g] = (bigrams[g] || 0) + 1;
    }
    for (i = 0; i < b.length - 1; i++) {
      var h = b.substr(i, 2);
      if (bigrams[h] > 0) {
        bigrams[h]--;
        count++;
      }
    }
    return (2 * count) / (a.length - 1 + b.length - 1);
  }

  /**
   * بهترین محصول متناظر با یک عبارت را پیدا می‌کند.
   * @param {string} phrase عبارت گفته‌شده (نرمال‌شده یا خام)
   * @param {Array} products فهرست محصولات {uuid,name,aliases,sku,unit,price}
   * @returns {{product:Object, score:number}|null}
   */
  function matchProduct(phrase, products) {
    if (!phrase || !products || !products.length) return null;

    var norm = normalize(phrase);
    var key = nameKey(phrase);
    if (!key) return null;

    var phraseTokens = norm.split(' ').filter(function (t) {
      return t && !STOPWORDS[t];
    });

    var best = null;

    products.forEach(function (p) {
      var candidates = [p.name];
      if (Array.isArray(p.aliases)) candidates = candidates.concat(p.aliases);
      else if (p.aliases) candidates = candidates.concat(String(p.aliases).split(','));
      if (p.sku) candidates.push(p.sku);

      candidates.forEach(function (cand) {
        if (!cand) return;
        var candNorm = normalize(cand);
        var candKey = nameKey(cand);
        if (!candKey) return;

        var score = 0;

        if (candKey === key) {
          score = 1;
        } else if (key.indexOf(candKey) >= 0 || candKey.indexOf(key) >= 0) {
          // یکی زیررشته دیگری است — هرچه طول‌ها نزدیک‌تر، امتیاز بالاتر
          score = 0.9 * (Math.min(candKey.length, key.length) / Math.max(candKey.length, key.length)) + 0.05;
        } else {
          var lev = similarity(candKey, key);
          var dice = diceCoefficient(candKey, key);
          score = Math.max(lev, dice) * 0.92;

          // هم‌پوشانی کلمه‌ای: «آب معدنی دماوند» با «آب معدنی»
          var candTokens = candNorm.split(' ').filter(function (t) {
            return t && !STOPWORDS[t];
          });
          if (candTokens.length && phraseTokens.length) {
            var hits = 0;
            candTokens.forEach(function (ct) {
              for (var i = 0; i < phraseTokens.length; i++) {
                if (similarity(ct, phraseTokens[i]) >= 0.8) {
                  hits++;
                  break;
                }
              }
            });
            var overlap = hits / Math.max(candTokens.length, phraseTokens.length);
            score = Math.max(score, overlap * 0.95);
          }
        }

        if (!best || score > best.score) {
          best = { product: p, score: score, matched: cand };
        }
      });
    });

    return best && best.score > 0 ? best : null;
  }

  /** بهترین مشتری متناظر با یک عبارت. */
  function matchCustomer(phrase, customers) {
    if (!phrase || !customers || !customers.length) return null;
    var key = nameKey(phrase);
    if (!key) return null;
    var best = null;
    customers.forEach(function (c) {
      var candKey = nameKey(c.name || '');
      if (!candKey) return;
      var score;
      if (candKey === key) score = 1;
      else if (key.indexOf(candKey) >= 0 || candKey.indexOf(key) >= 0) score = 0.88;
      else score = Math.max(similarity(candKey, key), diceCoefficient(candKey, key)) * 0.9;
      if (!best || score > best.score) best = { customer: c, score: score };
    });
    return best;
  }

  // =======================================================================
  // ۵) تحلیل دستور
  // =======================================================================

  var VERBS = {
    remove: ['حذف کن', 'حذف', 'پاک کن', 'بردار', 'بزن بیرون', 'کم کن', 'کنسل', 'لغو کن', 'نمیخوام', 'نمی خوام', 'بی خیال', 'بیخیال'],
    setQty: ['تعدادش', 'تعداد'],
    setPrice: ['قیمتش', 'قیمت'],
    customer: ['برای', 'مشتری', 'به نام', 'خریدار', 'به اسم'],
    discount: ['تخفیف'],
    tax: ['مالیات', 'ارزش افزوده'],
    shipping: ['هزینه ارسال', 'کرایه', 'ارسال'],
    notes: ['یادداشت', 'توضیح'],
    finalize: ['ثبت نهایی', 'نهایی کن', 'فاکتور رو ثبت کن', 'فاکتور را ثبت کن', 'ذخیره کن', 'تمام', 'تموم شد', 'ثبتش کن'],
    draft: ['پیش نویس', 'پیشنویس'],
    clear: ['پاک کردن فرم', 'فرم رو پاک کن', 'فرم را پاک کن', 'همه رو پاک کن', 'از اول', 'شروع دوباره'],
    print: ['چاپ', 'پرینت', 'پیش نمایش', 'پیشنمایش'],
    newInvoice: ['فاکتور جدید', 'فاکتور تازه'],
    paid: ['پرداخت شد', 'نقدی', 'پرداخت شده', 'تسویه شد'],
    unpaid: ['نسیه', 'پرداخت نشده', 'بدهکار'],
    help: ['راهنما', 'چیکار میتونی', 'کمک'],
  };

  function startsWithAny(text, phrases) {
    for (var i = 0; i < phrases.length; i++) {
      var p = normalize(phrases[i]);
      if (text === p || text.indexOf(p + ' ') === 0) return p;
    }
    return null;
  }

  function containsAny(text, phrases) {
    for (var i = 0; i < phrases.length; i++) {
      var p = normalize(phrases[i]);
      if (text.indexOf(p) >= 0) return p;
    }
    return null;
  }

  /**
   * جمله را به بخش‌های مستقل می‌شکند.
   * «سه آب معدنی و یک کیک» → ['سه آب معدنی', 'یک کیک']
   * «بیست و پنج تا قهوه» → یک بخش (چون «و» بین دو عدد است)
   */
  function splitSegments(text) {
    var separators = ['،', 'سپس', 'بعدش', 'بعد', 'همچنین', 'اضافه کن', 'به علاوه', 'پلاس'];
    var work = text;
    separators.forEach(function (sep) {
      var s = normalize(sep);
      if (!s) return;
      work = work.split(' ' + s + ' ').join(' | ');
      if (work.indexOf(s + ' ') === 0) work = work.slice(s.length + 1);
    });

    var tokens = work.split(' ');
    var segments = [];
    var current = [];

    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (t === '|') {
        if (current.length) segments.push(current.join(' '));
        current = [];
        continue;
      }
      if (t === 'و') {
        var prev = tokens[i - 1];
        var next = tokens[i + 1];
        var numeric = prev && next && isNumberWord(prev) && isNumberWord(next);
        // «یک و نیم کیلو» یک عدد است، ولی «قهوه و نیم کیلو پنیر» دو قلم؛
        // پس کسر فقط وقتی معتبر است که پیش از «و» هم عدد باشد.
        var fractional = prev && isNumberWord(prev) && (next === 'نیم' || next === 'ربع');
        if (numeric || fractional) {
          current.push(t);
          continue;
        }
        if (current.length) segments.push(current.join(' '));
        current = [];
        continue;
      }

      // «با» فقط وقتی جداکننده است که بعدش قلم تازه‌ای بیاید («... با یه کیک»)
      if (t === 'با' && current.length && isNumberWord(tokens[i + 1] || '')) {
        segments.push(current.join(' '));
        current = [];
        continue;
      }
      current.push(t);
    }
    if (current.length) segments.push(current.join(' '));

    return segments.filter(function (s) {
      return s.trim().length > 0;
    });
  }

  /**
   * یک بخش را به دستور تبدیل می‌کند.
   * @returns {Object} {type, ...}
   */
  function parseSegment(segment, context) {
    var text = normalize(segment);
    if (!text) return { type: 'unknown', text: segment };

    var products = (context && context.products) || [];
    var customers = (context && context.customers) || [];

    // ---- دستورهای سراسری (بدون آرگومان)
    if (containsAny(text, VERBS.newInvoice)) return { type: 'new-invoice', text: segment };
    if (containsAny(text, VERBS.clear)) return { type: 'clear', text: segment };
    if (containsAny(text, VERBS.finalize)) return { type: 'finalize', text: segment };
    if (containsAny(text, VERBS.draft)) return { type: 'draft', text: segment };
    if (containsAny(text, VERBS.print)) return { type: 'print', text: segment };
    if (containsAny(text, VERBS.paid)) return { type: 'payment', value: 'paid', text: segment };
    if (containsAny(text, VERBS.unpaid)) return { type: 'payment', value: 'unpaid', text: segment };
    if (containsAny(text, VERBS.help)) return { type: 'help', text: segment };

    // ---- تخفیف / مالیات / ارسال (عدد در جمله)
    var amountFields = [
      { verbs: VERBS.discount, type: 'discount' },
      { verbs: VERBS.tax, type: 'tax' },
      { verbs: VERBS.shipping, type: 'shipping' },
    ];
    for (var a = 0; a < amountFields.length; a++) {
      if (containsAny(text, amountFields[a].verbs)) {
        var amount = extractNumber(text);
        if (amount !== null) {
          var value = amount.value;
          // «پنجاه هزار تومان» یا «ده درصد»
          if (/درصد|٪|%/.test(text) && amountFields[a].type !== 'tax') {
            return { type: amountFields[a].type, value: value, percent: true, text: segment };
          }
          return { type: amountFields[a].type, value: value, text: segment };
        }
      }
    }

    // ---- مشتری
    var custPrefix = startsWithAny(text, ['برای', 'مشتری', 'به نام', 'به اسم', 'خریدار']);
    if (custPrefix) {
      var rest = text.slice(custPrefix.length).trim().replace(/^(اقای|خانم|جناب|سرکار)\s+/, '');
      if (rest) {
        var cm = matchCustomer(rest, customers);
        if (cm && cm.score >= 0.62) {
          return { type: 'customer', customer: cm.customer, score: cm.score, text: segment };
        }
        return { type: 'customer-new', name: rest, text: segment };
      }
    }

    // ---- یادداشت
    var notePrefix = startsWithAny(text, VERBS.notes);
    if (notePrefix) {
      return { type: 'notes', value: segment.replace(/^\s*\S+\s*/, '').trim(), text: segment };
    }

    // ---- حذف
    var removeVerb = containsAny(text, VERBS.remove);
    if (removeVerb) {
      var target = text.split(removeVerb).join(' ').trim();
      target = stripFillers(target);
      if (!target) {
        return { type: 'remove', target: 'last', text: segment };
      }
      if (/^(همه|همش|همشون|کل)$/.test(target)) {
        return { type: 'remove', target: 'all', text: segment };
      }
      if (/^(اخری|اخرین|قبلی|اخرین قلم|اخرین ردیف)$/.test(target)) {
        return { type: 'remove', target: 'last', text: segment };
      }
      // «ردیف سه را حذف کن»
      var rowNum = target.match(/^(?:ردیف|شماره|خط)\s+(.+)$/);
      if (rowNum) {
        var rn = extractNumber(rowNum[1]);
        if (rn) return { type: 'remove', row: rn.value, text: segment };
      }
      var rm = matchProduct(target, products);
      if (rm && rm.score >= 0.55) {
        return { type: 'remove', product: rm.product, score: rm.score, text: segment };
      }
      return { type: 'remove', target: target, text: segment };
    }

    // ---- تغییر تعداد: «تعداد قهوه را سه کن»
    if (startsWithAny(text, VERBS.setQty) || /تعداد/.test(text)) {
      var qtyNum = extractNumber(text);
      var qtyName = text.replace(/تعدادش?|را|رو|کن|بکن/g, ' ').trim();
      if (qtyNum) qtyName = qtyName.split(qtyNum.raw).join(' ').trim();
      var qm = matchProduct(qtyName, products);
      if (qtyNum) {
        return {
          type: 'set-qty',
          qty: qtyNum.value,
          product: qm && qm.score >= 0.55 ? qm.product : null,
          score: qm ? qm.score : 0,
          text: segment,
        };
      }
    }

    // ---- تغییر قیمت: «قیمت قهوه پنجاه هزار»
    if (startsWithAny(text, VERBS.setPrice) || /^قیمت/.test(text)) {
      var priceNum = extractNumber(text);
      var priceName = text.replace(/قیمتش?|را|رو|کن|بکن|تومان|ریال|تومن/g, ' ').trim();
      if (priceNum) priceName = priceName.split(priceNum.raw).join(' ').trim();
      var pm = matchProduct(priceName, products);
      if (priceNum) {
        return {
          type: 'set-price',
          price: priceNum.value,
          product: pm && pm.score >= 0.55 ? pm.product : null,
          score: pm ? pm.score : 0,
          text: segment,
        };
      }
    }

    // ---- افزودن قلم (حالت پیش‌فرض)
    return parseLine(text, segment, products);
  }

  /** حذف کلمات پرکاربرد اول/آخر عبارت. */
  function stripFillers(text) {
    var t = text;
    var fillers = ['لطفا', 'لطفن', 'یه', 'یک', 'رو', 'را', 'کن', 'بکن', 'کنید', 'بزن', 'اضافه', 'ثبت', 'بنویس', 'میخوام'];
    fillers.forEach(function (f) {
      var n = normalize(f);
      t = t.replace(new RegExp('(^|\\s)' + n + '($|\\s)', 'g'), ' ');
    });
    return t.replace(/\s+/g, ' ').trim();
  }

  /**
   * اولین عدد موجود در متن را استخراج می‌کند.
   * @returns {{value:number, raw:string, index:number, length:number}|null}
   */
  function extractNumber(text) {
    var tokens = text.split(' ');
    for (var i = 0; i < tokens.length; i++) {
      if (!isNumberWord(tokens[i])) continue;
      var parsed = parseNumberTokens(tokens, i);
      if (!parsed) continue;
      var raw = tokens.slice(i, i + parsed.length).join(' ');
      var value = parsed.value;
      // مقیاس پولی که بعد از عدد می‌آید: «پنجاه هزار تومان»
      return { value: value, raw: raw, index: i, length: parsed.length };
    }
    return null;
  }

  /** تحلیل یک قلم فاکتور: تعداد + واحد + نام محصول + قیمت اختیاری. */
  function parseLine(text, original, products) {
    var tokens = text.split(' ').filter(Boolean);
    if (!tokens.length) return { type: 'unknown', text: original };

    var qty = null;
    var unit = null;
    var price = null;
    var consumed = {};

    // ۱) قیمت صریح: «به قیمت ...» / «هرکدام ...» / «... تومان»
    var priceMatch = text.match(/(?:به قیمت|قیمت|هرکدام|هر کدام|دونه ای|دانه ای)\s+([^|]+)/);
    if (priceMatch) {
      var pnum = extractNumber(normalize(priceMatch[1]));
      if (pnum) {
        price = applyMoneyScale(pnum.value, priceMatch[1]);
        text = text.split(priceMatch[0]).join(' ').replace(/\s+/g, ' ').trim();
        tokens = text.split(' ').filter(Boolean);
      }
    } else if (/تومان|تومن|ریال/.test(text)) {
      // عدد چسبیده به واحد پول
      var moneyIdx = -1;
      for (var mi = 0; mi < tokens.length; mi++) {
        if (/^(تومان|تومن|ریال)$/.test(tokens[mi])) {
          moneyIdx = mi;
          break;
        }
      }
      if (moneyIdx > 0) {
        // عدد را از عقب به جلو بخوان
        var startIdx = moneyIdx - 1;
        while (startIdx > 0 && (isNumberWord(tokens[startIdx - 1]) || tokens[startIdx - 1] === 'و')) startIdx--;
        var mp = parseNumberTokens(tokens, startIdx);
        if (mp) {
          price = mp.value;
          for (var mj = startIdx; mj <= moneyIdx; mj++) consumed[mj] = true;
        }
      }
    }

    // ۲) تعداد در ابتدای عبارت (رایج‌ترین حالت فارسی: «دو تا قهوه»)
    var numAt = -1;
    for (var i = 0; i < tokens.length; i++) {
      if (consumed[i]) continue;
      if (isNumberWord(tokens[i])) {
        numAt = i;
        break;
      }
    }

    if (numAt >= 0) {
      var parsed = parseNumberTokens(tokens, numAt);
      if (parsed) {
        qty = parsed.value;
        for (var c = numAt; c < numAt + parsed.length; c++) consumed[c] = true;

        // واحد بلافاصله بعد از عدد
        var after = numAt + parsed.length;
        if (after < tokens.length && UNIT_LOOKUP[tokens[after]]) {
          var u = UNIT_LOOKUP[tokens[after]];
          unit = u.unit;
          qty = qty * u.factor;
          consumed[after] = true;
        }
      }
    }

    // ۳) واحد پیش از عدد: «نیم کیلو برنج» را حالت بالا پوشش می‌دهد،
    //    اما «کیلویی دو تا» را اینجا می‌گیریم
    if (unit === null) {
      for (var ui = 0; ui < tokens.length; ui++) {
        if (consumed[ui]) continue;
        if (UNIT_LOOKUP[tokens[ui]]) {
          unit = UNIT_LOOKUP[tokens[ui]].unit;
          if (qty !== null) qty *= UNIT_LOOKUP[tokens[ui]].factor;
          consumed[ui] = true;
          break;
        }
      }
    }

    // ۴) باقی توکن‌ها = نام محصول
    var nameTokens = [];
    for (var n = 0; n < tokens.length; n++) {
      if (consumed[n]) continue;
      if (STOPWORDS[tokens[n]]) continue;
      nameTokens.push(tokens[n]);
    }
    var name = nameTokens.join(' ').trim();

    if (!name) {
      return { type: 'unknown', text: original, qty: qty };
    }

    var match = matchProduct(name, products);
    var threshold = 0.58;

    if (match && match.score >= threshold) {
      return {
        type: 'add',
        product: match.product,
        matchedOn: match.matched,
        score: match.score,
        qty: qty === null ? 1 : qty,
        unit: unit || match.product.unit || 'عدد',
        price: price,
        text: original,
      };
    }

    // محصول شناخته نشد — پیشنهاد نزدیک‌ترین گزینه‌ها
    var suggestions = [];
    if (products && products.length) {
      suggestions = products
        .map(function (p) {
          var m = matchProduct(name, [p]);
          return { product: p, score: m ? m.score : 0 };
        })
        .filter(function (s) {
          return s.score >= 0.35;
        })
        .sort(function (x, y) {
          return y.score - x.score;
        })
        .slice(0, 3);
    }

    return {
      type: 'add-unknown',
      name: name,
      qty: qty === null ? 1 : qty,
      unit: unit || 'عدد',
      price: price,
      suggestions: suggestions,
      text: original,
    };
  }

  /** «پنجاه هزار تومان» → 50000 ؛ «۵۰ هزار» → 50000 */
  function applyMoneyScale(value, raw) {
    var t = normalize(raw);
    if (/میلیارد|ملیارد/.test(t) && value < 1000000000) return value;
    if (/میلیون|ملیون/.test(t) && value < 1000000) return value;
    return value;
  }

  /**
   * اصلاح خطاهای رایج تشخیص گفتار فارسی و شکل‌های چسبیده.
   * توجه: \b در جاوااسکریپت روی حروف فارسی کار نمی‌کند، پس مرز کلمه
   * را دستی با (^|\s) و (?=\s|$) می‌سازیم.
   */
  var SPEECH_FIXES = {
    'دوتا': 'دو تا', 'سهتا': 'سه تا', 'چهارتا': 'چهار تا', 'چارتا': 'چهار تا',
    'پنجتا': 'پنج تا', 'ششتا': 'شش تا', 'شیشتا': 'شش تا', 'هفتتا': 'هفت تا',
    'هشتتا': 'هشت تا', 'نهتا': 'نه تا', 'دهتا': 'ده تا', 'چندتا': 'چند تا',
    'یکی': 'یک', 'یدونه': 'یک', 'یهدونه': 'یک', 'یدانه': 'یک',
    'نیمکیلو': 'نیم کیلو', 'کیلوی': 'کیلو', 'نیمکیلویی': 'نیم کیلو',
    'میخوام': 'میخوام', 'میخام': 'میخوام', 'میشه': 'میشه',
    'اضافهکن': 'اضافه کن', 'حذفکن': 'حذف کن', 'پاککن': 'پاک کن',
    'ثبتکن': 'ثبت کن', 'تومن': 'تومان', 'تومنی': 'تومان',
    'درسد': 'درصد', 'دررصد': 'درصد', 'مالیاط': 'مالیات',
    'تخفیغ': 'تخفیف', 'فاکتر': 'فاکتور', 'فاکطور': 'فاکتور',
  };

  var SPEECH_FIX_RE = [];
  Object.keys(SPEECH_FIXES).forEach(function (from) {
    SPEECH_FIX_RE.push({
      re: new RegExp('(^|\\s)' + normalize(from) + '(?=\\s|$)', 'g'),
      to: '$1' + SPEECH_FIXES[from],
    });
  });

  function fixSpeechArtifacts(text) {
    var t = ' ' + text + ' ';
    SPEECH_FIX_RE.forEach(function (f) {
      t = t.replace(f.re, f.to);
    });
    // عدد چسبیده به واحد: «۲تا» ، «5کیلو»
    t = t.replace(/(\d)\s*(تا|عدد|کیلو|گرم|لیتر|بسته|جعبه|متر)(?=\s|$)/g, '$1 $2');
    return t.replace(/\s+/g, ' ').trim();
  }

  /**
   * ورودی اصلی موتور: یک جمله کامل → فهرست دستورها.
   * @param {string} transcript
   * @param {{products?:Array, customers?:Array}} [context]
   * @returns {Array<Object>}
   */
  function parse(transcript, context) {
    var text = normalize(transcript);
    if (!text) return [];

    text = fixSpeechArtifacts(text);

    var segments = splitSegments(text);
    var commands = [];
    segments.forEach(function (seg) {
      var cmd = parseSegment(seg, context || {});
      if (cmd && cmd.type !== 'unknown') commands.push(cmd);
      else if (cmd) commands.push(cmd);
    });
    return commands;
  }

  // =======================================================================
  // ۶) موتور تشخیص گفتار مرورگر
  // =======================================================================

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  var engine = {
    recognition: null,
    listening: false,
    stopping: false,
    lastStart: 0,
    restarts: 0,
  };

  var config = {
    lang: 'fa-IR',
    continuous: true,
    interim: true,
    maxAlternatives: 3,
    getProducts: function () {
      return [];
    },
    getCustomers: function () {
      return [];
    },
    onState: function () {},
    onTranscript: function () {},
    onCommands: function () {},
    onError: function () {},
  };

  function configure(options) {
    Object.keys(options || {}).forEach(function (k) {
      if (options[k] !== undefined) config[k] = options[k];
    });
  }

  function isSupported() {
    return !!SR;
  }

  function setState(state, detail) {
    try {
      config.onState(state, detail || {});
    } catch (e) {
      console.error(e);
    }
  }

  function buildRecognition() {
    var rec = new SR();
    rec.lang = config.lang;
    rec.continuous = config.continuous;
    rec.interimResults = config.interim;
    rec.maxAlternatives = config.maxAlternatives;

    rec.onstart = function () {
      engine.listening = true;
      engine.lastStart = Date.now();
      setState('listening');
    };

    rec.onaudiostart = function () {
      setState('listening');
    };

    rec.onspeechstart = function () {
      setState('speaking');
    };

    rec.onresult = function (event) {
      var interim = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        var result = event.results[i];
        if (result.isFinal) {
          var context = {
            products: config.getProducts() || [],
            customers: config.getCustomers() || [],
          };

          // میان چند گزینه، آن را انتخاب می‌کنیم که بهترین تطبیق محصول را بدهد
          var bestText = result[0].transcript;
          var bestScore = -1;
          for (var alt = 0; alt < result.length && alt < config.maxAlternatives; alt++) {
            var candidate = result[alt].transcript;
            var cmds = parse(candidate, context);
            var score = scoreCommands(cmds) + (alt === 0 ? 0.05 : 0);
            if (score > bestScore) {
              bestScore = score;
              bestText = candidate;
            }
          }

          var commands = parse(bestText, context);
          try {
            config.onTranscript(bestText, true);
            config.onCommands(commands, bestText);
          } catch (e) {
            console.error(e);
          }
        } else {
          interim += result[0].transcript;
        }
      }
      if (interim) {
        try {
          config.onTranscript(interim, false);
        } catch (e) {}
      }
    };

    rec.onerror = function (event) {
      var code = event.error;
      var message = errorMessage(code);
      if (code === 'no-speech' || code === 'aborted') {
        // خطای بی‌ضرر — بی‌صدا رد می‌شود
        setState(engine.listening ? 'listening' : 'idle', { soft: true, code: code });
        return;
      }
      engine.listening = false;
      setState('error', { code: code, message: message });
      try {
        config.onError(code, message);
      } catch (e) {}
    };

    rec.onend = function () {
      var wasListening = engine.listening;
      engine.listening = false;

      if (!engine.stopping && wasListening) {
        // مرورگرها پس از چند ثانیه سکوت خودشان قطع می‌کنند؛ دوباره وصل می‌شویم
        var elapsed = Date.now() - engine.lastStart;
        if (engine.restarts < 40) {
          engine.restarts++;
          window.setTimeout(function () {
            if (engine.stopping) return;
            try {
              rec.start();
              engine.listening = true;
            } catch (e) {
              setState('idle');
            }
          }, elapsed < 500 ? 400 : 120);
          return;
        }
      }
      engine.stopping = false;
      setState('idle');
    };

    return rec;
  }

  /** امتیاز کلی مجموعه دستورها — برای انتخاب بهترین گزینه تشخیص. */
  function scoreCommands(commands) {
    if (!commands || !commands.length) return 0;
    var total = 0;
    commands.forEach(function (c) {
      if (c.type === 'add') total += 1 + (c.score || 0);
      else if (c.type === 'add-unknown') total += 0.2;
      else if (c.type === 'unknown') total += 0;
      else total += 0.9;
    });
    return total / commands.length;
  }

  function errorMessage(code) {
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        return 'دسترسی به میکروفن داده نشد. از تنظیمات مرورگر اجازه دهید.';
      case 'audio-capture':
        return 'میکروفنی پیدا نشد. اتصال میکروفن را بررسی کنید.';
      case 'network':
        return 'تشخیص گفتار به اینترنت نیاز دارد و ارتباط برقرار نشد.';
      case 'no-speech':
        return 'صدایی شنیده نشد. دوباره تلاش کنید.';
      case 'language-not-supported':
        return 'مرورگر شما زبان فارسی را برای تشخیص گفتار پشتیبانی نمی‌کند.';
      default:
        return 'خطای ناشناخته در تشخیص گفتار.';
    }
  }

  function start() {
    if (!isSupported()) {
      setState('unsupported');
      return false;
    }
    if (engine.listening) return true;
    engine.stopping = false;
    engine.restarts = 0;
    if (!engine.recognition) engine.recognition = buildRecognition();
    else {
      engine.recognition.lang = config.lang;
      engine.recognition.continuous = config.continuous;
      engine.recognition.interimResults = config.interim;
    }
    try {
      engine.recognition.start();
      setState('starting');
      return true;
    } catch (e) {
      // اگر از قبل در حال اجرا باشد مرورگر خطا می‌دهد
      if (String(e && e.name) === 'InvalidStateError') {
        engine.listening = true;
        return true;
      }
      setState('error', { message: 'شروع تشخیص گفتار ممکن نشد.' });
      return false;
    }
  }

  function stop() {
    engine.stopping = true;
    if (engine.recognition) {
      try {
        engine.recognition.stop();
      } catch (e) {}
    }
    engine.listening = false;
    setState('idle');
  }

  function toggle() {
    if (engine.listening) {
      stop();
      return false;
    }
    return start();
  }

  // -------------------------------------------------------- خروجی صوتی (TTS)
  /** پاسخ کوتاه صوتی به کاربر (اختیاری). */
  function speak(text, options) {
    if (!window.speechSynthesis || !text) return false;
    try {
      var u = new SpeechSynthesisUtterance(String(text));
      u.lang = (options && options.lang) || 'fa-IR';
      u.rate = (options && options.rate) || 1;
      u.volume = (options && options.volume) === undefined ? 1 : options.volume;
      var voices = window.speechSynthesis.getVoices() || [];
      for (var i = 0; i < voices.length; i++) {
        if (/fa|persian/i.test(voices[i].lang || '') || /fa/i.test(voices[i].name || '')) {
          u.voice = voices[i];
          break;
        }
      }
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) {
      return false;
    }
  }

  // =======================================================================
  // خروجی
  // =======================================================================
  window.FactorinoVoice = {
    // موتور زبان (قابل استفاده بدون میکروفن — مثلاً برای ورودی متنی)
    parse: parse,
    parseSegment: parseSegment,
    matchProduct: matchProduct,
    matchCustomer: matchCustomer,
    normalize: normalize,
    nameKey: nameKey,
    toLatinDigits: toLatinDigits,
    // نکته: مثل parse() ابتدا اصلاح خطاهای رایج تشخیص گفتار انجام می‌شود تا
    // شکل‌های چسبیده («دوتا»، «۴تا»، «یدونه») هم درست خوانده شوند.
    parseNumber: function (text) {
      var r = extractNumber(fixSpeechArtifacts(normalize(text)));
      return r ? r.value : null;
    },
    similarity: similarity,

    // موتور گفتار
    configure: configure,
    isSupported: isSupported,
    start: start,
    stop: stop,
    toggle: toggle,
    speak: speak,
    isListening: function () {
      return engine.listening;
    },
  };
})();
