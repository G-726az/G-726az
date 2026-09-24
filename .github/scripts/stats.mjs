// Genera stats/estadisticas.svg y stats/visitas.svg con datos reales de GitHub.
import fs from 'node:fs';

const USER = process.env.GH_USER || 'G-726az';
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = 'stats';
const META = `${OUT}/meta.json`;
fs.mkdirSync(OUT, { recursive: true });
const meta = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, 'utf8')) : { fetches: 0, visits: 0 };

// ---------- Datos ----------
async function gql(query, variables) {
  const r = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors));
  return j.data;
}

async function getData() {
  if (process.env.MOCK) return JSON.parse(fs.readFileSync(process.env.MOCK, 'utf8'));
  const d = await gql(`query($login:String!){ user(login:$login){
    followers{totalCount}
    privados: repositories(ownerAffiliations:OWNER, privacy:PRIVATE){ totalCount }
    contributionsCollection{
      totalCommitContributions totalPullRequestContributions
      contributionCalendar{ totalContributions weeks{ contributionDays{ contributionCount date } } }
    }
    repositories(ownerAffiliations:OWNER, isFork:false, first:100){
      totalCount
      nodes{ stargazerCount }
    }
    todos: repositories(ownerAffiliations:[OWNER, COLLABORATOR, ORGANIZATION_MEMBER], isFork:false, first:100){
      nodes{ languages(first:10, orderBy:{field:SIZE,direction:DESC}){ totalSize edges{ size node{ name color } } } }
    }
  }}`, { login: USER });
  const u = d.user;
  const days = u.contributionsCollection.contributionCalendar.weeks.flatMap(w => w.contributionDays);
  const langs = {};
  // Cada proyecto pesa lo mismo: se suma el % de cada lenguaje dentro de su repo.
  // Así un frontend en Angular/React cuenta igual que un backend grande en Java.
  const IGNORAR = new Set(['Procfile', 'Dockerfile', 'Batchfile', 'Makefile', 'PowerShell']);
  for (const repo of u.todos.nodes) {
    const edges = repo.languages.edges.filter(e => !IGNORAR.has(e.node.name));
    const tot = edges.reduce((a, e) => a + e.size, 0);
    if (!tot) continue;
    for (const e of edges) {
      langs[e.node.name] ??= { size: 0, color: e.node.color || '#8b93b3' };
      langs[e.node.name].size += e.size / tot;
    }
  }
  return {
    total: u.contributionsCollection.contributionCalendar.totalContributions,
    commits: u.contributionsCollection.totalCommitContributions,
    prs: u.contributionsCollection.totalPullRequestContributions,
    repos: u.repositories.totalCount,
    privados: u.privados.totalCount,
    stars: u.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0),
    followers: u.followers.totalCount,
    days, langs,
  };
}

// Visitas: el README carga un píxel invisible de hits.sh que cuenta cada visita.
// Aquí leemos ese contador y restamos las lecturas que hizo la propia Action.
async function getVisits() {
  if (process.env.MOCK) return 13;
  try {
    const r = await fetch(`https://hits.sh/github.com/${USER}.svg?label=v`);
    const svg = await r.text();
    const nums = [...svg.matchAll(/>\s*([\d,.]+)\s*</g)].map(m => parseInt(m[1].replace(/[,.]/g, ''), 10)).filter(n => !isNaN(n));
    meta.fetches += 1;
    if (nums.length) meta.visits = Math.max(meta.visits, nums[nums.length - 1] - meta.fetches + (meta.base ?? 13));
  } catch (e) { console.log('No se pudo leer visitas:', e.message); }
  return meta.visits;
}

// ---------- Utilidades de dibujo ----------
const FONT = `'Segoe UI',Ubuntu,'Helvetica Neue',sans-serif`;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

let CLIP = 0;
// Número tipo odómetro: cada dígito gira hasta su valor.
function odometer(num, x, y, size, color, delay = 0, anchor = 'middle') {
  const s = String(num);
  const dw = size * 0.62, h = size * 1.2;
  const w = s.length * dw;
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  let out = '';
  [...s].forEach((ch, i) => {
    const d = +ch;
    const seq = [...Array(10).keys(), ...Array(d + 1).keys()]; // gira una vuelta completa y para en d
    const id = `c${++CLIP}`;
    const cx = x0 + i * dw;
    out += `<clipPath id="${id}"><rect x="${cx - 2}" y="${y - size * 0.8}" width="${dw + 4}" height="${size * 0.95}"/></clipPath>
<g clip-path="url(#${id})"><g class="odo" style="--to:${-(seq.length - 1) * h}px;animation-delay:${(delay + i * 0.12).toFixed(2)}s">
${seq.map((n, k) => `<text x="${cx + dw / 2}" y="${y + k * h}" text-anchor="middle" style="font:800 ${size}px ${FONT};fill:${color}">${n}</text>`).join('')}
</g></g>`;
  });
  return out;
}

function streaks(days) {
  const today = new Date().toISOString().slice(0, 10);
  let cur = 0, best = 0, run = 0;
  for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; best = Math.max(best, run); }
  // racha actual: contar hacia atrás (si hoy aún no hay contribución, empieza desde ayer)
  const rev = [...days].reverse();
  let i = rev[0] && rev[0].date === today && rev[0].contributionCount === 0 ? 1 : 0;
  for (; i < rev.length && rev[i].contributionCount > 0; i++) cur++;
  return { cur, best };
}

// ---------- Tarjeta de estadísticas ----------
function statsSVG(D) {
  const W = 860, H = 470;
  const { cur, best } = streaks(D.days);
  const kpis = [
    { label: 'Contribuciones', sub: 'último año', v: D.total, c: '#5ce1e6', icon: 'M4 18h16M6 15V9m4 6V5m4 10v-4m4 4V7' },
    { label: 'Commits', sub: 'último año', v: D.commits, c: '#7aa2f7', icon: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM2 12h6m8 0h6' },
    { label: 'Repositorios', sub: D.privados ? `${D.privados} privados` : 'públicos', v: D.repos, c: '#bb9af7', icon: 'M5 4h11l3 3v13H5zM9 4v5h6' },
    { label: 'Racha actual', sub: `máxima: ${best} días`, v: cur, c: '#ff9e64', icon: 'M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 1 1 2 2 3 2 0-2 0-4 0-6z' },
  ];
  const tw = 196, gap = 12, tx0 = (W - (4 * tw + 3 * gap)) / 2;
  let tiles = '';
  kpis.forEach((k, i) => {
    const x = tx0 + i * (tw + gap), y = 22;
    tiles += `<g class="up" style="animation-delay:${i * 0.12}s">
<rect x="${x}" y="${y}" width="${tw}" height="112" rx="14" fill="#24283b" stroke="#2f3549"/>
<rect x="${x}" y="${y}" width="${tw}" height="3" rx="1.5" fill="${k.c}" class="bar-top" style="animation-delay:${0.3 + i * 0.12}s"/>
<g transform="translate(${x + 16},${y + 16})" class="pulse" style="animation-delay:${i * 0.4}s"><circle cx="12" cy="12" r="15" fill="${k.c}" opacity=".15"/>
<path d="${k.icon}" fill="none" stroke="${k.c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>
<text x="${x + 52}" y="${y + 29}" style="font:600 13px ${FONT};fill:#c0caf5">${k.label}</text>
${odometer(k.v, x + 18, y + 84, 34, k.c, 0.4 + i * 0.15, 'start')}
<text x="${x + tw - 14}" y="${y + 96}" text-anchor="end" style="font:500 11px ${FONT};fill:#8b93b3">${esc(k.sub)}</text></g>`;
  });

  // --- Barras: contribuciones por semana (últimas 26 semanas)
  const weeks = [];
  for (let i = 0; i < D.days.length; i += 7) weeks.push(D.days.slice(i, i + 7));
  const last = weeks.slice(-26).map(w => ({ n: w.reduce((a, d) => a + d.contributionCount, 0), date: w[0].date }));
  const cx = tx0, cy = 160, cw = 480, ch = 290;
  const px = cx + 40, pw = cw - 58, py = cy + 52, ph = ch - 96;
  const max = Math.max(1, ...last.map(w => w.n));
  const bw = pw / last.length;
  let bars = '', pts = [];
  last.forEach((w, i) => {
    const bh = Math.max(2, (w.n / max) * ph);
    const x = px + i * bw + bw * 0.18, y = py + ph - bh;
    bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="url(#gb)" class="grow" style="animation-delay:${(0.6 + i * 0.04).toFixed(2)}s"/>`;
    pts.push(`${(x + bw * 0.32).toFixed(1)},${(y - 6).toFixed(1)}`);
  });
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  let labels = '';
  last.forEach((w, i) => { if (i % 6 === 0) { const d = new Date(w.date); labels += `<text x="${(px + i * bw + bw / 2).toFixed(1)}" y="${py + ph + 20}" text-anchor="middle" style="font:500 11px ${FONT};fill:#8b93b3">${months[d.getUTCMonth()]}</text>`; } });
  let grid = '';
  for (let g = 0; g <= 3; g++) { const y = py + ph - (g / 3) * ph; grid += `<line x1="${px}" x2="${px + pw}" y1="${y}" y2="${y}" stroke="#2f3549" stroke-dasharray="3 5"/><text x="${px - 8}" y="${y + 4}" text-anchor="end" style="font:500 10px ${FONT};fill:#565f89">${Math.round((g / 3) * max)}</text>`; }
  const chart = `<g class="up" style="animation-delay:.5s">
<rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="14" fill="#24283b" stroke="#2f3549"/>
<text x="${cx + 18}" y="${cy + 30}" style="font:700 15px ${FONT};fill:#c0caf5">Actividad semanal</text>
<text x="${cx + cw - 18}" y="${cy + 30}" text-anchor="end" style="font:500 11px ${FONT};fill:#8b93b3">últimos 6 meses</text>
${grid}${bars}
<polyline points="${pts.join(' ')}" fill="none" stroke="#5ce1e6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" class="draw" pathLength="1"/>
${labels}</g>`;

  // --- Dona de lenguajes
  const lx = cx + cw + 12, lw = W - tx0 - lx, ly = cy;
  const total = Object.values(D.langs).reduce((a, l) => a + l.size, 0) || 1;
  let langs = Object.entries(D.langs).sort((a, b) => b[1].size - a[1].size);
  const keep = langs.filter(([, l], i) => i < 5 && l.size / total >= 0.02);
  const rest = langs.filter(l => !keep.includes(l)).reduce((a, l) => a + l[1].size, 0);
  langs = rest > 0 ? [...keep, ['Otros', { size: rest, color: '#565f89' }]] : keep;
  const r = 52, dcx = lx + lw / 2, dcy = ly + 118;
  let acc = 0, segs = '', legend = '';
  langs.forEach(([name, l], i) => {
    const p = (l.size / total) * 100;
    segs += `<circle cx="${dcx}" cy="${dcy}" r="${r}" fill="none" stroke="${l.color}" stroke-width="18" pathLength="100" stroke-dasharray="0 100" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 ${dcx} ${dcy})" class="seg" style="--p:${Math.max(p - 0.6, 0.1).toFixed(2)};animation-delay:${(0.8 + i * 0.18).toFixed(2)}s"/>`;
    acc += p;
    const col = i % 2, row = Math.floor(i / 2);
    const gx = lx + 20 + col * (lw - 30) / 2, gy = ly + 200 + row * 24;
    legend += `<g class="up" style="animation-delay:${(1 + i * 0.12).toFixed(2)}s"><circle cx="${gx + 5}" cy="${gy - 4}" r="5" fill="${l.color}"/><text x="${gx + 16}" y="${gy}" style="font:600 12px ${FONT};fill:#c0caf5">${esc(name)} <tspan style="fill:#8b93b3;font-weight:500">${p.toFixed(1)}%</tspan></text></g>`;
  });
  const donut = `<g class="up" style="animation-delay:.65s">
<rect x="${lx}" y="${ly}" width="${lw}" height="${ch}" rx="14" fill="#24283b" stroke="#2f3549"/>
<text x="${lx + 18}" y="${ly + 30}" style="font:700 15px ${FONT};fill:#c0caf5">Lenguajes más usados</text>
<circle cx="${dcx}" cy="${dcy}" r="${r}" fill="none" stroke="#1a1b27" stroke-width="18"/>
<g class="spin">${segs}</g>
<text x="${dcx}" y="${dcy + 2}" text-anchor="middle" style="font:800 20px ${FONT};fill:#c0caf5">${langs.length}</text>
<text x="${dcx}" y="${dcy + 18}" text-anchor="middle" style="font:500 10px ${FONT};fill:#8b93b3">lenguajes</text>
${legend}</g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><linearGradient id="gb" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#3d59a1"/><stop offset="1" stop-color="#5ce1e6"/></linearGradient></defs>
<style>
.up{opacity:0;animation:up .7s cubic-bezier(.2,.8,.2,1) forwards}
.odo{animation:odo 1.6s cubic-bezier(.15,.85,.25,1) forwards}
.grow{transform-box:fill-box;transform-origin:50% 100%;transform:scaleY(0);animation:grow .8s cubic-bezier(.2,.8,.2,1) forwards}
.draw{stroke-dasharray:1;stroke-dashoffset:1;animation:draw 2s ease-in-out 1.6s forwards}
.seg{animation:seg 1s cubic-bezier(.3,.7,.2,1) forwards}
.pulse{animation:pulse 2.6s ease-in-out infinite}
.bar-top{transform-box:fill-box;transform-origin:0 50%;transform:scaleX(0);animation:bx .9s ease-out forwards}
@keyframes up{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes odo{from{transform:translateY(0)}to{transform:translateY(var(--to))}}
@keyframes grow{to{transform:scaleY(1)}}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes seg{to{stroke-dasharray:var(--p) 100}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes bx{to{transform:scaleX(1)}}
</style>
<rect width="${W}" height="${H}" rx="18" fill="#1a1b27"/>
${tiles}${chart}${donut}
</svg>`;
}

// ---------- Botón de visitas (mismo estilo que Gmail/LinkedIn) ----------
function visitsSVG(n) {
  const W = 240, H = 60;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
 <linearGradient id="bd" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#bb9af7"/><stop offset=".5" stop-color="#5ce1e6"/><stop offset="1" stop-color="#bb9af7"/>
  <animateTransform attributeName="gradientTransform" type="translate" values="-1 0;1 0" dur="3s" repeatCount="indefinite"/></linearGradient>
 <linearGradient id="sh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
 <clipPath id="cp"><rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="28"/></clipPath>
</defs>
<style>
 .in{opacity:0;animation:in .7s cubic-bezier(.2,.8,.2,1) .1s forwards}
 .sh{animation:sweep 3.2s ease-in-out infinite}
 .glow{animation:glow 2.4s ease-in-out infinite}
 .lid{transform-box:fill-box;transform-origin:50% 50%;animation:blink 4s ease-in-out infinite}
 .pupil{animation:look 4s ease-in-out infinite}
 .odo{animation:odo 1.8s cubic-bezier(.15,.85,.25,1) .4s forwards}
 @keyframes in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
 @keyframes sweep{0%{transform:translateX(-140px)}60%,100%{transform:translateX(${W + 40}px)}}
 @keyframes glow{0%,100%{opacity:.25}50%{opacity:.7}}
 @keyframes blink{0%,44%,52%,100%{transform:scaleY(1)}48%{transform:scaleY(.1)}}
 @keyframes look{0%,20%{transform:translateX(0)}30%,45%{transform:translateX(-3px)}60%,75%{transform:translateX(3px)}90%,100%{transform:translateX(0)}}
 @keyframes odo{from{transform:translateY(0)}to{transform:translateY(var(--to))}}
</style>
<g class="in">
 <rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="28" fill="#1a1b27"/>
 <circle class="glow" cx="34" cy="30" r="20" fill="#bb9af7" opacity=".3"/>
 <g clip-path="url(#cp)"><rect class="sh" x="0" y="0" width="100" height="${H}" fill="url(#sh)" transform="skewX(-20)"/></g>
 <rect x="2" y="2" width="${W - 4}" height="${H - 4}" rx="28" fill="none" stroke="url(#bd)" stroke-width="2.5"/>
 <g class="lid"><path d="M20 30c4-7 9-10 14-10s10 3 14 10c-4 7-9 10-14 10s-10-3-14-10z" fill="#e6edf3"/>
 <g class="pupil"><circle cx="34" cy="30" r="5.5" fill="#5ce1e6"/><circle cx="34" cy="30" r="2.6" fill="#1a1b27"/><circle cx="35.6" cy="28.4" r="1.2" fill="#fff"/></g></g>
 <text x="62" y="28" style="font:700 17px ${FONT};fill:#e6edf3;letter-spacing:.4px">Visitas</text>
 <text x="62" y="44" style="font:500 11.5px ${FONT};fill:#8b93b3">al perfil</text>
 ${odometer(n, W - 24, 38, 22, '#5ce1e6', 0.4, 'end')}
</g></svg>`;
}

const D = await getData();
fs.writeFileSync(`${OUT}/estadisticas.svg`, statsSVG(D));
const v = await getVisits();
fs.writeFileSync(`${OUT}/visitas.svg`, visitsSVG(v));
fs.writeFileSync(META, JSON.stringify(meta, null, 2));
console.log('Listo:', { ...D, days: D.days.length, visits: v, token: process.env.GITHUB_TOKEN?.startsWith('ghp_') ? 'STATS_TOKEN (incluye privados)' : 'automático (solo públicos)' });
