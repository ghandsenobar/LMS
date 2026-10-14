/* ============================================================
   Service Worker — سیستم مدیریت آزمایشگاه
   کارخانه قند صنوبر — علی صنوبری
   نسخه: 4.2.0
============================================================ */

var SW_VERSION = 'lab-v4.2.0.a1';
var STATIC_CACHE = SW_VERSION + '-static';
var RUNTIME_CACHE = SW_VERSION + '-runtime';

/* فایل‌های ثابت که همیشه کش می‌شن */
var STATIC_ASSETS = [
  './',
  './index.html',
  './syrup-calc.html',
  './admin.html',
  './converter.html',
  './EC-corrector.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

/* URLs که هرگز کش نمی‌شن (داده‌های زنده) */
var NEVER_CACHE = [
  'api.github.com',
  'github.com/login',
  'raw.githubusercontent.com'
];

/* ============================================================
   INSTALL — کش کردن فایل‌های ثابت
============================================================ */
self.addEventListener('install', function(event){
  console.log('[SW] Installing', SW_VERSION);
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache){
      return cache.addAll(STATIC_ASSETS.map(function(url){
        return new Request(url, { cache: 'reload' });
      })).catch(function(err){
        // اگه یکی از فایل‌ها نبود (مثلاً admin.html هنوز ساخته نشده)،
        // بقیه رو کش کن
        console.warn('[SW] Some assets failed to cache:', err);
        return Promise.all(STATIC_ASSETS.map(function(url){
          return caches.open(STATIC_CACHE).then(function(c){
            return fetch(url).then(function(res){
              if(res.ok) return c.put(url, res);
            }).catch(function(){ /* نادیده بگیر */ });
          });
        }));
      });
    }).then(function(){
      // فعال‌سازی فوری SW جدید
      return self.skipWaiting();
    })
  );
});

/* ============================================================
   ACTIVATE — پاک کردن کش‌های قدیمی
============================================================ */
self.addEventListener('activate', function(event){
  console.log('[SW] Activating', SW_VERSION);
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(key){
          // کش‌های قدیمی رو پاک کن (به جز نسخه فعلی)
          return key.indexOf('lab-') === 0 && key.indexOf(SW_VERSION) !== 0;
        }).map(function(key){
          console.log('[SW] Deleting old cache:', key);
          return caches.delete(key);
        })
      );
    }).then(function(){
      // کنترل فوری همه تب‌ها
      return self.clients.claim();
    })
  );
});

/* ============================================================
   FETCH — استراتژی بر اساس نوع درخواست
============================================================ */
self.addEventListener('fetch', function(event){
  var req = event.request;
  var url = new URL(req.url);

  /* ۱. فقط GET رو کش کن */
  if(req.method !== 'GET') return;

  /* ۲. GitHub API و محتواها — هیچ‌وقت کش نکن */
  var neverCache = NEVER_CACHE.some(function(host){
    return url.hostname.indexOf(host) >= 0;
  });
  if(neverCache){
    // Network only
    return;
  }

  /* ۳. فایل‌های ثابت (same-origin) — Cache First */
  var isSameOrigin = (url.origin === location.origin);
  var isStaticAsset = /\.(html|css|js|json|png|jpg|jpeg|svg|ico|woff|woff2|ttf)$/i.test(url.pathname);

  if(isSameOrigin && isStaticAsset){
    event.respondWith(
      caches.match(req).then(function(cached){
        if(cached){
          // همزمان نسخه جدید رو از سرور بگیر و آپدیت کن
          fetch(req).then(function(res){
            if(res && res.ok){
              caches.open(STATIC_CACHE).then(function(cache){
                cache.put(req, res.clone());
              });
            }
          }).catch(function(){ /* آفلاین — کاری نکن */ });
          return cached;
        }
        // توی کش نبود → از شبکه بگیر و کش کن
        return fetch(req).then(function(res){
          if(res && res.ok && isSameOrigin){
            var clone = res.clone();
            caches.open(STATIC_CACHE).then(function(cache){
              cache.put(req, clone);
            });
          }
          return res;
        }).catch(function(err){
          // آفلاین و توی کش نیست → صفحه آفلاین
          console.warn('[SW] Offline, no cache for:', req.url);
          // اگه درخواست HTML بود، index.html کش‌شده رو بده
          if(req.headers.get('accept') && req.headers.get('accept').indexOf('text/html') >= 0){
            return caches.match('./index.html');
          }
          throw err;
        });
      })
    );
    return;
  }

  /* ۴. بقیه درخواست‌ها (external images, fonts, ...) — Network First */
  event.respondWith(
    fetch(req).then(function(res){
      if(res && res.ok){
        var clone = res.clone();
        caches.open(RUNTIME_CACHE).then(function(cache){
          cache.put(req, clone);
        });
      }
      return res;
    }).catch(function(){
      return caches.match(req);
    })
  );
});

/* ============================================================
   MESSAGE — دریافت پیام از صفحات
============================================================ */
self.addEventListener('message', function(event){
  if(!event.data) return;
  if(event.data.type === 'SKIP_WAITING'){
    self.skipWaiting();
  }
  if(event.data.type === 'CLEAR_CACHE'){
    event.waitUntil(
      caches.keys().then(function(keys){
        return Promise.all(keys.map(function(k){ return caches.delete(k); }));
      }).then(function(){
        return self.clients.matchAll().then(function(clients){
          clients.forEach(function(client){
            client.postMessage({ type: 'CACHE_CLEARED' });
          });
        });
      })
    );
  }
  if(event.data.type === 'GET_VERSION'){
    event.waitUntil(
      self.clients.matchAll().then(function(clients){
        clients.forEach(function(client){
          client.postMessage({ type: 'VERSION', version: SW_VERSION });
        });
      })
    );
  }
});

/* ============================================================
   SYNC — به‌روزرسانی در پس‌زمینه (اختیاری)
============================================================ */
self.addEventListener('sync', function(event){
  if(event.tag === 'lab-sync'){
    console.log('[SW] Background sync triggered');
    // در آینده: می‌تونه داده‌ها رو به GitHub بفرسته
  }
});

/* ============================================================
   PUSH — اعلان‌های پوش (اختیاری، فعلاً غیرفعال)
============================================================ */
self.addEventListener('push', function(event){
  if(!event.data) return;
  var data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'سیستم آزمایشگاه', {
      body: data.body || '',
      icon: './icon-192.png',
      badge: './icon-192.png',
      dir: 'rtl',
      lang: 'fa'
    })
  );
});

console.log('[SW] Loaded', SW_VERSION);
