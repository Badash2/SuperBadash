# 🛒 SuperBadash

קניות סופר חכמות לבית: מעקב מחירים ומבצעים יומי בסופרמרקטים בנתניה, זיהוי מבצעים מזויפים, ובהמשך רשימת קניות משפחתית וסורק ברקודים ליד הפח.

תוכנית מלאה והחלטות ארכיטקטורה: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## מצב נוכחי: שלב 1 עובד
- משיכת **PriceFull** ו-**PromoFull** מ-6 סניפים: רמי לוי, שופרסל דיל, שופרסל יוניברס, יוחננוף ×2 ואושר עד. בסך הכול כ-60 אלף מחירים וכ-9,000 מבצעים, בפחות מ-30 שניות.
- שמירת **שינויים בלבד** בהיסטוריית המחירים.
- **מנוע מבצעים** שמסווג כל מבצע לאחת מחמש פסיקות: ✅ אמיתי / 🎟 מותנה / ♾ קבוע / ➖ בינוני / ❌ מזויף (המחיר הועלה לפני המבצע).
- רץ אוטומטית 3 פעמים ביום ב-GitHub Actions.

## התקנה והרצה
```bash
pip install -e ".[postgres,dev]"
```
```bash
superbadash ingest
```
משיכת מחירים ומבצעים. ברירת המחדל היא SQLite ב-`data/`. אפשר להגדיר `DATABASE_URL` כדי לעבוד מול Postgres.
```bash
superbadash deals
```
מבצעים אמיתיים, מהחיסכון הגדול לקטן.
```bash
superbadash deals --verdict fake
```
מבצעים מזויפים.
```bash
superbadash compare "קוטג 5%"
```
השוואת מחיר מוצר בין הסניפים, לפי שם או ברקוד.
```bash
superbadash discover rami-levy --city 7400
```
חיפוש סניפים של רשת בעיר (7400 = נתניה).
```bash
superbadash status
```
מתי כל סניף עודכן לאחרונה.

## בדיקות
```bash
pytest
```
כדי להריץ את הבדיקות גם מול Postgres, צריך להגדיר `TEST_DATABASE_URL=postgresql://...`.

## הגדרת ריצה אוטומטית עם היסטוריה
1. פותחים פרויקט חינמי ב-[Supabase](https://supabase.com) ומעתיקים את ה-connection string (Session pooler).
2. ב-GitHub: **Settings → Secrets and variables → Actions → New secret**, בשם `DATABASE_URL`.
3. ה-workflow `ingest-prices` ירוץ אוטומטית. אפשר גם להריץ אותו ידנית מלשונית Actions.

## מבנה
```
config/stores.toml        הסניפים שעוקבים אחריהם
src/superbadash/
  sources.py              לקוחות HTTPS לשופרסל ול-publishedprices (Cerberus)
  parse.py                פענוח XML בזרימה (תומך ב-UTF-8/16 ובשני פורמטי מבצעים)
  db.py                   סכמה ושכבת נתונים (SQLite / Postgres)
  ingest.py               משיכה ושמירה, כולל רישום שינויי מחיר
  deals.py                מנוע ניתוח המבצעים
  cli.py                  שורת פקודה
tests/                    בדיקות עם fixtures בפורמט האמיתי
```
