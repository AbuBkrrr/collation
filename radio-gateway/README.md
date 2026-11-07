# Radio gateway (SDR → Situation Room)

A phone cannot receive VHF/UHF radio. A small **listening post** near the area does: an RTL-SDR dongle, an antenna for the band, and a mini PC or Raspberry Pi. It records each transmission and sends it to the Situation Room, where it appears in the Radio panel with a play button.

Nigerian bands this covers:
- **VHF** 138–174 MHz (police, civil defence)
- **UHF** 403–470 MHz (NEMA, inter-agency)

Encrypted channels (TETRA and others) can be detected but **not** decoded. Check that monitoring your target channels is authorised.

## Get the gateway key

In the Situation Room app: **Radio → Gateway key**. It is shown once; copy it to the listening-post PC. Each room has its own key.

## Option A — trunk-recorder posting straight to the server (recommended)

[trunk-recorder](https://github.com/robotastic/trunk-recorder) is the open-source recorder behind OpenMHz and Broadcastify Calls — a proven, widely used setup. It records conventional (analog) channels and digital trunked systems (P25, DMR) and has a built-in uploader that this server accepts directly, with no extra script.

In `config.json`, add the Rdio Scanner uploader to each system and point it at your server:

```json
{
  "shortName": "kano-vhf",
  "control_channels": [],
  "channels": [154350000, 154400000],
  "type": "conventional",
  "modulation": "fm",
  "squelch": -50,
  "uploadScript": "",
  "plugins": [
    {
      "name": "rdioscanner_uploader",
      "library": "librdioscanner_uploader.so",
      "systems": [
        {
          "shortName": "kano-vhf",
          "server": "https://YOUR-DOMAIN/api/call-upload",
          "apiKey": "GW.SR-KN-XXX.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        }
      ]
    }
  ]
}
```

Use your Command Center address for `server` (keep the `/api/call-upload` path) and the room's gateway key for `apiKey`. SDRTrunk's "Rdio Scanner" streaming uses the same fields and endpoint.

## Option B — watch a folder of recordings

For any decoder that writes call files to a folder (trunk-recorder, SDRTrunk, GopherTrunk), run the included watcher next to it:

```bash
SERVER=https://YOUR-DOMAIN \
GATEWAY_KEY=GW.SR-KN-XXX.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
WATCH_DIR=/path/to/recordings \
node forward.js
```

It uploads each finished `.wav/.mp3/.ogg` (with its sidecar `.json` metadata when present) and remembers what it has sent.

## Option C — plain analog voice, one dongle per channel

No digital decoder needed. `analog-record.sh` records one squelched FM channel to a folder, which Option B then uploads:

```bash
./analog-record.sh 154.3500 ./recordings 40 0    # freq MHz, out dir, squelch, dongle index
```

For many analog channels on one dongle, use trunk-recorder's conventional mode (Option A) with several `channels` within about 2 MHz.

## Hardware for one listening post

| Item | Notes |
|---|---|
| RTL-SDR Blog v3 dongle | one per channel with `analog-record.sh`; one covers ~2 MHz of channels with trunk-recorder |
| Antenna for the band | VHF 136–174 MHz or UHF 400–470 MHz; a wideband discone works until the exact band is known |
| Low-loss coax (LMR-400) + SMA adapters | keep the run short |
| Mini PC (Intel N100) or Raspberry Pi 4/5 | runs the recorder and uploader |
| Powered USB hub + UPS | survives power cuts |
| Wired network | to reach the server |
