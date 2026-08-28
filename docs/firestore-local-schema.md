# סכמת Firestore המקומית של נתיב

הסכמה מיועדת בשלב זה ל-Firestore Emulator בלבד. לא נוצר פרויקט ענן, לא
הוגדרו הרשאות אמת ולא חוברה ספריית המשתמשים של EdTrack.

## מבנה המסמכים

```text
organizations/{organizationId}
├── nativCycles/{cycleId}
├── nativSubmissions/{submissionId}
├── nativAuditEvents/{auditEventId}
└── nativIdempotency/{idempotencyKey}
```

- כל מסמך תחום כולל גם `organizationId`, כדי לאפשר אימות עקביות בתוך שכבת
  היישום ולא להסתמך רק על הנתיב.
- טיוטות והגשות נשמרות באותה collection אך במסמכים שונים. `status` מבדיל
  ביניהן והגשה אינה מוחקת או משנה את הטיוטה שממנה נוצרה.
- אירועי ביקורת ומפתחות idempotency נוצרים בלבד ואינם מתעדכנים.
- מזהי מסמכים עוברים קידוד בטוח למקטע נתיב. שמות, דוא"ל ופרטי תלמיד אינם
  משמשים כמפתחות מסמך.

## גבול האבטחה

- `firestore.rules` חוסם כל קריאה וכתיבה ישירות מ-Web SDK, גם עבור משתמש
  מזוהה עם claims.
- `FirestoreNativRepository` משתמש ב-Admin SDK ונועד לפעולות שרת בלבד.
- Admin SDK עוקף Rules; לכן `NativCommandService` ממשיך לבדוק ארגון,
  capability, בעלות תלמיד, גרסה צפויה ו-idempotency לפני כל פעולה.
- סביבת ייצור תדרוש בנוסף IAM מצומצם לחשבון השירות, App Check לפעולות
  המתאימות, אימות claims וחוזה זהות מאושר מול EdTrack.

## אטומיות ושאילתות

- שינוי הישות, אירוע הביקורת ורשומת ה-idempotency נכתבים באותה טרנזקציה.
- קריאה לצורך החלטה מתבצעת לפני כל כתיבה, בהתאם למגבלת Firestore.
- נעשה שימוש בגרסה אופטימית כדי למנוע דריסה של שינוי מקביל.
- אינדקס משולב של `cycleId` ו-`updatedAt` תומך ברשימת הגשות לפי מחזור.

## בדיקה מקומית

```powershell
pnpm test:emulator
```

הפקודה משתמשת במזהה `demo-nativ-local`. Firebase CLI מונע גישה לשירותים
שאינם מדומים כאשר משתמשים במזהה `demo-*`, ולכן הבדיקה אינה יכולה לגלוש
בטעות לפרויקט ייצור.
