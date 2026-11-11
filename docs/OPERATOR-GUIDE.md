# Command Centre Operator Manual — My Situation Room

This guide is for **you, the client**: the organisation running a Command Centre to observe an
election. It covers everything, step by step — setting up your rooms, your observers, watching the
field live, collating results, resolving disputes, and exporting your evidence.

> **Your operation is private.** No other Command Centre can see your rooms, observers, map, video,
> audio, photos, messages or audit trail — isolation is enforced in the database itself. The one
> thing that may be combined is **vote counts**: where the platform administrator has enabled it,
> Global Collation adds up the figures of all Command Centres in the same state (section 6).

---

## The structure you'll build

```
Your Command Centre  (you)
   └── Situation Rooms   (one per LGA / area — each has a supervisor)
          └── Observers  (field agents, two per polling unit)
```

- **You** create Situation Rooms and extra operators.
- **A Situation Room supervisor** logs into their room and creates **observer codes** for their area.
- **Observers** install the app, lock it to their phone, and report from their polling unit.

---

## 1. Signing in

1. Open the login link from your invite — **`https://mysituationroom.com.ng/command/`**.
2. Choose **Command Centre**, enter your **operator name** and **passcode** (from the invite).
   - **Or scan the QR code** on your invite: with your phone camera, or with **Scan QR code instead** on the
     sign-in screen. It fills in the details and signs you in.
3. First thing: go to **App Settings → change your passcode** to something only you know.

### Turn on two-step login (do this)
In **App Settings**, enable **two-step login** and scan the QR code with Google Authenticator or
Authy. From then on each login also needs the 6-digit code. This protects your command even if your
passcode leaks.

### Add more operators (optional)
In **App Settings** you can add colleagues as operators of *your* Command Centre — each gets their
own name and passcode, and can enable their own two-step login. You can disable or reset any of them.
If someone loses their authenticator phone, clear their two-step login so they can re-enrol.

---

## 2. Create your Situation Rooms

A Situation Room is one area of responsibility — usually one LGA. **Situation Rooms** tab:

### One room at a time
1. Under **Create Situation Room**, type a **Room name** (e.g. `Nassarawa LGA Situation Room`).
2. Your **state is fixed** (it is set when your Command Centre is created and cannot be changed here).
   Tick the **LGA** the room covers from the list. Leave the name blank and it is called
   "&lt;LGA&gt; LGA Situation Room".
3. Click **create**. A **passcode and a QR code are shown once** — give them to that room's
   supervisor (**Share / print with QR** gives you a card to copy or print). The passcode is stored
   hashed; nobody (not even you) can read it back later, only reset it.
4. **Rooms start inactive.** Press **Activate** on the room's row before the supervisor signs in.

### All LGAs at once (fast setup)
Use **One room per LGA** to create a room for every LGA in your state in one click, then download the
CSV of room IDs + passcodes, and a second file — a **QR sheet** (`…-QR.html`) with one sign-in card
per room. Open that file to view, print or save as PDF. This is the quickest way to stand up a whole state.

### Managing a room (buttons on each row)
- **Rename** — change its display name.
- **New passcode** — reset that room's passcode (the old one stops working); the new one shows once.
- **Suspend** — temporarily stop the room (its observers can't report); **Activate** to resume.
- **Deactivate** — take the room offline at the end of the day.
- **Drill** — open a **read-only** view *inside* that room (its map, observers, collation, radio) so
  you can watch a single area without leaving the Command Centre.

### Reset & download ALL passcodes
In the Situation Rooms header, **Reset & download all passcodes** generates a fresh passcode for
every room and downloads **two files**: a CSV (`room_id, room_name, lga, passcode, login_url,
qr_sign_in_link`) and a **QR sheet** (`Situation-Room-sign-in-sheets-QR.html`) with one QR card per
room. The QR codes are in the second file — open it in your browser and print it. (It resets them, so use it once when you're ready to distribute.)

---

## 3. How a Situation Room supervisor works (share this part with them)

Your supervisors use the **Situation Room app** (download from the landing page) or the browser.

1. Open **`https://mysituationroom.com.ng/room/`** (or the Situation Room Android app, entering the
   site address once).
2. Sign in with the **Room ID** and **passcode** you gave them — or just **scan the QR code** on their
   card (phone camera, or the **Scan QR code** button).

   > **In the Android app the very first screen asks for the web address, not the passcode.** Tap
   > **Scan QR code** and scan the card (it sets the address and signs in), or leave the address as
   > `mysituationroom.com.ng` and tap **Connect**; the Room ID and passcode are typed on the *next* screen.
3. They then:
   - **Create observer codes** for their area (section 4),
   - watch their observers on the **map**, request **live video**,
   - see their **collation** and **results**, and the **radio** monitor,
   - resolve **disputes** for their polling units.

A supervisor only ever sees their own room.

---

## 4. Add observers (done inside a Situation Room)

Observer codes are created **in the room**, by its supervisor, so each code is tied to the right area.

1. In the Situation Room, open the **Observers** manager.
2. Choose the **polling unit** (state → LGA → ward → PU — limited to the room's area).
3. **Generate a code**. A card with the code and its **QR** appears — copy, print, or let the agent
   scan it. Aim for **two observers per polling unit** — that's what makes a result trustworthy
   (section 7). **QR** on any row shows the card again, and **Print QR sheet (unused codes)** prints
   a card for every code not yet claimed.

### The observer's first login (they do this)
1. Install the **Observer app** from `/download/app` (or open `/observer/`).
2. **Scan the QR card** (it connects the app and fills in the code), or enter the **site address**
   when asked (once) and type the **code**. Then they choose a **PIN**.
3. The code **locks to that phone**. If they switch phones, the code won't work until you reset it.

### What the observer does on election day (tell them this)
- **Tallies add up.** Each figure they say ("APC 251") or type is **added to that party's running
  total** — so they can enter results in parts. To fix a mistake they tap the party's row and set the
  correct total **once**; after that the row is locked.
- **Messages** from the room appear on their screen. They are **not read aloud**.
- **Talk-back:** while they are streaming, they hear the room (or a shared viewer) speaking to them
  through the phone, and the room hears them.
- **Stealth mode** turns the screen into a plain clock. Three quick taps on the clock send a silent
  SOS. To leave stealth: **press and hold the clock for two seconds**, or tap the faint word "open"
  at the bottom-right.

### Managing an observer (from the room or the Command Centre)
- **Reset device** — unlocks the code so it can be enrolled on a new phone (lost/replaced phone).
- **Revoke / disable** — instantly ends that observer's access.
- **Request live** — ask the observer's phone to start streaming (section 5).

---

## 5. Watch the field live (video, GPS, talk-back)

**Observers & Map** tab (Command Centre), or the map inside a room.

- The map shows every observer as a dot with their **GPS** position and a **live/streaming** tag.
- Click an observer → **Request live** to have their phone start the camera.
- **Multiple people can watch the same observer at once.** You and the Situation Room supervisor (and
  several of your operators) can all view the same feed simultaneously — the phone only uploads once.
- **Talk back** — push-to-talk audio to the observer while watching.
- **Restream** — paste an `rtmp://`/`rtmps://` URL (with its stream key) to push that observer's feed
  to an external service (a war-room screen, a partner, or a public live stream) for unlimited
  viewers. **Stop restream** ends it.

> Observers only stream **when asked** (to save their data and battery), and the screen stays awake
> while streaming. GPS keeps updating in the background.

---

## 5a. Share a live view with people outside the system

Use this for party leadership, a partner organisation, a media desk or a war-room screen — people who
should **see** what is happening but must not be able to change anything.

**Share Live View** tab (Command Centre or Situation Room):

1. Give the view a **name**.
2. Choose **what it shows**: *all* your observers (new ones are added automatically), or **only the
   observers you tick**.
3. Set a **passcode** (or leave blank to auto-generate), how long it **stays open**, and whether
   viewers may **talk to observers** (talk-back).
4. Click **Create shared view**. You get the **link**, the **passcode** and a **QR** for the link —
   shown once. Send the link and passcode to your viewers, ideally by different channels.

What the viewer gets (after entering the passcode): **live collation**, the **map**, and **live
video** of the shared observers, and they can **move between LGAs, wards, polling units and feeds**
(Previous / Next, the list, or the map). Any number of people can watch at once. If you allowed it,
they can talk to the observer. There are **no control buttons** — a viewer cannot create, edit,
resolve, message or export anything, and the viewer pass opens nothing else in the system.

Watching a feed asks that observer's phone to start its camera; when the last viewer leaves, it is
switched off again automatically. **Revoke** a view (same tab) to cut off everyone using it at once.

---

## 6. Global Collation (the running tally)

**Global Collation** tab. Figures arrive as observers report them, sorted by votes, highest first,
and the parties re-order live as numbers come in. The six major parties (APN, APC, ADC, NDC, PDP, LP)
are shown; drill **LGA → Ward → Polling Unit** to see any level. The search bar is locked to **your
state** and lists only its LGAs, wards, polling units and rooms. Use **PARTY** (or type a party name
such as "APC" in the search box) to show one party only. In a live election the
figures keep rising as observers submit.

---

### Whole state, or this Command Centre only

**Observers & Map** always shows only **your own** observers. **Global Collation** can show more:

- **Whole state** (default) — the vote counts of **every Command Centre in your state**, added up by
  LGA, ward and polling unit. A blue note says how many polling units and votes come from
  **external observers** (other Command Centres' observers). Each polling unit is counted **once**:
  your own figure for a unit always stands; where you have none, the best-evidenced figure from
  another centre is used.
- **This Command Centre only** — just your own figures.

Only **vote counts** are combined. You never see another centre's map, video, audio, photos or
observer details, and they never see yours.

## 7. Results Review — the trust engine

This is what lets you **defend your numbers**. **Results Review** tab. Every polling unit moves
through a status as its two observers report:

| Status | Meaning |
|---|---|
| **pending** | no figures yet |
| **single** | only one observer has reported |
| **partial** | both reported but some parties differ |
| **matched** | both observers' figures agree |
| **disputed** | the two observers disagree |
| **resolved** | a supervisor settled a disputed unit |
| **verified** | matched *or* resolved **and** an EC8A photo is on file |

### Resolve a dispute
1. Filter to **Disputed**.
2. Open the unit — you see **both observers' figures side by side**.
3. Check them against the **EC8A result-sheet photo** the observers uploaded.
4. Enter the correct figures and **Resolve**. (Use **Unresolve** to reopen if needed.)

### What "verified" means
A unit is **verified** only when two independent witnesses agree (or a dispute was resolved) **and**
there's a photo of the EC8A to prove it. Each photo carries a SHA-256 fingerprint recorded at upload
as tamper evidence. Filter to **Verified** to show your rock-solid units.

---

## 8. Radio monitor

**Radio** tab. Plays back radio transmissions captured per area, labelled by room, with a per-room
filter at the Command Centre.

> Radio comes from a **listening post** (an SDR receiver + antenna) placed near each area — **not**
> from observers' phones, which cannot receive VHF/UHF. To set one up for an area: in the Situation
> Room app → **Radio → Gateway key**, then follow `radio-gateway/README.md`. Until a listening post
> is connected, the monitor shows an empty state (never fake audio).

---

## 9. Broadcast messages

**Broadcast** tab. Send a message to all your Situation Rooms at once (instructions, alerts). Rooms
acknowledge receipt. Past broadcasts are listed.

---

## 10. Incidents

Observers can **report an incident** from the field (violence, irregularities, etc.). These surface
in your Command Centre so you can act and keep a record. Each is time-stamped in the audit trail.

---

## 11. Contacts

**Contacts** tab. Keep a directory of your people (supervisors, observers, officials). Add them one
by one or **bulk import**.

---

## 12. Export & Archive

**Export & Archive** tab — "your data, exportable any time."

- **Export** results and data as **CSV / JSON**.
- **Backups** — the server also keeps automatic database snapshots; you can download them here.

Export at the end of the day (or periodically) so you always hold your own copy of the evidence.

---

## 13. Audit Log

**Audit Log** tab — a time-stamped record of actions in *your* Command Centre (logins, room and
observer changes, resolutions). Your accountability trail.

---

## 13a. Help

**Help** tab — this manual, inside the app, with a **Download PDF** button.

---

## 14. Good security habits (please follow)

- Change your passcode on day one; turn on **two-step login**.
- Give each Situation Room its **own** passcode; use **Reset & download all passcodes** to distribute
  cleanly, and **New passcode** if one leaks.
- Observers' codes are **device-locked** — only **Reset device** when a phone genuinely changed.
- **Revoke** any observer or operator who leaves immediately.
- **Export/backup** your data regularly.
- Only share login links and passcodes through private channels (never post them publicly).

---

## 15. Troubleshooting

| Problem | Fix |
|---|---|
| A supervisor can't log in | Check the room is **Activated** (new rooms start inactive) and not **Suspended**; re-issue with **New passcode**. |
| The app says **"Failed to fetch"** / "Could not reach that address" on its first screen | That screen wants the **web address** (`mysituationroom.com.ng`), not the passcode. Tap **Scan QR code**, or enter the address and type the passcode on the next screen. |
| An observer's code won't work on a new phone | **Reset device** on that observer. |
| Map says "API KEY REQUIRED" | You're on an old build — have your admin redeploy; maps are keyless now. |
| No live video | Confirm the observer tapped to go live and has signal; ensure LiveKit is running on the server. |
| Radio monitor empty | A listening post hasn't been connected for that area yet (section 8). |
| Can't see another command's data | That's by design — each Command Centre is fully isolated. |

---

Questions your platform provider can answer: deployment, the server, the radio listening posts, and
anything about the Android apps.
