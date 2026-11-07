// Radio gateway: watches the folder where your SDR decoder (GopherTrunk, trunk-recorder, SDRTrunk...) saves call recordings
// and uploads each finished call to your Situation Room. No dependencies. Node 18+.
//   SERVER=https://your-domain GATEWAY_KEY=GW.SR-XX-ABC.xxxx WATCH_DIR=/path/to/recordings node forward.js
const fs=require('fs'),path=require('path'),{SERVER,GATEWAY_KEY,WATCH_DIR,REPLAY}=process.env;
if(!SERVER||!GATEWAY_KEY||!WATCH_DIR){console.error('Set SERVER, GATEWAY_KEY and WATCH_DIR');process.exit(1)}
const EXT=/\.(wav|mp3|ogg)$/i,seen=new Set(),MT={wav:'audio/wav',mp3:'audio/mpeg',ogg:'audio/ogg'};
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):EXT.test(e.name)?[path.join(d,e.name)]:[]);
const mhz=v=>{v=parseFloat(v);return isFinite(v)?(v>1e6?(v/1e6).toFixed(4):String(v)):''};
function meta(f){let m={};try{const j=JSON.parse(fs.readFileSync(f.replace(EXT,'.json'),'utf8'));m.freq=j.freq??j.frequency;m.tg=j.talkgroup??j.tg;m.unit=j.srcList?.[0]?.src??j.source??j.unit;m.dur=j.call_length}catch{}
 const n=path.basename(f);m.freq=m.freq??(n.match(/(\d{3}\.\d{3,6})/)||[])[1];m.tg=m.tg??(n.match(/(?:tg|talkgroup)[_-]?(\d+)/i)||[])[1];return m}
async function up(f){const m=meta(f),qs=new URLSearchParams({freq:mhz(m.freq),tg:m.tg??'',unit:m.unit??'',dur:m.dur??''});
 const r=await fetch(SERVER+'/api/radio/audio?'+qs,{method:'POST',headers:{'X-Gateway-Key':GATEWAY_KEY,'Content-Type':MT[f.split('.').pop().toLowerCase()]},body:fs.readFileSync(f)});if(!r.ok)throw new Error('HTTP '+r.status+' '+await r.text())}
if(!REPLAY)walk(WATCH_DIR).forEach(f=>seen.add(f));
setInterval(async()=>{for(const f of walk(WATCH_DIR)){if(seen.has(f))continue;const s=fs.statSync(f);if(!s.size||Date.now()-s.mtimeMs<2500)continue;seen.add(f);try{await up(f);console.log('uploaded',path.basename(f))}catch(e){seen.delete(f);console.log('retry later:',path.basename(f),e.message)}}},3000);
console.log('Watching',WATCH_DIR,'->',SERVER);
