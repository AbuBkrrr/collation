# Platform Administrator Manual — My Situation Room

This is the guide for **you, the platform owner** (AI Brains Ventures). Your account is the
**platform administrator**: the only role that can create and control **Command Centres** (the
top-level accounts you hand to clients). Each client then runs their own Command Centre, creates
their own Situation Rooms, and their observers report from the field — all sealed off from every
other client.

> Audience separation: you create and switch Command Centres on and off. You **cannot** see any
> client's rooms, observers, results, photos or audit — that isolation is enforced in the database,
> by design, for trust. You hand each client the keys to their own house; you don't live in it.

---

## 0. The three levels at a glance

| Level | Who | Logs in at | Creates |
|---|---|---|---|
| **Command Centre** | A client organisation (e.g. a party, an observer group) | `/command/` | Situation Rooms + operators |
| **Situation Room** | An LGA / area supervisor | `/room/` | Observer codes |
| **Observer** | A field agent at a polling unit | the Android app or `/observer/` | reports (video, GPS, tallies, EC8A) |

You operate at the very top: you create the **Command Centres** themselves.

---

## 1. Signing in as the administrator

1. Open **`https://mysituationroom.com.ng/command/`**.
2. Enter your **operator name** (`admin`) and **passcode**.
   - On a brand-new server the first passcode is printed **once** in the server log at first boot
     (or set by `COMMAND_PASSCODE`). Change it immediately (section 7).
3. If you turned on **two-step login**, enter the 6-digit code from your authenticator app.

You land in the **Main Command Centre**. Because you are the administrator you also see three extra
tabs the clients never see: **Command Centres**, **Marketing**, and **Locations**.

---

## 2. Creating a Command Centre for a client

This is your main job. Go to the **Command Centres** tab.

1. Under **New Command Centre**:
   - **Name** — the client's name, e.g. `Kano State Command` or `Blue Party National`.
   - **State (optional)** — pick one to auto-fill that state's LGAs, wards and polling units for the
     client. Leave blank for a multi-state client.
   - **First operator name** — *leave blank* and the system makes a unique one from the name
     (`kano-state-command`, then `-2` if taken). Type one only if you want a specific login name;
     it must be unique across the whole platform.
   - **Operator passcode / Confirm** — *leave blank* to auto-generate a strong one, or type your own
     (min 8 characters) and confirm it. Use **Show** to check what you typed.
2. Click **Create Command Centre**.
3. A **sign-in card with a QR code** pops up (Copy / Print), and a ready-to-send invite is copied to
   your clipboard, e.g.:

   ```
   Kano State Command — My Situation Room
   Login: https://mysituationroom.com.ng/command/
   Operator: kano-state-command
   Passcode: REY4YXQDAM
   Open the link, choose "Command Centre", and sign in...
   ```
4. **Send that to the client** (WhatsApp, email), or print the card. They can type the operator name
   and passcode, or simply **scan the QR** to sign in. That's everything they need to start.

### Re-sending or resetting a client's login

On the client's row in the **Command Centres** list, click **Share**. This **sets a fresh passcode**
(the old one stops working) and copies a new invite to send. Use it if a client lost their passcode
or you suspect it leaked.

### Turning a Command Centre off / on

On the client's row, click **Disable (suspends its rooms)**. The client can no longer log in and all
their Situation Rooms are suspended — use this at the end of an engagement or for non-payment.
Click **Enable** to switch it back on. You cannot disable your own (`CC-MAIN`).

> **Deleting:** there is deliberately no one-click "delete a Command Centre" button, so a client's
> election record is never wiped by accident. Disabling is the safe, reversible equivalent. If a
> client must be permanently removed, do it on the server with a database operation and a backup
> first — ask your engineer.

---

## 3. Loading the location data (states → LGAs → wards → PUs)

Clients pick polling units from this list, so it must be loaded. **Locations** tab:

- **Fetch for a state** — choose a state and pull its official breakdown automatically.
- **Import a file** — upload an Excel/CSV of `state, lga, ward, pu` if you have your own dataset.
- You'll see counts per state once loaded.

Do this once per state you operate in. When you set a state on a Command Centre (section 2), that
client is scoped to it automatically.

---

## 4. Marketing & link tracking (your sales tool)

The **Marketing** tab is yours alone — it drives client acquisition.

- **Tracking links** — type a label (e.g. `inec-kano`, `whatsapp-batch-1`) and copy the generated
  `…/pitch?ref=<label>` link. Share a different label with each person/channel.
- **Opens** — total opens, unique visitors, today, by label and by day.
- **Devices & browsers** — what people viewed on, and where they came from.
- **Leads & contacts** — people who filled the **Request a demo** form on the pitch page (name,
  phone, organisation), each a click-to-WhatsApp link, with CSV export.

> A web page **cannot** read a visitor's phone number — no browser allows it. The Leads list shows
> people who *chose* to leave their details or who messaged your WhatsApp.

The public pitch page itself is at **`/pitch`** and the demo button opens your WhatsApp
(+234 803 254 0215).

---

## 5. Your own live demo (for prospects)

See **`DEMO-GUIDE.md`**. In short: run the system, `npm run seed:demo` fills a believable Kano
election ("Kano State Command (Demo)") you can walk a client through, and re-running it resets the
demo. It never touches real client data.

---

## 6. The Android apps

Two apps are built by CI and published on the landing page automatically:

- **Observer app** — `/download/app`
- **Situation Room app** — `/download/room`

Both also run in any browser. You don't build these by hand — a push that changes the app rebuilds
them (see `mobile/README.md`). On the landing page each shows a **Download (.apk)** button and a QR
code once built.

---

## 7. Securing your own account

**App Settings** tab:

- **Change your passcode** — do this on day one; use a long, unique one.
- **Two-step login (TOTP)** — enable it and scan the QR with Google Authenticator / Authy. After
  this, every login needs the 6-digit code. Strongly recommended for the administrator.
- **App name** — the platform name shown on login screens.
- **Add operators** — you can add more administrator-side operators if needed; each gets their own
  name + passcode and (optionally) their own two-step login. Disable or reset any of them here.
- If an operator loses their phone, you can **clear their two-step login** so they can set it up
  again on a new device.

See `SECURITY.md` for the full checklist (branch protection, firewall, backups, 2FA).

---

## 7a. Help tab

The **Help** tab shows both manuals inside the app — this one (visible to you only) and the client
operator manual — each with a **Download PDF** button, handy for onboarding emails.

---

## 8. Audit log

**Audit Log** tab records every significant action with a timestamp — logins, Command Centre
creation, passcode resets, and more. It's your record of who did what. (Each client has their own,
separate audit log inside their own Command Centre.)

---

## 9. Live field video — what to tell clients

If a client asks "can two of us watch the same observer at once?" — **yes**. The observer's phone
streams once and everyone authorised in that command/room sees the same live feed simultaneously,
can talk back, and can push it to an external broadcast via **Restream**. Nothing extra to configure
as long as LiveKit is running (it is, in the standard deployment). For people **outside** the client's
team, the client uses **Share Live View**: a view-only page (collation, map, video, optional talk-back)
opened with a link and a passcode — see the operator manual, section 5a.

---

## 10. Quick reference — what only YOU can do

- Create / name Command Centres and assign a state.
- Generate and re-issue client login invites (Share).
- Enable / disable a client's Command Centre.
- Load location datasets for new states.
- See platform-wide Marketing and Leads.
- Set the platform name and your own security.

Everything *inside* a Command Centre — rooms, observers, results — is the client's to run, with the
operator guide below.
