// RFC 6238 TOTP (30 s, 6 digits, SHA-1) - works with Google Authenticator, Microsoft Authenticator, Authy.
const crypto = require("crypto");
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const secret = () => Array.from(crypto.randomBytes(20), (b) => B32[b & 31]).join("");
function b32dec(s) {
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, "0");
  return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
}
function code(sec, step) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", b32dec(sec)).update(b).digest(),
    o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}
// accepts the current code and one step either side (clock drift)
const verify = (sec, c) => {
  const s = Math.floor(Date.now() / 30000);
  return !!sec && /^\d{6}$/.test(String(c || "")) && [-1, 0, 1].some((d) => code(sec, s + d) == c);
};
const uri = (sec, label, issuer) =>
  `otpauth://totp/${encodeURIComponent(issuer + ":" + label)}?secret=${sec}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
module.exports = { secret, verify, code, uri };
