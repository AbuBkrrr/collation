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
  crypto = require("crypto"),
  { WebSocketServer } = require("ws");
const E = process.env,
  PORT = +E.PORT || 3000,
  SECRET = E.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  DATA = path.resolve(E.DATA_DIR || "./data");
const PARTIES = (E.PARTIES || "APC,PDP,NNPP,ADC,NDC,LP,SDP,APGA,YPP,AA").split(",").map((s) => s.trim());
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
  connectionString: E.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/collation",
});
const q = (s, a) => pool.query(s, a).then((r) => r.rows);
const rnd = (n) => {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(n), (b) => c[b % c.length]).join("");
};
const abbr = (s) => (s == "FCT" ? "FC" : String(s).slice(0, 2).toUpperCase());
const aud = (w, a, tn) => {
  const st = als.getStore();
  return q(
    "insert into audit(who,action,tenant) values($1,$2,coalesce($3,(select tenant from rooms where id=$1),(select r.tenant from observers o join rooms r on r.id=o.room_id where o.code=$1)))",
    [w == "CMD" && st?.name ? "CMD:" + st.name : w, a, tn || st?.tn || null],
  );
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
create table if not exists cmd_users(id serial primary key,name text unique,pass_hash text,active bool default true);
create table if not exists radio_keys(room_id text primary key,key_hash text);
create table if not exists tenants(id text primary key,name text,active bool default true);
alter table cmd_users add column if not exists tenant text,add column if not exists su bool default false;
alter table rooms add column if not exists tenant text;alter table contacts add column if not exists tenant text;alter table messages add column if not exists tenant text;alter table audit add column if not exists tenant text;
alter table radio add column if not exists freq text,add column if not exists talkgroup text,add column if not exists unit text,add column if not exists audio_path text,add column if not exists code text;`;
const app = express();
app.set("trust proxy", 1);
app.use(
  express.json({
    limit: "1mb",
    type: (req) =>
      !req.url.startsWith("/api/locations/import") && /json/.test(req.headers["content-type"] || ""),
  }),
);
app.use(express.text({ type: "text/csv", limit: "100mb" }));
const lim = {};
const rate = (req, res, next) => {
  const k = req.ip,
    n = Date.now();
  lim[k] = (lim[k] || []).filter((t) => n - t < 60000);
  if (lim[k].length >= 15) return res.status(429).json({ error: "Too many attempts, wait a minute" });
  lim[k].push(n);
  next();
};
const auth =
  (...roles) =>
  async (req, res, next) => {
    try {
      const t = (req.headers.authorization || "").slice(7) || req.query.t,
        u = jwt.verify(t, SECRET);
      if (roles.length && !roles.includes(u.role)) return res.status(403).json({ error: "Forbidden" });
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
        als.enterWith({ name: u.name, tn: u.tn });
      }
      if (u.role == "room") {
        const [r] = await q("update rooms set last_seen=now() where id=$1 returning status,tenant", [u.id]);
        if (!r || r.status != "active") return res.status(401).json({ error: "Room not active" });
        u.tn = r.tenant;
      }
      if (u.role == "obs") {
        const [o] = await q(
          "select o.active,r.status,r.tenant from observers o join rooms r on r.id=o.room_id where code=$1",
          [u.id],
        );
        if (!o || !o.active || o.status != "active") return res.status(401).json({ error: "Access revoked" });
        u.tn = o.tenant;
      }
      req.u = u;
      next();
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
const bus = { notify: () => {} };
app.use("/api", (req, res, next) => {
  if (req.method != "GET") res.on("finish", () => bus.notify(req.u && req.u.tn));
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
const appName = async (tn) =>
  (tn && (await getS("app_name:" + tn))) || (await getS("app_name")) || E.APP_NAME || "My Collation Center";
const clean = (v) => (v == null ? null : String(v).slice(0, 40));
module.exports = {LK,als,express,jwt,bcrypt,http,https,fs,path,crypto,E,PORT,SECRET,DATA,PARTIES,STATES,pool,q,rnd,abbr,aud,h,SCHEMA,app,rate,auth,su,own,mine,tnOf,cfgTenant,roomScope,getS,setS,appName,clean,bus};
