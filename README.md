# متجر العطاء — نسخة الويب (iPhone) + تطبيق أندرويد (APK)

نسخة طبق الأصل من تطبيق **متجر العطاء** (نفس الشاشات والقوائم والأسماء والألوان والخطوط)،
وتتصل بنفس قاعدة بيانات Supabase، فكل المنتجات والحسابات والطلبات مشتركة مع النسخة الأصلية.

| المنصة | كيف تصل للمستخدم | كيف يصله التحديث |
|---|---|---|
| **الويب / iPhone** (PWA) | رابط Netlify ← «إضافة إلى الشاشة الرئيسية» | تلقائياً، بدون أي خطوة من المستخدم |
| **أندرويد** (APK) | ملف APK من صفحة Releases | يظهر داخل التطبيق «يتوفر تحديث جديد» ← زر «تحديث الآن» ← تحميل وتثبيت من داخل التطبيق |

## الإعداد (مرة واحدة فقط)

1. **المستودع**: أنشئ مستودعاً **عاماً (Public)** على GitHub، وادفع هذا المشروع إلى الفرع `main`.
2. **ربط Netlify بالمستودع** (ليتحدّث الموقع تلقائياً مع كل دفع): موقعك `alataa-store` منشور بالفعل. من Netlify: *Project configuration → Build & deploy → Continuous deployment → Link repository* واختر مستودع GitHub والفرع `main`. إعدادات البناء جاهزة في `netlify.toml` فلا تحتاج تغيير شيء.
3. **مفتاح توقيع الأندرويد** (يلزم ليقبل أندرويد التحديث فوق النسخة المثبّتة):
   *Settings → Secrets and variables → Actions → New repository secret*، وأضف سرّين:
   - `ANDROID_KEYSTORE_BASE64` ← محتوى الملف `alataa-release.jks.b64`
   - `ANDROID_KEYSTORE_PASSWORD` ← كلمة المرور
   > احتفظ بنسخة من ملف المفتاح وكلمته في مكان آمن. **إذا ضاع فلن تستطيع تحديث التطبيق المثبّت** (سيحتاج المستخدمون لحذفه وتثبيته من جديد).
   > لا ترفع الملف إلى المستودع أبداً.
4. شغّل أول مرة للأندرويد: *Actions → Release Android APK → Run workflow* .

بعدها:
- رابط الموقع: **https://alataa-store.netlify.app**
- ملف الـ APK: *Releases ← أحدث إصدار ← giving-store-vX.X.X.apk*

## كيف تحدّث التطبيق؟

كل دفع (push) إلى `main` يفعل التالي تلقائياً:

1. **الموقع/iPhone**: تبنيه Netlify وتنشره تلقائياً، وتصل النسخة الجديدة لكل من فتح التطبيق (Service Worker بتحديث تلقائي).
2. **أندرويد**: يُبنى APK موقّع برقم إصدار جديد `1.0.<رقم التشغيل>` وينشر كـ Release. التطبيق المثبّت يفحص آخر Release عند الفتح وعند العودة إليه،
   ويعرض نافذة «يتوفر تحديث جديد» مع ملاحظات التحديث (من رسائل الـ commits).

لرفع رقم الإصدار الرئيسي غيّر `version` في `package.json` (مثلاً `1.0.0` ← `1.1.0`).

## التثبيت

- **iPhone**: افتح رابط الموقع في **Safari** ← زر المشاركة ← **إضافة إلى الشاشة الرئيسية**.
- **أندرويد**: نزّل ملف APK من Releases وثبّته (يطلب السماح بالتثبيت من المتصفح مرة واحدة).
  أول مرة يضغط المستخدم «تحديث الآن» سيطلب أندرويد السماح للتطبيق بتثبيت التطبيقات، ثم يكمل تلقائياً.

## ملاحظات مهمة

- **Supabase**: عنوان `alataa-store.netlify.app` ليس بالضرورة ضمن *Authentication → URL Configuration → Redirect URLs*.
  إن كان تأكيد البريد مفعّلاً، أضف رابط الموقع هناك. (الدخول بالبريد وكلمة المرور يعمل بدونه.)
- مفتاح Supabase في `.env` هو المفتاح **العام (publishable)** المخصص للتطبيقات الأمامية، والحماية الفعلية عبر سياسات RLS في `supabase/migrations`.
- في أندرويد فتح واتساب يتم عبر Intent مباشر؛ وعلى الويب عبر `wa.me` (مع بديل إذا حجب المتصفح النافذة).

## التطوير محلياً

```bash
npm install
npm run dev          # الويب على http://localhost:8080
npm test             # اختبارات
npm run typecheck
npm run icons        # إعادة توليد الأيقونات وشاشة البداية من assets/logo-source.webp
npm run android:sync # بناء الويب ونسخه لمشروع الأندرويد
npm run android:open # فتح Android Studio
```

بناء APK محلياً (يحتاج JDK 21 وAndroid SDK 36):

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleRelease -PappVersionName=1.0.1 -PappVersionCode=1
```

للتوقيع محلياً عيّن المتغيرات `ANDROID_KEYSTORE_FILE` و`ANDROID_KEYSTORE_PASSWORD` قبل الأمر.
