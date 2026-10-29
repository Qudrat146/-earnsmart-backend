# EarnSmart Backend Starter (Pashto guide)

دا پروژه د EarnSmart لپاره د Node.js + Express API بنسټ دی. دا د حسابونو ثبت/ننوتل، points، ورځنی bonus، activity او د withdrawal د غوښتنو ثبت ملاتړ کوي.

## مهم
**دا نسخه حقیقي پیسې نه لېږي.** د withdrawal غوښتنې `pending` حالت کې ساتي او points تر بیاکتنې پورې reserve کوي. د حقیقي پیسو لپاره باید د قانوني payment provider سوداګریز حساب/API، د server-side تایید، د admin approval پروسه، fraud checks، او د هر provider د شرایطو رعایت اضافه شي. په HTML کې هېڅکله API secret مه ږدئ.

## په کمپیوټر یا Node.js hosting کې
1. Node.js 20 یا نوې نسخه نصب کړئ.
2. دا فولډر خلاص کړئ او `npm install` وچلوئ.
3. `.env.example` کاپي او د `.env` په نوم یې وساتئ.
4. په `.env` کې `JWT_SECRET` ته یو اوږد تصادفي راز ولیکئ (لږ تر لږه 32 توري). دا راز له چا سره مه شریکوئ.
5. `CORS_ORIGIN` ته د خپل ویب‌سایټ دقیق origin ورکړئ، لکه `https://your-site.example`.
6. `npm start` وچلوئ.
7. `GET /api/health` باید JSON ځواب ورکړي.

## API routes
- `POST /api/auth/register` body: `{"email":"you@example.com","password":"10+ characters"}`
- `POST /api/auth/login` body: `{"email":"you@example.com","password":"..."}`
- `GET /api/me` د `Authorization: Bearer TOKEN` سره
- `POST /api/daily-bonus` د Bearer token سره
- `GET /api/activity` د Bearer token سره
- `POST /api/withdrawals` د Bearer token سره، body: `{"method":"JazzCash","account":"...","points":5000}`
- `GET /api/withdrawals` د Bearer token سره
- `GET /api/health` health check

## Hosting یادښت
د host له لارې د SQLite فایل دوامداره ساتنه تایید کړئ؛ که disk ephemeral وي، د restart/deploy پر مهال معلومات له منځه تللی شي. د production لپاره managed database، backups، HTTPS، logging/monitoring، admin review، او د privacy policy/terms اړتیاوې وارزوئ.

## د اوسني HTML سره
موجود HTML یوازې UI دی او د دې API سره بشپړ login/points sync نه لري. د حقیقي کارونې مخکې باید frontend د register/login token خوندي مدیریت او د API له لارې points لوستل/بدلول وکړي. د browser localStorage points د حقیقي عاید لپاره د باور وړ نه دي.
