# My Collation Center

Election observation and real-time collation for Nigeria. One server per Command Center runs three apps:

| App | URL | Who logs in, and how |
|---|---|---|
| **Command Center** | `/command/` | Command operators: name + passcode (+ 6-digit code if two-step login is on) |
| **Situation Room** | `/room/` | Room ID + passcode, both issued by the Command Center; the room must be **activated** |
| **Observer** (Android / web, installable) | `/observer/` | Observer code issued by **its own** Situation Room + a PIN the observer chooses at first login |

```
Command Center ──activates──▶ Situation Rooms ──issue codes──▶ Observers (2 per polling unit)
      ▲  sees / talks to all its rooms + observers        ▲ sees / talks only to its own observers
```

## What it does

- **Command Center:**
  - Create, activate, suspend and deactivate Situation Rooms, and drill into any room read-only.
  - National map and search across all its observers.
  - Request live video, talk back and message any observer.
  - Broadcasts with receipt tracking.
  - Global collation (State → LGA → Ward → PU).
  - Results review, contacts (single or bulk upload), exports, audit log.
  - Command operators with two-step login, webhooks, cloud sync, backups.
- **Situation Room:**
  - Issue observer codes (two per PU), lock and reset observers' phones, revoke codes.
  - Live map of its observers' GPS positions.
  - On-demand live video with talkback, share and restream.
  - Real-time collation (parties ordered by votes collated, highest first, updating live), plus the **Results & EC8A** review where the supervisor settles disagreements.
  - Dispatch queue with nearest free unit, radio log and recordings, messages, contacts, downloads.
- **Observer app:**
  - Start or stop the camera; it also starts by itself when the room asks for live video.
  - GPS heartbeat.
  - Voice tally ("APC 251") with offline speech, manual entry, and **one correction per party**.
  - Photo of the **EC8A** result sheet.
  - Incident report with the last 60 s of video, and Stealth SOS (a clock screen; triple-tap sends a silent alert).
  - Messages from the room or Command.
  - Everything queues on the phone when offline and uploads when the network returns.

### Results: two observers per polling unit

| Status | Meaning | Counted in totals? |
|---|---|---|
| pending | no figures yet | – |
| single | only one observer has sent figures | yes (unconfirmed) |
| partial | both sending, no figure conflicts yet | yes |
| matched | both observers' figures are identical | yes |
| **disputed** | the observers disagree on a figure | **no**, until resolved |
| resolved | the room supervisor saved the final figures, with a note | yes |

**Verified** means the PU is matched or resolved **and** has an EC8A photo on file. Each photo's SHA-256 hash is kept as tamper evidence. The observer also reads the **voters on register** and **accredited (BVAS)** figures off the EC8A; votes above the accredited figure (over-voting, which voids a PU under INEC rules) are flagged, as is a disagreement between the two observers on those figures.

## Security model

- **Every request** is checked against the caller's role, Command Center and room.
- **Row-level security in PostgreSQL** enforces the same rules again, inside the database. Inside a request, every query runs as the restricted role `collation_app` with the caller's Command Center and room set. A query that forgets a filter still cannot return another Command Center's or another room's rows. `npm test` checks this directly in the database.
- **Observer codes are locked to the first phone** that uses them, with a 4–8 digit PIN. Only the observer's room (or its Command Center) can reset the lock with **Reset phone**, and that logs the old phone out at once.
- **Two-step login** (authenticator app) for Command operators: App Settings → Two-step login.
- **Failed logins are rate-limited** per IP and per account. Only failures count, so many observers behind one mobile-network IP are not blocked.
- Passcodes, PINs and gateway keys are stored as bcrypt hashes. Sessions are signed JWTs, and every request re-checks that the user, room and Command Center are still active.
- Every login, code, edit, export, resolution and broadcast is written to the audit log.

## Install on the Command Center PC (Docker)

You need Docker (Docker Desktop on Windows, Docker Engine on Linux) and ideally a UPS.

```bash
./start.sh
```

On Windows, run `setup-windows.ps1` as Administrator from this folder instead.

The script asks for the domain or IP and generates every secret. It starts PostgreSQL, the app, Caddy (automatic HTTPS), LiveKit (video), egress (restream) and coturn (TURN relay), and loads all states, LGAs, wards and polling units on first boot. The Command passcode is printed at the end.

**Phones on mobile data must be able to reach this PC from the internet.** Use one of:

1. A public static IP on the PC, a domain A record pointing to it, and the router forwarding the ports below. Caddy gets a Let's Encrypt certificate automatically.
2. A small cloud VPS running the same stack, if the Command Center has no public IP. Data then lives on the VPS. Pull backups to the Command Center PC regularly (see Data & backups).

| Port | What |
|---|---|
| TCP 80, 443 | web apps, API, WebSocket, LiveKit signalling |
| TCP 7881, UDP 7882 | LiveKit media |
| TCP+UDP 3478, UDP 49160-49200 | coturn relay (optional, Linux) |

On a local network only (testing), give the LAN IP. Caddy then uses its own certificate, which you must install on each phone (`caddy-root.crt`).

## Kano deployment runbook

**One week before**
1. Install on the Command Center PC (above). Open `https://<domain>/command/` and log in as `admin` with the printed passcode.
2. App Settings: change the passcode, **turn on two-step login**, add one operator per person (each with two-step login).
3. Locations: the bundled list has all 44 Kano LGAs, their wards and PU names. If you have INEC's PU register (with real PU codes and registered voters), import it as CSV: `state,lga,ward,pu,reg,name`.
4. Create the Situation Rooms. For Kano, use **Situation Rooms → One room per LGA → Kano** to create all 44 at once; the passcodes download as a CSV. Each room can only issue observer codes inside its own LGA. Give each operator their room ID and passcode.
5. Contacts: upload the security, emergency and supervisor numbers in bulk (download the template in Contacts).

**Three days before**
6. Each room issues **two codes per PU**, sets the registered voters, and hands each observer their code.
7. Each observer installs the **Android app** (`mobile/`, see `mobile/README.md`) or opens `https://<domain>/observer/` and adds it to the home screen, enters the Command Center address once, logs in and chooses a PIN. The code is now locked to that phone. Ask observers to allow camera, microphone and location, and to open the app once on Wi-Fi so the offline speech model downloads (about 40 MB).
8. Rehearse: each room requests live video from a few observers, observers send test tallies and an EC8A photo, and a supervisor resolves a test dispute. Then revoke the test codes or reset their tallies by issuing fresh codes.
9. Command: App Settings → Backups → **Back up now**, then copy `./data/app` to an external drive. Automatic backups run every 30 minutes (`BACKUP_MINS`).

**Election day**
10. Activate the rooms in the morning. Watch Situation Rooms (Online / Sync pending) and Observers & Map.
11. Rooms work the **Results & EC8A** tab, starting with *Disputed* and then *Not verified*.
12. At the end of the day, take a final backup plus Export & Archive → *Full Archive JSON* and *Tallies CSV*.

## Data & backups (everything stays on the Command Center PC)

| What | Where |
|---|---|
| Database (all text data) | PostgreSQL (Docker volume `pgdata`), dumped every 30 min to `./data/app/backups/*.dump` |
| Video clips, EC8A photos, radio audio | `./data/app/clips`, `./data/app/ec8a`, `./data/app/radio` |

Restore a backup:

```bash
docker compose exec -T db pg_restore -U postgres -d collation --clean --if-exists < data/app/backups/<file>.dump
```

Downloads: Situation Room → Data Download (its own room), and Command Center → Export & Archive (all its rooms). Both offer CSV and JSON plus every video clip.

## Configuration (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `PARTIES` | APC,PDP,NNPP,ADC,NDC,LP,SDP,APGA,YPP,AA,A,AAC,ADP,APM,APP,BP,NRM,PRP,YP,ZLP | party codes, in ballot order. Check against INEC's current list before the election. |
| `BACKUP_MINS` / `BACKUP_KEEP` | 30 / 96 | automatic backup interval in minutes (0 = off), and how many dumps to keep |
| `JWT_SECRET` | generated | session signing key. If unset, a random key is stored in `DATA_DIR/.jwt_secret`. |
| `COMMAND_PASSCODE` | random | first `admin` passcode, printed once |
| `LIVEKIT_*`, `TURN_*` | set by `start.sh` | video server and relay |
| `STT_URL` | – | optional server speech-to-text (phones use on-device Vosk when offline) |
| `GOOGLE_MAPS_KEY` | – | Google Map Tiles API key: adds Google satellite/roadmap layers |
| `MAPBOX_TOKEN` | – | Mapbox token: adds Mapbox satellite/streets layers |
| `CORS_ORIGINS` | – | extra web origins allowed to call the API (the Android app's `https://localhost` is always allowed) |
| `PG_POOL` | 40 | database connections |

## Several Command Centers on one server

The first `admin` is the **platform administrator**. The **Command Centers** tab creates more Command Centers, each with its first operator, and can disable one (which suspends its rooms). Each Command Center sees only its own rooms, observers, operators, contacts, messages, clips, results and audit log. With one server per Command Center (recommended), only one Command Center is used.

## Radio (listening post → Situation Room)

A phone cannot receive VHF/UHF radio. A listening post near the area does:
1. Hardware: RTL-SDR dongle, an antenna for the band (VHF 136–174 MHz, UHF 400–470 MHz), and a mini PC or Raspberry Pi.
2. In the Situation Room, open Radio → **Gateway key** (shown once).
3. Analog voice: `radio-gateway/analog-record.sh <freq MHz> <dir>` (one dongle per channel). For many channels on one dongle, use trunk-recorder's analog conventional mode. Digital trunked systems need a decoder such as GopherTrunk or SDRTrunk.
4. Send calls to the room. Easiest: point **trunk-recorder**'s `rdioscanner_uploader` plugin straight at `https://<domain>/api/call-upload` with the gateway key — the same format OpenMHz and Broadcastify Calls use. Or run the folder-watcher `node radio-gateway/forward.js`. Each transmission appears in the room's Radio panel with a play button.

Full setup and hardware list: `radio-gateway/README.md`. Encrypted channels (TETRA and others) cannot be decoded, only detected.

## Android app

`mobile/` is a complete Capacitor Android project. It bundles the observer UI (instant start, offline) and points at your Command Center, with background GPS (foreground service), keep-awake while streaming, and camera/mic/location/notification permissions wired up. Build it in Android Studio:

```bash
cd mobile && npm install && npm run sync && npm run open
```

Full steps, including a signed release APK, are in `mobile/README.md`. Observers who cannot install the app use `https://<domain>/observer/` in Chrome.

## Development and tests

```bash
npm install
TEST_DATABASE_URL=postgres://postgres@localhost:5432/collation_test npm test   # API + isolation + RLS tests
E2E_DATABASE_URL=postgres://postgres@localhost:5432/collation_e2e node test/e2e.js  # browser test (needs Playwright)
LOAD_DATABASE_URL=postgres://postgres@localhost:5432/collation_load node test/load.js # Kano-scale load test
```

Each test **drops and recreates** the database named in its URL, so never point one at a real database.

Code map:
- `server.js`: boot, static files and vendor libraries
- `src/core.js`: config, database, row-level security, auth
- `src/routes/*`: one file per area (auth, tenants, rooms, observers, results, messages, contacts, data, settings, media, radio, admin)
- `src/ws.js`: live push and WebRTC signalling
- `public/{command,room,observer}`: the three apps
- `public/shared`: shared UI and styles

**Measured at Kano scale** (11,200 PUs, 22,400 observers, 224,000 tallies, one server):

| Check | Result |
|---|---|
| Collation | about 0.6 s cold, about 20–30 ms cached |
| Disputed-PU list | about 25 ms |
| GPS heartbeats | about 2,050 per second; about 1,500 per second needed |

## Known limits

- Map imagery: the free Esri satellite and CARTO dark layers work with no key. For sharper city imagery, set `GOOGLE_MAPS_KEY` (Google Map Tiles API) or `MAPBOX_TOKEN`; those layers and the **Pinpoint** button (zoom to an observer at street level) then appear. This is the same class of imagery ride-hailing apps use — Google, Mapbox and Maxar/Esri. Tiles are fetched from those providers over the internet; everything else is served from this PC. Each observer marker also shows a GPS-accuracy ring.
- A live street-level view of a polling unit is the observer's **camera**. Satellite and Street View imagery everywhere is months or years old; no provider offers live aerial video.
- Live video runs on one LiveKit server. Plan about 100–150 simultaneous 360p streams per 4-core server, and add LiveKit nodes for more.
- Background GPS while the app is closed needs the native Android build. The web app sends GPS while it is open.
