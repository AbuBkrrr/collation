# Going live on mysituationroom.com.ng

One central server runs everything. All Command Centers log in at `https://mysituationroom.com.ng/command/`; you (the platform administrator) create and manage them from the same place. Each Command Center sees only its own rooms, observers and data.

Do the steps in order. Budget about an hour, plus DNS propagation time.

---

## Step 1 — Get a server (cloud VPS)

You need a Linux VPS with a **public IPv4 address**. Minimum for a pilot, comfortable for Kano:

- **8 vCPU, 16 GB RAM, 160 GB SSD**, Ubuntu 24.04 LTS (24 GB+ RAM if many observers stream video at once).
- A 4 vCPU / 8 GB server also works for a smaller test, but has little headroom for live video.

Good options:
- **Hetzner Cloud** CPX41 (8 vCPU / 16 GB) — best value, ~€28/month, 20 TB traffic. Data centre in Germany/Finland (≈130 ms to Nigeria, fine).
- A **Nigerian/African host** (Whogohost Cloud VPS, Layer3, AFRICLOUD) — lowest latency, usually pricier and less bandwidth. Make sure you get full root SSH access, not shared hosting.

Create the server, choose Ubuntu 24.04, and note its **public IP** (e.g. `203.0.113.45`) and the SSH login.

**Open these ports** (the provider's firewall / security group, and `ufw` if enabled):

| Port | Protocol | For |
|---|---|---|
| 22 | TCP | SSH (you) |
| 80, 443 | TCP | web + API + signalling |
| 7881 | TCP | LiveKit video |
| 7882 | UDP | LiveKit video |

---

## Step 2 — Point the domain at the server (Whogohost DNS)

On the DNS Management page you have open for `mysituationroom.com.ng`:

1. Click **Create DNS Zone**.
2. Add an **A record**: name `@` (or blank/root), value = your server's public IP, TTL default.
3. Add another **A record**: name `www`, value = the same IP.
4. Save. Propagation usually takes 10–60 minutes. Check with: `ping mysituationroom.com.ng` — it should answer from your server IP.

(If Whogohost insists on nameservers elsewhere, just make sure the final A record for the root domain resolves to your server IP.)

---

## Step 3 — Install on the server

SSH in (`ssh root@203.0.113.45`) and run:

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# the app (clone your repo; use a GitHub token if it is private)
git clone -b claude/friendly-tesla-ljce70 https://github.com/AbuBkrrr/collation.git
cd collation

# one-command setup: it asks for the domain and the server IP, generates all secrets, builds and starts
./start.sh
```

When `start.sh` asks:
- **Domain or IP** → `mysituationroom.com.ng`
- **Public IP** → your server's public IP (e.g. `203.0.113.45`)

It starts PostgreSQL, the app, Caddy (which gets a free HTTPS certificate for your domain automatically), LiveKit and the TURN relay, and loads every Kano LGA, ward and polling unit. At the end it prints your **platform administrator passcode** — copy it somewhere safe.

Wait 1–2 minutes, then open `https://mysituationroom.com.ng/command/` — you should see the login with a padlock (valid HTTPS).

> Optional sharper maps: `nano .env`, set `GOOGLE_MAPS_KEY=` or `MAPBOX_TOKEN=`, then `docker compose up -d`.

---

## Step 4 — Your private platform-administrator space

Log in at `https://mysituationroom.com.ng/command/` as operator **`admin`** with the printed passcode. This signed-in area is your private space — only this first account sees the **Command Centers** and **Locations** tabs; Command Center operators you create never do.

Do this first:
1. **App Settings → Change Command passcode** — set your own strong passcode.
2. **App Settings → Two-step login → Set up** — scan the QR with Google Authenticator / Authy. Now nobody can get into your space with the passcode alone.
3. **App Settings → Platform name** — this is the name shown on the login screen before anyone signs in (e.g. "My Situation Room").

---

## Step 5 — Create the Command Centers and issue their logins

For each body that runs its own operation (e.g. each state command):

1. **Command Centers → New Command Center**: enter its name (e.g. "Kano State Command"), a first operator name (e.g. `kano-admin`), and a passcode.
2. Give that administrator three things: the address `https://mysituationroom.com.ng/command/`, their **operator name**, and their **passcode**. Tell them to turn on their own two-step login at first sign-in.

They log in at the same URL and see only their own Command Center. You can disable any Command Center at any time (which suspends its rooms).

---

## Step 6 — Each Command Center sets up Kano

Inside a Command Center (for Kano):
1. **Situation Rooms → One room per LGA → Kano** → creates all 44 LGA rooms; the passcodes download as a CSV. Give each LGA supervisor their room ID + passcode.
2. Each room **activates**, then issues **two observer codes per polling unit** (Observer Manager), setting registered voters per PU.
3. Observers install the Android app (or open `/observer/`), enter `https://mysituationroom.com.ng`, log in with their code and set a PIN.
4. Add emergency/security/supervisor contacts (bulk upload supported).

Full election-day runbook is in `README.md`.

---

## Step 7 — Put the Android app on the landing page

Build the APK once (on a PC with Android Studio, see `mobile/README.md`), then copy it onto the server so observers can download it from `https://mysituationroom.com.ng`:

```bash
# on the server, from the collation folder
cp /path/to/app-release.apk data/app/observer.apk
```

The home page then shows a **Download the app (.apk)** button and a QR code observers can scan. No restart needed. Replace the file to publish a new version.

---

## Keeping it running

- **Backups** are automatic every 30 minutes into `./data/app/backups` on the server. Download them from **App Settings → Backups**, and copy `./data/app` to another location regularly. Video clips, EC8A photos and radio audio live in that same folder.
- **Update the code**: `git pull && docker compose up -d --build`.
- **Logs**: `docker compose logs -f app`.
- **Restart**: `docker compose restart`.

---

## A note on scale

One 8 vCPU / 16 GB server comfortably handles Kano's data for many rooms and observers (load-tested). Live video is the limit — plan ~100–150 simultaneous 360p streams per server. Because video is **on demand** (a room starts a stream only when it needs one), simultaneous streams stay low. If you later run several states at once with heavy video, add a second server for LiveKit and point `LIVEKIT_URL` at it; ask me and I'll set that up.
