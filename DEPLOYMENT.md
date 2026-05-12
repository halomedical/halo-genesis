# Deploying HALO Client App to a .halo.africa URL

This guide walks you through putting the HALO web app on a public URL (e.g. `https://app.halo.africa`) so you can use it from your phone and other devices.

---

## Overview

- **Stack**: Node.js server serves both the API and the built React frontend in production.
- **Single URL**: Use one base URL (e.g. `https://app.halo.africa`) for both the site and the API — no need for a separate API subdomain unless you want one.
- **HTTPS**: Required for Google OAuth and secure cookies. Use a reverse proxy (e.g. Caddy or nginx) with a TLS certificate.

---

## 1. Choose a hostname and hosting

1. **Pick a subdomain**, e.g. `app.halo.africa` or `halo-app.halo.africa`.
2. **Choose where to run the app**:
   - **Option A – Your own server (VPS/VM)**  
     You’ll need: Node.js 18+, a process manager (e.g. systemd or PM2), and a reverse proxy with HTTPS (Caddy or nginx).  
     Steps below focus on this option.
   - **Option B – PaaS (e.g. Railway, Render, Fly.io)**  
     They provide HTTPS and often a subdomain; you point your .halo.africa domain to their URL via a CNAME.  
     Configure env vars in their dashboard and set the same values described below.

---

## 2. Prepare the app for production

### 2.1 Build

On your machine or CI:

```bash
cd /path/to/HALO-Client-App-v1-Jonty
npm ci
npm run build
```

This compiles the server to `dist/` and the client to `client/dist/`. The server will serve the client from `client/dist` when `NODE_ENV=production`.

### 2.2 Environment variables

Create a `.env` on the **server** (or set these in your host’s env / dashboard). Use your real production URL and secrets.

```bash
# --- Server ---
PORT=3000
NODE_ENV=production

# --- Session (use a strong random secret) ---
SESSION_SECRET=<run: openssl rand -hex 32>

# --- Google OAuth ---
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>

# --- AI ---
GEMINI_API_KEY=<your-key>
# Optional: DEEPGRAM_API_KEY=

# --- URLs (same base URL for app + API) ---
CLIENT_URL=https://app.halo.africa
PRODUCTION_URL=https://app.halo.africa
```

Replace `app.halo.africa` with your chosen hostname.

**Optional (only if you serve API on a different host):**  
If the browser talks to e.g. `https://api.halo.africa`, set in the **client** build:

- `VITE_API_URL=https://api.halo.africa`  
  (and then `CLIENT_URL` / `PRODUCTION_URL` would be the frontend URL).

For a single URL, leave `VITE_API_URL` unset.

---

## 3. Google OAuth (required for production)

Google must allow your production URL for redirects and (optionally) JavaScript origins.

1. Open [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials**.
2. Edit your **OAuth 2.0 Client ID** (Web application).
3. Under **Authorized JavaScript origins** add:
   - `https://app.halo.africa`  
   (use your real hostname.)
4. Under **Authorized redirect URIs** add:
   - `https://app.halo.africa/api/auth/callback`  
   (again, replace with your hostname.)
5. Save.

Without these, login will fail on the production domain.

---

## 4. DNS for .halo.africa

Point your chosen subdomain to the machine that will run the app:

- **If the app runs on your own server**: Create an **A** record for `app.halo.africa` (or your subdomain) to that server’s public IP.
- **If you use a PaaS**: They usually give you a hostname (e.g. `yourapp.up.railway.app`). Create a **CNAME** for `app.halo.africa` → that hostname.

Wait for DNS to propagate (often 5–15 minutes, sometimes longer).

---

## 5. Run the app on the server (Option A: VPS/VM)

### 5.1 Install Node.js

e.g. on Ubuntu:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 5.2 Copy the app and env

- Copy the whole project (including `dist/` and `client/dist/` after `npm run build`) to the server, or clone the repo and run `npm ci && npm run build` on the server.
- Put the production `.env` in the project root (same place as `package.json`).  
  Do **not** commit `.env` to git.

### 5.3 Run with PM2 (recommended)

```bash
sudo npm install -g pm2
cd /path/to/HALO-Client-App-v1-Jonty
pm2 start dist/server/index.js --name halo-app
pm2 save
pm2 startup   # follow the command it prints so the app starts on reboot
```

The app listens on `PORT` (e.g. 3000). Next, the reverse proxy will send external HTTPS traffic to this port.

### 5.4 Reverse proxy and HTTPS (Caddy)

Caddy gets a certificate automatically for your domain.

1. Install Caddy (see [caddyserver.com](https://caddyserver.com/docs/install)).
2. Create a Caddyfile (e.g. `/etc/caddy/Caddyfile`):

```txt
app.halo.africa {
    reverse_proxy localhost:3000
}
```

Replace `app.halo.africa` with your hostname. If the app runs on another port, change `3000` to match `PORT` in `.env`.

3. Reload Caddy:

```bash
sudo systemctl reload caddy
```

Caddy will obtain and renew a TLS certificate for `app.halo.africa`. Ensure ports 80 and 443 are open on the server/firewall.

### 5.5 Alternative: nginx

If you prefer nginx, use it as a reverse proxy and get a certificate with Certbot (Let’s Encrypt). Example server block:

```nginx
server {
    listen 443 ssl http2;
    server_name app.halo.africa;
    # ssl_certificate and ssl_certificate_key from certbot

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

The `Upgrade` and `Connection` headers are needed for the WebSocket used by live transcription (`/ws/transcribe`).

---

## 6. PaaS (Option B) – high level

If you use Railway, Render, Fly.io, etc.:

1. Connect the repo or upload the built app.
2. Set **build command**: `npm ci && npm run build`.
3. Set **start command**: `npm start` (runs `node dist/server/index.js`).
4. Set all env vars from section 2.2 in the dashboard (and any extra the platform needs).
5. Set your custom domain to `app.halo.africa` in the platform’s settings and add the CNAME (or A) record as in section 4.
6. Ensure the platform uses HTTPS for your custom domain (they usually do).

---

## 7. Verify

1. Open `https://app.halo.africa` in a browser (and on your phone).
2. Check health: `https://app.halo.africa/api/health` should return `{"status":"ok",...}`.
3. Log in with Google — you should be redirected to Google and back to the app.
4. If something fails, check server logs (e.g. `pm2 logs halo-app`) and the browser devtools (Console / Network).

---

## 8. Checklist

- [ ] Chosen hostname (e.g. `app.halo.africa`)
- [ ] `npm run build` succeeds
- [ ] Production `.env` with `NODE_ENV=production`, `CLIENT_URL`, `PRODUCTION_URL`, `SESSION_SECRET`, Google and Gemini keys
- [ ] Google OAuth: authorized origins and redirect URI for `https://<your-host>/api/auth/callback`
- [ ] DNS: A or CNAME for your hostname → server or PaaS
- [ ] App running on the server (e.g. PM2) or started by PaaS
- [ ] Reverse proxy (Caddy/nginx) with HTTPS, proxying to the Node port
- [ ] `https://<your-host>/api/health` returns OK and login works from desktop and phone

---

## Troubleshooting

- **“Redirect URI mismatch”**: The URL in Google Console must exactly match what the app uses (including `https` and no trailing slash for the callback path).
- **CORS errors**: Ensure `CLIENT_URL` in `.env` is exactly `https://app.halo.africa` (no trailing slash).
- **WebSocket fails**: Ensure the reverse proxy forwards `Upgrade` and `Connection` for `/ws/transcribe`.
- **Session / login not persisting**: Ensure `SESSION_SECRET` is set and that you’re using HTTPS (secure cookies require it).

Once this is done, the app is available on your .halo.africa URL and usable from your phone.
