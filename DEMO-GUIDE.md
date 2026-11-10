# Giving a client demo (on your laptop)

The marketing page (`my-situation-room-tlqyky.v2.appdeploy.ai`) is what makes a client ask for a demo. This is how you give the **real** demo: the actual Command Centre, Situation Rooms and Observer app, filled with a believable Kano election in progress. You run it on your own PC and show it in person or over a screen‑share (Zoom / WhatsApp video / Google Meet). No public server needed.

You only need **Docker Desktop** (you already have it) and this project.

## 1. Start the system (once)

In the project folder:

```bash
# put the six parties first so the collation shows them
echo "PARTIES=APC,PDP,ADC,LP,NDC,APN,NNPP,SDP,APGA,YPP" >> .env
./start.sh
```

On Windows, run `setup-windows.ps1` as Administrator instead. When it asks for a domain/IP on your own laptop, use `localhost` or your PC's IP. It prints an admin passcode — ignore it for the demo; you'll use the demo login below.

## 2. Fill it with a live election (the seeder)

```bash
# one-time populate: 6 LGAs, ~40 live observers on the map, tallies, incidents, a dispute and a verified PU
npm run seed:demo
```

For a demo where the **numbers keep climbing on screen**, run it in live mode instead and leave it running during the meeting:

```bash
node scripts/seed-demo.js --live
```

The seeder only ever touches the demo command ("Kano State Command (Demo)") — it never affects real data, and you can re‑run it any time to reset.

## 3. Open it and sign in

In your browser: **`https://localhost/command/`** (or `http://<your-ip>/command/`)

```
operator: demo
passcode: demo1234
```

## 4. What to show (a 5‑minute script)

1. **Situation Rooms** tab — "one command, 6 LGA rooms, all live."
2. **Observers & Map** — the Kano map covered in green observer dots; click one → point out GPS, the live/streaming tag. This is where you'd request live video from a real observer.
3. **Global Collation** — the six parties sorted by votes; switch State → LGA → Ward → PU to show the drill‑down. (In `--live` mode the figures keep rising.)
4. **Results Review** — filter to **Disputed**: show the one PU where the two observers disagree, open both figures, and **Resolve** it against the EC8A photo. Then filter to **Verified** to show a PU backed by two witnesses + a result‑sheet photo. This is the trust story.
5. **Broadcast** — send a message to all rooms; **Export & Archive** — download the CSV/JSON. "Your data, exportable any time."

### Make it fully live with a phone (optional, strongest moment)
On your phone, open `https://<your-ip>/observer/`, and from the demo Command Centre generate a code in a room's Observer Manager (or log in with one). Then show the **real** camera streaming to the command centre, a **voice tally** ("APC 251"), and the **GPS** moving on the map. That part is genuinely live, not simulated.

> On a laptop with Caddy's own certificate, the browser warns about the connection the first time — accept it (and on the phone, install Caddy's root certificate once). A public domain on your server removes this.

## 5. Reset between demos

```bash
npm run seed:demo      # wipes and recreates the demo data
```

---

When your Hetzner server is live, I'll stand up this same demo as a **public link** at a demo address on `mysituationroom.com.ng`, so clients can click through it themselves — separate from your real election data.
