# Test Credentials — sexgram

سه کاربر seed موجود است:

| Username  | Password      | Display name |
|-----------|---------------|--------------|
| `alice`   | `password123` | Alice        |
| `bob`     | `password123` | Bob          |
| `charlie` | `password123` | Charlie      |

**Auth flow**: JWT bearer از `POST /api/auth/login`
```
curl -X POST $API_URL/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"alice","password":"password123"}'
```
توکن از فیلد `access_token` در پاسخ خوانده می‌شود و در `localStorage["auth_token"]` ذخیره می‌گردد، سپس روی هر درخواست به‌صورت `Authorization: Bearer <token>` ارسال می‌شود.
