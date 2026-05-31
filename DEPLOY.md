# Deploying Lamagram on your own Linux server

> Self-host the full stack (FastAPI + MongoDB + React + nginx) with HTTPS on
> your own domain in ~10 minutes.

📦 **Repo**: <https://github.com/yasnewdota2-dot/lamagram>

---

## English Guide

### Prerequisites
- Ubuntu 22.04+ (Debian 12 also works) with **≥ 2 GB RAM, 2 vCPU, 20 GB disk**.
- A domain (e.g. `lamagram.example.com`) with an **A-record** pointing to the server's public IP.
- Firewall lets in **80 / tcp** and **443 / tcp** (`ufw allow 80,443/tcp`).

### Step 1 — Install Docker + Compose plugin
```bash
curl -fsSL https://get.docker.com | sh
sudo apt install -y docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker     # so you can run docker without sudo
```

### Step 2 — Clone the repo
```bash
git clone https://github.com/yasnewdota2-dot/lamagram.git
cd lamagram
```

### Step 3 — Configure environment
```bash
cp .env.example .env
nano .env
```
Fill in:
- `DOMAIN=your-domain.com`
- `LETSENCRYPT_EMAIL=you@your-domain.com`
- `JWT_SECRET=$(openssl rand -hex 32)` — paste the generated hex
- `CORS_ORIGINS=https://your-domain.com`
- `REACT_APP_BACKEND_URL=https://your-domain.com`

Then update `nginx/conf.d/default.conf` and replace **every** `your-domain.com`
with your real domain (3 occurrences):
```bash
sed -i "s/your-domain.com/$(grep ^DOMAIN= .env | cut -d= -f2)/g" nginx/conf.d/default.conf
```

### Step 4 — Issue a Let's Encrypt certificate (standalone, one-shot)
Make sure nothing else is bound to port 80 (`sudo lsof -i :80` should be empty).
```bash
sudo apt install -y certbot
sudo certbot certonly --standalone \
     -d your-domain.com \
     -m you@your-domain.com \
     --agree-tos -n
```
Certificates land in `/etc/letsencrypt/live/your-domain.com/` and are
bind-mounted into the nginx container automatically.

### Step 5 — Build and start
```bash
docker compose up -d --build
docker compose logs -f
```
Open <https://your-domain.com> in your browser. Sign up your first account.

### Step 6 — Auto-renew the cert
Let's Encrypt certs are valid for 90 days. Add a cron job:
```bash
( sudo crontab -l 2>/dev/null; \
  echo "0 3 * * * certbot renew --quiet && cd $(pwd) && docker compose restart nginx" ) \
  | sudo crontab -
```

### Day-to-day operations
| Action | Command |
|---|---|
| Pull updates and rebuild | `git pull && docker compose up -d --build` |
| Tail backend logs | `docker compose logs -f backend` |
| Tail all logs | `docker compose logs -f` |
| Restart one service | `docker compose restart backend` |
| Stop everything (keep data) | `docker compose down` |
| **DANGER**: wipe DB + volumes | `docker compose down -v` |
| Backup Mongo to host | `docker compose exec mongo mongodump --out /data/db/backup_$(date +%F) && docker cp lamagram-mongo:/data/db/backup_$(date +%F) ./backup_$(date +%F)` |

### Troubleshooting
- **WebSocket fails** → check `nginx/conf.d/default.conf` has the `Upgrade` /
  `Connection: upgrade` headers in `location /api/ws` (already shipped).
- **502 Bad Gateway** → `docker compose logs backend`; usually a missing
  `JWT_SECRET` in `.env`.
- **CORS errors in browser** → `CORS_ORIGINS` in `.env` must EXACTLY match your
  HTTPS URL (no trailing slash).
- **Uploads > 100 MB fail** → `client_max_body_size` is set to `150M`; raise
  it in the nginx config and `docker compose restart nginx`.
- **Frontend shows old URL** → CRA bakes `REACT_APP_BACKEND_URL` at build time.
  Rebuild with `docker compose up -d --build frontend`.

---

## راهنما (فارسی)

### پیش‌نیازها
- یک سرور لینوکس Ubuntu 22.04 یا جدیدتر با حداقل **۲ گیگ رم، ۲ هسته و ۲۰ گیگ
  دیسک**.
- یک دامنه که A-record آن به IP سرور اشاره می‌کند.
- پورت‌های **۸۰** و **۴۴۳** در فایروال باز باشند.

### مرحله ۱ — نصب Docker
```bash
curl -fsSL https://get.docker.com | sh
sudo apt install -y docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker
```

### مرحله ۲ — کلون کردن مخزن
```bash
git clone https://github.com/yasnewdota2-dot/lamagram.git
cd lamagram
```

### مرحله ۳ — تنظیم متغیرها
```bash
cp .env.example .env
nano .env
```
پر کنید:
- `DOMAIN`: نام دامنه شما
- `JWT_SECRET`: با `openssl rand -hex 32` بسازید
- `CORS_ORIGINS` و `REACT_APP_BACKEND_URL`: همان `https://your-domain.com`

سپس در `nginx/conf.d/default.conf` همهٔ `your-domain.com` ها را با دامنهٔ
واقعی جایگزین کنید:
```bash
sed -i "s/your-domain.com/$(grep ^DOMAIN= .env | cut -d= -f2)/g" nginx/conf.d/default.conf
```

### مرحله ۴ — گرفتن گواهی SSL از Let's Encrypt
```bash
sudo apt install -y certbot
sudo certbot certonly --standalone \
     -d your-domain.com \
     -m you@your-domain.com \
     --agree-tos -n
```

### مرحله ۵ — اجرا
```bash
docker compose up -d --build
docker compose logs -f
```
حالا `https://your-domain.com` در مرورگر باز کنید و اولین حساب کاربری
را بسازید.

### مرحله ۶ — تمدید خودکار گواهی
```bash
( sudo crontab -l 2>/dev/null; \
  echo "0 3 * * * certbot renew --quiet && cd $(pwd) && docker compose restart nginx" ) \
  | sudo crontab -
```

### عملیات روزمره
| کار | دستور |
|---|---|
| به‌روزرسانی + بازسازی | `git pull && docker compose up -d --build` |
| دیدن لاگ بک‌اند | `docker compose logs -f backend` |
| ری‌استارت یک سرویس | `docker compose restart backend` |
| توقف کامل (حفظ دیتا) | `docker compose down` |
| **خطر**: پاک کردن دیتابیس | `docker compose down -v` |

### رفع اشکال
- WebSocket کار نمی‌کند → بخش `location /api/ws` در فایل nginx را چک کنید.
- خطای 502 → `docker compose logs backend` ببینید (معمولاً `JWT_SECRET`
  در `.env` تنظیم نشده).
- خطای CORS → مقدار `CORS_ORIGINS` باید دقیقاً برابر آدرس HTTPS شما باشد.
- آپلود > ۱۰۰ مگ خطا می‌دهد → مقدار `client_max_body_size` در nginx را
  بزرگ‌تر کنید و nginx را ری‌استارت کنید.

---

## معماری

```
                 ┌──────────────┐
   Internet ───► │  nginx (443) │── TLS terminate
                 └──────┬───────┘
            ┌────────── │ ──────────┐
            ▼           ▼           ▼
       /api/ws      /api/...     /
            │           │           │
            ▼           ▼           ▼
   ┌────────────────────────┐  ┌────────────┐
   │  backend (FastAPI 8001)│  │  frontend  │
   └──────┬─────────────────┘  │  (nginx 80)│
          │ MONGO_URL          └────────────┘
          ▼
       ┌────────┐
       │  mongo │  (persistent volume `mongo_data`)
       └────────┘
```
