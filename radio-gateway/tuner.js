// Listening-post controller: lets the dashboard switch the radio ON/OFF and TUNE it.
// It asks the server every few seconds what the Situation Room wants (power, frequency, mode, squelch), runs the
// SDR (rtl_fm + sox) accordingly, saves each transmission as a .wav and uploads it (via forward.js, started here).
//   SERVER=https://your-domain GATEWAY_KEY=GW.SR-XX-ABC.xxxx node tuner.js
// Needs: Node 18+, rtl-sdr (rtl_fm) and sox on this PC. Optional: DEV=0 (dongle index), DIR=./recordings.
const { spawn } = require("child_process"),
  fs = require("fs"),
  path = require("path");
const { SERVER, GATEWAY_KEY, DEV = "0", DIR = "./recordings", RTL_FM = "rtl_fm", SOX = "sox", POLL_MS = "5000" } = process.env;
if (!SERVER || !GATEWAY_KEY) {
  console.error("Set SERVER and GATEWAY_KEY");
  process.exit(1);
}
fs.mkdirSync(DIR, { recursive: true });
// uploads finished recordings (same key, same folder)
const fwd = spawn(process.execPath, [path.join(__dirname, "forward.js")], { env: { ...process.env, WATCH_DIR: DIR }, stdio: "inherit" });
let proc = null,
  cur = null, // what is running now: { freq, mode, squelch }
  err = "";
const same = (a, b) => a && b && a.freq == b.freq && a.mode == b.mode && a.squelch == b.squelch;
function stop() {
  if (!proc) return;
  try {
    process.kill(-proc.pid, "SIGTERM"); // the whole rtl_fm | sox pipeline
  } catch {}
  proc = cur = null;
  console.log("radio OFF");
}
function start(w) {
  stop();
  err = "";
  const f = String(w.freq),
    // narrow FM voice by default (police / civil defence / agency channels); wide FM and AM when asked
    rate = w.mode == "wbfm" ? "170k" : w.mode == "am" ? "12k" : "12k",
    cmd = `${RTL_FM} -d ${DEV} -f ${f}M -M ${w.mode} -s ${rate} -r 16k -l ${w.squelch} -E dc - | ${SOX} -t raw -r 16k -e signed -b 16 -c 1 - "ch${f}_.wav" silence 1 0.2 1% 1 1.5 1% : newfile : restart`;
  proc = spawn("sh", ["-c", cmd], { cwd: DIR, detached: true, stdio: ["ignore", "ignore", "pipe"] });
  proc.stderr.on("data", (d) => {
    const t = String(d);
    if (/usb_claim_interface|No supported devices|Failed to open/i.test(t)) err = "SDR dongle not found or busy";
  });
  const me = proc;
  proc.on("exit", (code) => {
    if (proc === me) {
      proc = cur = null;
      err = err || "radio stopped (code " + code + ")";
      console.log(err);
    }
  });
  cur = { freq: w.freq, mode: w.mode, squelch: w.squelch };
  console.log("radio ON", f, "MHz", w.mode, "squelch", w.squelch);
}
async function tick() {
  try {
    const qs = new URLSearchParams({ freq: cur ? cur.freq : "", running: proc ? "1" : "0", error: err });
    const r = await fetch(SERVER + "/api/radio/gateway/control?" + qs, { headers: { "X-Gateway-Key": GATEWAY_KEY } });
    if (!r.ok) throw new Error("HTTP " + r.status + " " + (await r.text()));
    const w = await r.json();
    if (!w.power || w.freq == null) stop();
    else if (!proc || !same(cur, w)) start(w);
  } catch (e) {
    console.log("cannot reach the server:", e.message); // keep doing what it was told last
  }
}
const shutdown = () => {
  stop();
  fwd.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
tick();
setInterval(tick, +POLL_MS);
console.log("Listening post ready: waiting for the dashboard's on/off and tuning ->", SERVER);
