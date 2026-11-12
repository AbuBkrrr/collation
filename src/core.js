const LK = (() => {
  try {
    return require("livekit-server-sdk");
  } catch {
    return null;
  }
})();
const { AsyncLocalStorage } = require("async_hooks"),
  als = new AsyncLocalStorage();
const express = require("express"),
  { Pool } = require("pg"),
  jwt = require("jsonwebtoken"),
  bcrypt = require("bcryptjs"),
  http = require("http"),
  https = require("https"),
  fs = require("fs"),
  path = require("path"),
  crypto = require("crypto");
const E = process.env,
  PORT = +E.PORT || 3000,
  DATA = path.resolve(E.DATA_DIR || "./data");
fs.mkdirSync(DATA, { recursive: true });
// JWT secret: env, else a random secret persisted on this PC so restarts keep sessions valid
const SECRET =
  E.JWT_SECRET ||
  (() => {
    const f = path.join(DATA, ".jwt_secret");
    if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString("hex"), { mode: 0o600 });
    return fs.readFileSync(f, "utf8").trim();
  })();
// A guessable JWT secret lets anyone forge a token and mint any session. If JWT_SECRET is set, it must
// be long and not an obvious placeholder. In production (NODE_ENV=production or a DOMAIN set) this is
// fatal; in dev/test it only warns. Leave JWT_SECRET unset to auto-generate a strong one.
if (E.JWT_SECRET && (E.JWT_SECRET.length < 24 || /change|changeme|example|placeholder|your-?secret/i.test(E.JWT_SECRET))) {
  const msg =
    "JWT_SECRET is weak or a placeholder. Set a long random value (openssl rand -hex 32) or leave it unset to auto-generate one.";
  if (E.NODE_ENV === "production" || E.DOMAIN) {
    console.error("FATAL: " + msg);
    process.exit(1);
  } else console.warn("WARNING: " + msg);
}
// Mockup order first, then the other registered parties. Override with PARTIES=... (comma separated codes).
const PARTIES = (E.PARTIES || "APC,PDP,NNPP,ADC,NDC,LP,SDP,APGA,YPP,AA,A,AAC,ADP,APM,APP,BP,NRM,PRP,YP,ZLP")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const STATES = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "FCT",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
];
const pool = new Pool({
  max: +E.PG_POOL || 40,
  connectionString: E.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/collation",
});
// qsys: system query (owner role, bypasses row-level security) - logins, boot, platform admin, jobs.
const qsys = (s, a) => pool.query(s, a).then((r) => r.rows);
// qx/q: inside an authenticated request the query runs as the restricted role "collation_app" with the
// caller's Command Center (and room) set, so PostgreSQL row-level security enforces isolation as a
// second wall behind the per-route checks.
async function qx(s, a) {
  const st = als.getStore();
  if (!st || !st.tn) return pool.query(s, a);
  const c = await pool.connect();
  try {
    await c.query(
      "begin; set local role collation_app; select set_config('app.tenant'," +
        c.escapeLiteral(st.tn) +
        ",true),set_config('app.room'," +
        c.escapeLiteral(st.room || "") +
        ",true)",
    );
    const r = await c.query(s, a);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
const q = (s, a) => qx(s, a).then((r) => r.rows);
const rnd = (n) => {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(n), (b) => c[b % c.length]).join("");
};
// INEC two-letter state codes (unique: Kano KN, Kaduna KD, Katsina KT, Kebbi KB ...)
const SCODE = { Abia: "AB", Adamawa: "AD", "Akwa Ibom": "AK", Anambra: "AN", Bauchi: "BA", Bayelsa: "BY", Benue: "BE", Borno: "BO", "Cross River": "CR", Delta: "DE", Ebonyi: "EB", Edo: "ED", Ekiti: "EK", Enugu: "EN", FCT: "FC", Gombe: "GO", Imo: "IM", Jigawa: "JI", Kaduna: "KD", Kano: "KN", Katsina: "KT", Kebbi: "KB", Kogi: "KG", Kwara: "KW", Lagos: "LA", Nasarawa: "NA", Niger: "NI", Ogun: "OG", Ondo: "ON", Osun: "OS", Oyo: "OY", Plateau: "PL", Rivers: "RI", Sokoto: "SO", Taraba: "TA", Yobe: "YO", Zamfara: "ZA" };
const abbr = (s) => SCODE[s] || String(s).slice(0, 2).toUpperCase();
const aud = (w, a, tn) => {
  const st = als.getStore();
  return q(
    "insert into audit(who,action,tenant) values($1,$2,coalesce($3,(select tenant from rooms where id=$1),(select r.tenant from observers o join rooms r on r.id=o.room_id where o.code=$1)))",
    [w == "CMD" && st?.name ? "CMD:" + st.name : w, a, tn || st?.tn || null],
  ).catch((e) => console.error("audit log failed:", e.message)); // a failed log entry must never take the server down
};
const h = (f) => (req, res) =>
  f(req, res).catch((e) => {
    console.error(e);
    res.status(500).json({ error: e.message });
  });
const SCHEMA = `create table if not exists settings(k text primary key,v text);
create table if not exists rooms(id text primary key,name text,state text,scope text,operator text,pass_hash text,status text default 'inactive',activated_at timestamptz,last_seen timestamptz);
create table if not exists observers(code text primary key,room_id text references rooms(id),name text,state text,lga text,ward text,pu text,reg int default 500,active bool default true,lat float8,lng float8,seen timestamptz,streaming bool default false);
create table if not exists tallies(code text references observers(code),party text,v int,edits int default 0,hist jsonb default '[]',primary key(code,party));
create table if not exists incidents(id serial primary key,code text,room_id text,lga text,pu text,lat float8,lng float8,type text,note text,status text default 'new',unit text,ts timestamptz default now());
create table if not exists messages(id serial primary key,from_id text,to_scope text,text text,cmd text,ts timestamptz default now(),ack jsonb default '[]');
create table if not exists contacts(id serial primary key,room_id text,name text,phone text,role text,level text,state text,loc text);
create table if not exists audit(id serial primary key,ts timestamptz default now(),who text,action text);
create table if not exists units(id serial primary key,room_id text,name text,lat float8,lng float8,st text default 'free');
create table if not exists clips(id serial primary key,code text,room_id text,kind text,path text,ts timestamptz default now());
create table if not exists radio(id serial primary key,room_id text,ts timestamptz default now(),text text,alert bool default false);
create table if not exists locations(state text,lga text,ward text,pu text,reg int);
create index if not exists loc_i on locations(state,lga,ward);
alter table locations add column if not exists name text;alter table observers add column if not exists pu_name text;alter table observers add column if not exists pend int default 0;
create table if not exists officers(id serial primary key,tenant text,level text,name text,phone text,state text,lga text,ward text,code text unique,pass_hash text,active bool default true,seen timestamptz,ts timestamptz default now());
create table if not exists officer_confirms(id serial primary key,tenant text,officer_id int references officers(id) on delete cascade,ckey text,act text,fig jsonb,orig jsonb,ts timestamptz default now(),unique(officer_id,ckey));
create table if not exists officer_manual(id serial primary key,tenant text,officer_id int references officers(id) on delete cascade,area text,fig jsonb,boxes int,note text,revs int default 0,ts timestamptz default now(),unique(officer_id,area));
alter table officers add column if not exists pass_enc text;
alter table rooms add column if not exists pass_enc text;
create table if not exists cmd_users(id serial primary key,name text unique,pass_hash text,active bool default true);
alter table cmd_users add column if not exists pass_enc text;
create table if not exists radio_keys(room_id text primary key,key_hash text);
create table if not exists tenants(id text primary key,name text,active bool default true);
alter table tenants add column if not exists state text;
alter table cmd_users add column if not exists tenant text,add column if not exists su bool default false;
alter table rooms add column if not exists tenant text;alter table contacts add column if not exists tenant text;alter table messages add column if not exists tenant text;alter table audit add column if not exists tenant text;
alter table radio add column if not exists freq text,add column if not exists talkgroup text,add column if not exists unit text,add column if not exists audio_path text,add column if not exists code text;
alter table observers add column if not exists device_hash text,add column if not exists pin_hash text,add column if not exists live_req bool default false;
alter table cmd_users add column if not exists totp text,add column if not exists totp_pending text;
create table if not exists pu_results(room_id text references rooms(id),state text,lga text,ward text,pu text,final jsonb,by_who text,note text,src text,ts timestamptz default now(),primary key(room_id,state,lga,ward,pu));
create table if not exists ec8a(id serial primary key,code text,room_id text,state text,lga text,ward text,pu text,path text,sha256 text,ts timestamptz default now());
create index if not exists obs_room_i on observers(room_id);create index if not exists obs_pu_i on observers(state,lga,ward,pu);
create index if not exists tal_code_i on tallies(code);create index if not exists inc_room_i on incidents(room_id);
create index if not exists clip_room_i on clips(room_id);create index if not exists radio_room_i on radio(room_id,id);
create index if not exists msg_tn_i on messages(tenant,id);create index if not exists aud_tn_i on audit(tenant,id);
create index if not exists ec8a_room_i on ec8a(room_id,state,lga,ward,pu);
alter table observers add column if not exists acc float8,add column if not exists ec_reg int,add column if not exists ec_acc int;
alter table radio add column if not exists source text,add column if not exists system text;
create table if not exists pitch_views(id serial primary key,ts timestamptz default now(),ref text,device text,os text,browser text,ua text,referrer text,screen text,tz text,iph text);
create index if not exists pitch_ts on pitch_views(ts);
create table if not exists pitch_leads(id serial primary key,ts timestamptz default now(),ref text,name text,phone text,org text,note text,device text,os text,browser text,iph text);
create index if not exists pitch_leads_ts on pitch_leads(ts);
create table if not exists shares(token text primary key,tenant text,room_id text,label text,pass_hash text,codes text[],talkback bool default false,active bool default true,created_by text,created_at timestamptz default now(),expires_at timestamptz);
create index if not exists shares_tn on shares(tenant);
alter table tenants add column if not exists pool bool default true;
alter table rooms add column if not exists kind text;
alter table tenants add column if not exists archived bool default false;alter table rooms add column if not exists archived bool default false;
alter table pitch_views add column if not exists vid text,add column if not exists dsig text;alter table pitch_leads add column if not exists vid text;
create table if not exists radio_ctl(room_id text primary key references rooms(id),power bool default false,freq float8,mode text default 'fm',squelch int default 40,presets jsonb default '[]',updated_at timestamptz default now(),updated_by text,gw_seen timestamptz,gw_status jsonb);`;
// Row-level security: applied to the restricted role used inside authenticated requests.
const RLS = `do $$ begin if not exists(select 1 from pg_roles where rolname='collation_app') then create role collation_app nologin; end if; end $$;
do $$ begin execute format('grant collation_app to %I', current_user); exception when others then null; end $$;
grant usage on schema public to collation_app;
grant select,insert,update,delete on all tables in schema public to collation_app;
grant usage,select on all sequences in schema public to collation_app;
create or replace function app_tn() returns text language sql stable as $f$ select nullif(current_setting('app.tenant',true),'') $f$;
create or replace function app_room() returns text language sql stable as $f$ select nullif(current_setting('app.room',true),'') $f$;
${[
  ["rooms", "tenant=app_tn() and (app_room() is null or id=app_room())"],
  ["tenants", "id=app_tn()"],
  // per-Command-Center settings are keyed "name:TENANT"; platform-wide ones have no colon
  ["settings", "k !~ ':' or split_part(k,':',2)=coalesce(app_tn(),'')"],
  ["officers", "tenant=app_tn()"],
  ["officer_confirms", "tenant=app_tn()"],
  ["officer_manual", "tenant=app_tn()"],
  ["cmd_users", "tenant=app_tn()"],
  ["messages", "tenant=app_tn()"],
  ["audit", "tenant=app_tn()"],
  ["shares", "tenant=app_tn() and (app_room() is null or room_id=app_room())"],
  ["contacts", "tenant=app_tn() and (app_room() is null or room_id is null or room_id=app_room())"],
  ...["observers", "incidents", "units", "clips", "radio", "radio_keys", "radio_ctl", "pu_results", "ec8a"].map((t) => [
    t,
    "room_id in (select id from rooms)",
  ]),
  ["tallies", "code in (select code from observers)"],
]
  .map(
    ([t, p]) =>
      `alter table ${t} enable row level security;drop policy if exists iso on ${t};create policy iso on ${t} to collation_app using (${p}) with check (${p});`,
  )
  .join("\n")}`;
const app = express();
app.use(require("compression")());
app.set("trust proxy", 1);
app.use(
  express.json({
    limit: "1mb",
    type: (req) =>
      !req.url.startsWith("/api/locations/import") && /json/.test(req.headers["content-type"] || ""),
  }),
);
// only the location import takes a big CSV; no other (or unauthenticated) route may make the server buffer 100 MB
app.use("/api/locations/import", express.text({ type: "text/csv", limit: "100mb" }));
// CORS for the Android app (Capacitor serves the bundled observer app from https://localhost) and any extra
// origins in CORS_ORIGINS. Auth is a bearer token (no cookies), so this exposes nothing without a login.
const ORIGINS = new Set(["https://localhost", "capacitor://localhost", "http://localhost", ...String(E.CORS_ORIGINS || "").split(",").map((x) => x.trim()).filter(Boolean)]);
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && ORIGINS.has(o)) {
    res.set({
      "Access-Control-Allow-Origin": o,
      Vary: "Origin",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Gateway-Key",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Max-Age": "86400",
    });
    if (req.method == "OPTIONS") return res.sendStatus(204);
  }
  next();
});
app.disable("x-powered-by"); // don't advertise the framework
// Content-Security-Policy. Scripts/styles load only from our own origin (an injected <script src=evil>
// is blocked), framing/objects/base-tag/forms are locked down, and the few external needs are named:
// map tiles (img https:), Google Fonts (pitch page), LiveKit/WS (connect wss:), the Vosk worker (blob:).
// Inline scripts/handlers and inline styles are used throughout the UI, so those keep 'unsafe-inline';
// user-supplied text is still HTML-escaped at render. Override or relax with CSP=... / CSP_OFF=1.
const CSP =
  E.CSP ||
  [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self' https://wa.me https://api.whatsapp.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:", // wasm-unsafe-eval: Vosk offline STT (WebAssembly)
    "worker-src 'self' blob:",
    "connect-src 'self' https: wss:",
    "frame-src 'self'",
  ].join("; ");
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "same-origin",
    "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(self)",
    "Cross-Origin-Opener-Policy": "same-origin",
  });
  if (!E.CSP_OFF) res.set("Content-Security-Policy", CSP);
  // HSTS once we're on HTTPS (ignored by browsers over plain HTTP, but only send it when secure)
  if (req.secure || req.headers["x-forwarded-proto"] === "https")
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
  next();
});
// Login rate limit: 15 attempts/min per IP and 8 per account (code / operator / room id).
const lim = new Map();
const hit = (k, max, win) => {
  const n = Date.now(),
    a = (lim.get(k) || []).filter((t) => n - t < win);
  a.push(n);
  lim.set(k, a);
  return a.length > max;
};
setInterval(() => {
  const n = Date.now();
  for (const [k, a] of lim) if (!a.length || n - a[a.length - 1] > 900000) lim.delete(k);
}, 60000).unref();
// counts FAILED attempts only, so many observers behind one mobile-carrier IP are not blocked
const rate = (req, res, next) => {
  const acct = String(req.body?.code || req.body?.user || req.body?.id || "").toUpperCase(),
    n = Date.now(),
    cnt = (k, win) => (lim.get(k) || []).filter((t) => n - t < win).length;
  if (cnt("ip:" + req.ip, 60000) >= 60 || (acct && cnt("ac:" + acct, 300000) >= 8))
    return res.status(429).json({ error: "Too many failed attempts, wait a few minutes" });
  res.on("finish", () => {
    if (res.statusCode == 401 || res.statusCode == 403) {
      hit("ip:" + req.ip, 1e9, 60000);
      if (acct) hit("ac:" + acct, 1e9, 300000);
    }
  });
  next();
};
const auth =
  (...roles) =>
  async (req, res, next) => {
    try {
      const t = (req.headers.authorization || "").slice(7) || req.query.t,
        u = jwt.verify(t, SECRET);
      if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: "Forbidden" });
      // a route open to "any signed-in user" means Command Center / Situation Room / Observer; an officer must be named explicitly
      if (!roles.length && u.role == "officer") return res.status(403).json({ error: "Forbidden" });
      if (u.role == "cmd") {
        u.name = u.name || "admin";
        const [c] = await q(
          "select c.active,c.su,c.tenant,t.active ta from cmd_users c join tenants t on t.id=c.tenant where lower(c.name)=lower($1)",
          [u.name],
        );
        if (!c || !c.active || !c.ta)
          return res.status(401).json({ error: "Operator or Command Center disabled" });
        u.tn = c.tenant;
        u.su = c.su;
      }
      if (u.role == "room") {
        // "last seen" is a presence indicator: refresh it at most every 20 s instead of writing a row on every request
        const [r] = await q("select status,tenant,(last_seen is null or last_seen < now() - interval '20 seconds') stale from rooms where id=$1", [u.id]);
        if (r?.stale) q("update rooms set last_seen=now() where id=$1", [u.id]).catch(() => {});
        if (!r || r.status != "active") return res.status(401).json({ error: "Room not active" });
        u.tn = r.tenant;
        u.room = u.id;
      }
      if (u.role == "obs") {
        const [o] = await q(
          "select o.active,o.device_hash,o.room_id,r.status,r.tenant from observers o join rooms r on r.id=o.room_id where code=$1",
          [u.id],
        );
        if (!o || !o.active || o.status != "active") return res.status(401).json({ error: "Access revoked" });
        // a device reset by the room ends sessions on the old phone
        if (!u.dh || !o.device_hash || !o.device_hash.startsWith(u.dh))
          return res.status(401).json({ error: "Session ended: this code was reset to another device" });
        u.room = o.room_id;
        u.tn = o.tenant;
      }
      if (u.role == "officer") {
        const [o] = await q("select o.*,t.active ta from officers o join tenants t on t.id=o.tenant where o.id=$1", [u.id]);
        if (!o || !o.active || !o.ta) return res.status(401).json({ error: "Access revoked" });
        u.tn = o.tenant;
        u.off = o;
        u.name = o.name || o.code;
      }
      req.u = u;
      als.run({ name: u.name, tn: u.tn, room: u.role == "cmd" ? "" : u.room }, () => next());
    } catch (e) {
      res.status(401).json({ error: "Unauthorized" });
    }
  };
const su = (req, res, next) =>
  req.u.su ? next() : res.status(403).json({ error: "Platform administrator only" });
const own = async (u, code) => {
  const [o] = await q("select o.*,r.tenant from observers o join rooms r on r.id=o.room_id where o.code=$1", [
    code,
  ]);
  return o &&
    ((u.role == "cmd" && o.tenant == u.tn) ||
      (u.role == "room" && o.room_id == u.id) ||
      (u.role == "obs" && o.code == u.id))
    ? o
    : null;
};
const mine = async (u, rid) =>
  (await q("select 1 from rooms where id=$1 and tenant=$2", [rid, u.tn])).length > 0;
const tnOf = async (u) =>
  u.role == "cmd"
    ? (await q("select tenant from cmd_users where lower(name)=lower($1)", [u.name || "admin"]))[0]?.tenant
    : u.role == "room"
      ? (await q("select tenant from rooms where id=$1", [u.id]))[0]?.tenant
      : (
          await q("select r.tenant from observers o join rooms r on r.id=o.room_id where o.code=$1", [u.id])
        )[0]?.tenant;
const bus = { notify: () => {}, dirty: () => {} };
app.use("/api", (req, res, next) => {
  if (req.method != "GET" && !req.path.startsWith("/observer/heartbeat"))
    res.on("finish", () => {
      if (res.statusCode >= 400) return;
      bus.dirty();
      bus.notify(req.u && req.u.tn);
    });
  next();
});
const cfgTenant = async (req) => {
  try {
    return await tnOf(jwt.verify((req.headers.authorization || "").slice(7), SECRET));
  } catch {
    return null;
  }
};
const roomScope = (u, col = "room_id") =>
  u.role == "cmd"
    ? [" where " + col + " in (select id from rooms where tenant=$1)", [u.tn]]
    : u.role == "room"
      ? [" where " + col + "=$1", [u.id]]
      : [" where code=$1", [u.id]];
const getS = async (k) => (await q("select v from settings where k=$1", [k]))[0]?.v,
  setS = (k, v) => q("insert into settings values($1,$2) on conflict(k) do update set v=$2", [k, String(v)]);
const appName = async (tn) => {
  if (tn) {
    const own = await getS("app_name:" + tn);
    if (own) return own; // admin's custom name in App Settings
    const [t] = await qsys("select name from tenants where id=$1", [tn]);
    if (t?.name) return t.name; // the Command Center's name
  }
  return (await getS("app_name")) || E.APP_NAME || "My Collation Center"; // platform name (login screens)
};
const clean = (v) => (v == null ? null : String(v).slice(0, 40));
// Credentials the platform hands out (Command Center / room / officer passcodes) are also kept ENCRYPTED so the person
// who issued them can show the sign-in card or QR again. The sign-in check itself still uses only the bcrypt hash.
const ckey_ = crypto.createHash("sha256").update("cred-v1:" + SECRET).digest();
const seal = (p) => {
  const iv = crypto.randomBytes(12),
    c = crypto.createCipheriv("aes-256-gcm", ckey_, iv),
    enc = Buffer.concat([c.update(String(p), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64");
};
const unseal = (x) => {
  try {
    if (!x) return null;
    const b = Buffer.from(x, "base64"),
      d = crypto.createDecipheriv("aes-256-gcm", ckey_, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
};
module.exports = {seal,unseal,qsys,qx,RLS,hit,LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus};
