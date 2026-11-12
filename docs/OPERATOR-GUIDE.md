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

### One room at a time — choose the election

**Situation Rooms** tab → **Create Situation Room**. The first drop-down is **the election the room is for**,
grouped by **type of election**:

| Type of election | Choose | Covers | You pick |
|---|---|---|---|
| **LGA** | **LGA Chairman** | exactly one LGA | one LGA (round buttons) |
| **State** | **Governor** | the whole state | nothing — no LGAs to choose |
| **Federal** | **Presidential** | the whole state | nothing — no LGAs to choose |
| **Federal** | **Senator** (senatorial district) | several LGAs | tick each LGA in the district |
| **Federal** | **House of Reps** (federal constituency) | several LGAs | tick each LGA in the constituency |
| Other | **Custom zone** | any LGAs | tick the ones you want |

The form shows **Type of election: LGA / State / Federal** under the drop-down. Choose the state (it is fixed if
your Command Centre belongs to one state), then — for LGA, Senator, Reps and zones — pick the LGAs. If a state's LGA
list has not been loaded, type the LGA names separated by commas. Name the room (or leave it blank for an
automatic name such as "Governorship — Kano"), add the operator, and press **Create Room**.

A room can issue observer codes **only in its LGAs** (a Governor or Presidential room: anywhere in its state).

**Elections are kept apart.** The same polling unit votes in several elections, so each room's observers report
**that election only**. Figures from different elections are never reconciled against each other and never
added together by accident: on **Global Collation** and **Results Review** pick the **CONTEST** (LGA Chairman,
Governorship, Presidential, Senate, House of Reps) to see one election at a time — if you leave it on *All* and
more than one election exists, the screen warns you that the totals mix elections. A room's own *Whole LGA /
Whole zone / Whole state* view adds up only rooms of **its own election**.

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

Observer codes are created **in the room**, by its supervisor, so each code is tied to the right area. Do a
whole batch at once:

1. In the Situation Room open **Observer Manager** → **Generate observer codes**.
2. **Tick the LGAs** the batch is for (a room covering Rogo and Karaye shows both; tick one, both, or use *all*).
   Everything under a ticked LGA starts ticked — its **wards** and **polling units** — so you only **untick** what
   you do not want. *all / none* links speed this up for LGAs, wards and polling units.
3. Choose **Observers per polling unit** (2 is recommended: two independent witnesses make a result trustworthy).
   The screen shows the total: for example *18 polling units → 36 new codes*. Units that already have observers
   only get what is missing, so you can safely run it again.
4. Press **Generate**. A window offers **Print QR cards** (one card per observer to hand out) and **Download
   list** (a spreadsheet of the codes).
5. **Names are optional.** Type each observer's name in the **Name** box of the Observers list whenever you have
   it — it saves as you leave the box.

To add a single observer by typing the LGA, ward and polling unit, open **Add one observer by typing the details**.
Registered voters for each unit come from the polling-unit list automatically.

### The observer's first login (they do this)
1. Install the **Observer app** from `/download/app` (or open `/observer/`).
2. **Scan the QR card** (it connects the app and fills in the code), or enter the **site address**
   when asked (once) and type the **code**. Then they choose a **PIN**.
3. The code **locks to that phone**. If they switch phones, the code won't work until you reset it.

### Who a Situation Room is for

When you create a room, choose its type: **LGA Chairman** (exactly one LGA), **Senator** (a senatorial
district), **House of Reps** (a federal constituency) or a **custom zone** — for the last three, tick
only the LGAs that zone covers. The room can issue observer codes and see results **only** in those
LGAs, and its **Whole zone** collation view adds up every room covering them.

### What the observer does on election day (tell them this)
- **Tallies add up.** Each figure they say ("APC 251") or type is **added to that party's running
  total** — so they can enter results in parts. To fix a mistake they tap the party's row and set the
  correct total; entry never locks, so they can keep adding figures all day.
- **Voice typing: say, confirm, send.** With the mic on, the observer says a party and its figures —
  "APC 20", "PDP 20", "APC 30", "APC 50". The party named is brought forward, and figures for it add
  up (20 + 30 + 50 = 100). The app shows the staged totals and reads them back: *"Confirm APC total 100
  votes"*. **Nothing is sent to the Situation Room until the observer says "confirm"** (or taps
  **Confirm & send**). They can type a corrected total in the box first, say "undo" to drop the last
  figure, or "cancel" to clear. The speaker button switches the read-back off. Typed entries (the
  party list and + button) are added straight away.
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

## 4a. Collation Officers — the reporting chain

Information flows up a clear chain of command:

| Level | Who | Does what |
|---|---|---|
| 1 | **Command Center** (state) | Overall monitoring, supervision, information management and coordination |
| 2 | **LGA coordination** — Situation Room + **Collation Officer 2** | Supervises all wards of the LGA |
| 3 | **Ward supervision** — **Collation Officer 1** | Coordinates the polling units of the ward; handles security and reports coming from them |
| 4 | **Polling-unit observers** | Gather and submit verified information (tallies, EC8A, video, GPS) |
| 5 | **Technical & data team** (platform administrator) | Platform administration, support, data integrity, maintenance |

A third officer, **Collation Officer 3**, sits at **state** level and oversees all LGAs. A multi-state Command Center (no state chosen — for example a presidential contest) has a fourth, **Collation Officer 4 (Federal)**, who oversees all the states. Every officer carries a coloured tag — **WARD**, **LGA**, **STATE** or **FEDERAL** — in the lists, on the sign-in card and in the officer app.

**Viewing a sign-in again.** Every Situation Room, Collation Officer and observer has a **Sign-in / QR** button that shows the card and QR code again (print or copy it). It shows the passcode that was issued; if the owner later chose their own passcode, or it was issued before this feature existed, use **Reset** to issue a new one.

**Nothing is created without its supervisor.** A Command Center with a state needs its State Collation Officer; an LGA Situation Room needs its LGA officer; and observer codes can only be generated for a ward once that ward has its Ward Collation Officer (name one in the same step, or add it first). The platform administrator can switch this rule off with the `require_officers` setting (value `0`) if ever needed.

**Adding officers — at the moment you create things:**
- **New Command Center** (platform administrator): fill *State Collation Officer — name / phone*.
- **Create Situation Room** for an LGA chairman: fill *LGA Collation Officer — name / phone*.
- **Generate observer codes** (Situation Room): open *Ward Collation Officer 1 — optional* and type a name and phone for each ward in the batch.
- **One room per LGA**: the button asks for each LGA's officer (LGA, name, phone — one per line) in the same step.
- Afterwards, the **Officer** button on a Command Center, Situation Room or observer row shows that officer's sign-in card and QR again.

Each officer gets a **code and passcode with a QR sign-in** (shown once; *QR / Reset* issues a new one). They sign in at `/officer/` or in the **Collation Officer** Android app.

**What an officer does** (sees only their own ward / LGA / state):
- **Report A — Reported tallies.** The figures coming up from below (polling units for a ward officer, wards for the LGA officer, LGAs for the state officer). For each unit the officer presses **Confirm as reported**, or **Correct once** and types the right figures. Either can be done **only once** per unit. A ward officer's confirmed or corrected polling-unit figure is the one the LGA and state officers see.
- **Report B — Physical results.** When the boxes / result sheets physically arrive at the ward, LGA or state collation centre, the officer enters the figures (and number of boxes). The app shows at once whether Report B **matches** Report A or which parties **differ**.

Officers are added only in the forms above — there is no separate officers screen.

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

A **Situation Room** has the same switch on its collation: **Whole LGA** adds up every Situation Room
covering that LGA — sister rooms in your Command Centre and rooms of the other Command Centres in the
state — and **This room only** shows just its own observers' figures.

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

The **Radio receiver** panel (a room's Radio tab, or the Command Center's Radio tab once you choose a room)
controls that room's listening post:

- **ON / OFF** — switches the radio receiver on or off.
- **Frequency** — type it in MHz (e.g. `154.3500`) and press **Tune**, or nudge it with the **◀ 25k / ◀ 12.5k /
  12.5k ▶ / 25k ▶** buttons. Choose **Narrow FM** (voice), **AM** or **Wide FM**.
- **Squelch** — higher ignores weaker signals; lower hears more noise.
- **☆ Save this channel** — keeps a named channel you can tune to in one tap.
- The status badge shows **Receiving 154.3500 MHz**, **Retuning…**, **Online · radio off** or **Listening post
  offline**. Changes reach the post within about 5 seconds.
- **Listen live: ON** plays each new transmission automatically as it arrives (tap it once so the browser
  allows sound).

The receiver only works once a listening post is running `tuner.js` (see `radio-gateway/README.md`).

> Radio comes from a **listening post** (an SDR receiver + antenna) placed near each area — **not**
> from observers' phones, which cannot receive VHF/UHF. To set one up for an area: in the Situation
> Room app → **Radio → Gateway key**, then follow `radio-gateway/README.md`. Until a listening post
> is connected, the monitor shows an empty state (never fake audio).

---

## 9. Broadcast messages

**Broadcast** tab. Send a message to all your Situation Rooms, to chosen rooms, to **everyone in an area**, or
an emergency alert to **every observer**. Choose **By state / LGA / ward…**, then who should get it —
**Situation Rooms that cover the area** or **every observer in the area** — then the state (fixed to yours),
the LGA and, if you like, a ward. Leave LGA or ward on "All" to widen it. Recipients acknowledge receipt, and
the list shows how many have.

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

## 13b. Dark / light mode

The round button at the bottom-right of every dashboard switches between light and dark mode. Your choice is
remembered on that device.

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
