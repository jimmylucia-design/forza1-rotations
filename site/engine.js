// Rotation + match engine. Pure functions, no DOM.
export const ORDERS = {
  '6-2': { a: ['S1','OH1','M1','S2','OH2','M2'], b: ['S1','M1','OH1','S2','M2','OH2'] },
  '4-2': { a: ['S1','OH1','M1','S2','OH2','M2'], b: ['S1','M1','OH1','S2','M2','OH2'] },
  '5-1': { a: ['S','OH1','M1','OPP','OH2','M2'], b: ['S','M1','OH1','OPP','M2','OH2'] }
};
export const XY = {1:[80,74],2:[80,22],3:[50,22],4:[20,22],5:[20,74],6:[50,74]};
const COLX = {1:80,2:80,3:50,4:20,5:20,6:50};
export const FRONT = {2:1,3:1,4:1};
const SR62 = [
  {S2:[12,10],M1:[45,10],OH1:[80,62],OH2:[20,62],M2:[50,66],S1:[90,88]},
  {OH2:[18,60],M2:[45,68],OH1:[80,64],S1:[68,34],S2:[56,10],M1:[86,10]},
  {M2:[12,10],OH2:[25,58],S2:[86,10],OH1:[50,66],M1:[78,64],S1:[30,24]},
  {S1:[12,10],M2:[45,10],OH2:[80,62],OH1:[20,62],M1:[50,66],S2:[90,88]},
  {OH1:[18,60],M1:[45,68],OH2:[80,64],S2:[68,34],S1:[56,10],M2:[86,10]},
  {M1:[12,10],OH1:[25,58],S1:[86,10],OH2:[50,66],M2:[78,64],S2:[30,24]}
];
export const MODES = { spots: 'We serve', sr: 'We receive', switch: 'In play' };

export function blankLineup() {
  return { sys: '6-2', ord: 'a', slots: {}, libOn: false, libServes: false, libero: null, libFor: [], subs: [], custom: {} };
}
export function norm(L) { return Object.assign(blankLineup(), L || {}); }

export const codes = L => ORDERS[L.sys][L.ord];
export const at = (L, r, p) => codes(L)[(p - 1 + r) % 6];
export function posOf(L, r, code) { for (let p = 1; p <= 6; p++) if (at(L, r, p) === code) return p; return 0; }
export const isFront = (L, r, code) => !!FRONT[posOf(L, r, code)];
export function kind(L, code) {
  if (code === 'L') return 'lib';
  if (code[0] === 'X') { const s = L.subs.find(x => x.id === code); return s ? kind(L, s.for) : 'm'; }
  return code === 'OPP' ? 'opp' : code[0] === 'S' ? 's' : code.startsWith('OH') ? 'oh' : 'm';
}
export function setterOf(L, r) {
  if (L.sys === '5-1') return 'S';
  const f = isFront(L, r, 'S1');
  if (L.sys === '6-2') return f ? 'S2' : 'S1';
  return f ? 'S1' : 'S2';
}
export function roleName(L, r, code) {
  if (code === 'L') return 'Libero';
  if (code[0] === 'X') { const s = L.subs.find(x => x.id === code); return s ? roleName(L, r, s.for) : 'Sub'; }
  const k = kind(L, code), f = isFront(L, r, code);
  if (k === 's') {
    if (L.sys === '6-2') return f ? 'Front setter' : 'Setter';
    if (L.sys === '4-2') return f ? 'Setter' : 'Back setter';
    return 'Setter';
  }
  return k === 'opp' ? 'Opposite' : k === 'oh' ? 'Outside' : 'Middle';
}
export function baseRole(code) {
  if (code === 'L') return 'Libero';
  if (code[0] === 'X') return 'Sub';
  if (code === 'OPP') return 'Opposite';
  if (code[0] === 'S') return 'Setter';
  return code.startsWith('OH') ? 'Outside hitter' : 'Middle blocker';
}
export function isPasser(L, r, code) { const k = kind(L, code); return k === 'oh' || (k === 'm' && !isFront(L, r, code)); }
function switchedSpot(L, r, code) {
  const k = kind(L, code), f = isFront(L, r, code);
  if (f) return k === 'oh' ? 4 : k === 'm' ? 3 : 2;
  return k === 'oh' ? 5 : k === 'm' ? 6 : 1;
}

// Who is on the court in spot p. mode 'spots' = moment of our serve.
export function courtCode(L, r, p, mode) {
  const c = at(L, r, p);
  if (L.libOn && L.libero && !FRONT[p] && L.libFor.includes(c) && !(p === 1 && mode === 'spots' && !L.libServes)) return 'L';
  const s = L.subs.find(x => x.for === c && x.rots.includes(r) && x.player);
  return s ? s.id : c;
}
export function spotOfCode(L, r, code, mode) { for (let p = 1; p <= 6; p++) if (courtCode(L, r, p, mode) === code) return p; return 0; }
export function playerOf(L, code) {
  if (code === 'L') return L.libero;
  if (code[0] === 'X') { const s = L.subs.find(x => x.id === code); return s ? s.player : null; }
  return L.slots[code] || null;
}
export function codesOfPlayer(L, pid) {
  const out = [];
  codes(L).forEach(c => { if (L.slots[c] === pid) out.push(c); });
  if (L.libero === pid) out.push('L');
  L.subs.forEach(s => { if (s.player === pid) out.push(s.id); });
  return out;
}

function issuesFor(L, r, xyBySpot) {
  const P = {}, out = [];
  for (let p = 1; p <= 6; p++) P[p] = xyBySpot(p);
  [[4,5],[3,6],[2,1]].forEach(([a,b]) => { if (!(P[a][1] < P[b][1])) out.push([a,b,'net']); });
  [[4,3],[3,2],[5,6],[6,1]].forEach(([a,b]) => { if (!(P[a][0] < P[b][0])) out.push([a,b,'side']); });
  return out;
}
function genericSR(L, r) {
  const out = {}, cs = codes(L);
  cs.forEach(c => { const p = posOf(L, r, c), x = COLX[p]; out[c] = FRONT[p] ? (isPasser(L, r, c) ? [x, 50] : [x, 10]) : (isPasser(L, r, c) ? [x, 68] : [x, 88]); });
  const backNon = cs.filter(c => !isFront(L, r, c) && !isPasser(L, r, c));
  const frontPass = cs.filter(c => isFront(L, r, c) && isPasser(L, r, c));
  if (backNon.length === 1 && frontPass.length === 1) {
    const trial = JSON.parse(JSON.stringify(out));
    trial[frontPass[0]] = [out[backNon[0]][0], 62];
    if (!issuesFor(L, r, p => trial[at(L, r, p)]).length) return trial;
  }
  return out;
}
function defaultXY(L, r, code, mode) {
  if (mode === 'spots') return XY[posOf(L, r, code)];
  if (mode === 'switch') return XY[switchedSpot(L, r, code)];
  if (L.sys === '6-2' && L.ord === 'a') return SR62[r][code];
  return genericSR(L, r)[code];
}
export const ckey = (r, mode) => mode + '|' + r;
export function xyAt(L, r, p, mode) {
  const code = courtCode(L, r, p, mode), base = at(L, r, p), c = L.custom[ckey(r, mode)];
  return (c && (c[code] || c[base])) || defaultXY(L, r, base, mode);
}
export function edited(L, r, mode) { const c = L.custom[ckey(r, mode)]; return !!(c && Object.keys(c).length); }
export function overlaps(L, r, mode) {
  if (mode === 'switch') return [];
  return issuesFor(L, r, p => xyAt(L, r, p, mode)).map(([a, b, t]) => ({ a, b, t, ca: courtCode(L, r, a, mode), cb: courtCode(L, r, b, mode) }));
}
export function passersAt(L, r) {
  const o = [];
  for (let p = 1; p <= 6; p++) { const c = courtCode(L, r, p, 'sr'); if (c === 'L' || isPasser(L, r, at(L, r, p))) o.push({ code: c, x: xyAt(L, r, p, 'sr')[0] }); }
  return o.sort((a, b) => a.x - b.x).map(o => o.code);
}
export function subsIn(L, r, mode) {
  const o = [];
  for (let p = 1; p <= 6; p++) { const c = courtCode(L, r, p, mode); if (c !== at(L, r, p)) o.push({ p, code: c, out: at(L, r, p) }); }
  return o;
}
export const lane = x => x < 35 ? 'left' : x < 65 ? 'middle' : 'right';

// One row per rotation describing where a player is.
export function playerPlan(L, pid) {
  const rows = [];
  for (let r = 0; r < 6; r++) {
    let code = null, spot = 0;
    for (let p = 1; p <= 6; p++) { const c = courtCode(L, r, p, 'sr'); if (playerOf(L, c) === pid) { code = c; spot = p; } }
    const serveCode = courtCode(L, r, 1, 'spots');
    const serves = playerOf(L, serveCode) === pid;
    if (!code) {
      // Not on court in receive; may still serve (player serves before libero comes in)
      const own = codesOfPlayer(L, pid).find(c => c !== 'L' && c[0] !== 'X');
      const ownSpot = own ? posOf(L, r, own) : 0;
      let why = 'Bench';
      if (own) { const inC = courtCode(L, r, ownSpot, 'sr'); why = 'Off: ' + (inC === 'L' ? 'Libero' : 'Sub') + ' in'; }
      rows.push({ r, on: serves, spot: serves ? 1 : 0, code: serves ? serveCode : null, front: false, role: serves ? 'Serves, then off' : why, passes: false, serves, sets: false });
      continue;
    }
    const front = !!FRONT[spot];
    rows.push({ r, on: true, spot, code, front, role: roleName(L, r, code), passes: code === 'L' || isPasser(L, r, at(L, r, spot)), serves, sets: code === courtCode(L, r, posOf(L, r, setterOf(L, r)), 'sr') });
  }
  return rows;
}

// ---------- match ----------
export function newMatchState(opts) {
  return { toWin: opts.toWin || 2, pts: opts.pts || [25, 25, 15], sets: [{ startRot: opts.startRot || 0, startServe: opts.startServe || 'us', rallies: [] }], notes: [] };
}
export function setTarget(st, i) {
  const n = st.toWin * 2 - 1;
  return i === n - 1 ? (st.pts[2] || 15) : (st.pts[0] || 25);
}
export function deriveSet(L, set) {
  let rot = set.startRot, serving = set.startServe, us = 0, them = 0;
  const log = [];
  set.rallies.forEach((ra, i) => {
    const sc = serving === 'us' ? courtCode(L, rot, 1, 'spots') : null;
    log.push({ i, rot, serving, serverCode: sc, serverPid: sc ? playerOf(L, sc) : null, ...ra });
    if (ra.w === 'us') { us++; if (serving === 'them') { rot = (rot + 1) % 6; serving = 'us'; } }
    else { them++; serving = 'them'; }
  });
  const sc = serving === 'us' ? courtCode(L, rot, 1, 'spots') : null;
  return { us, them, rot, serving, serverCode: sc, serverPid: sc ? playerOf(L, sc) : null, log };
}
export function deriveMatch(L, st) {
  const sets = st.sets.map((s, i) => {
    const d = deriveSet(L, s), t = setTarget(st, i);
    const over = Math.max(d.us, d.them) >= t && Math.abs(d.us - d.them) >= 2;
    return { ...d, target: t, over, winner: over ? (d.us > d.them ? 'us' : 'them') : null, closed: !!s.closed };
  });
  const won = sets.filter(s => s.closed && s.winner === 'us').length;
  const lost = sets.filter(s => s.closed && s.winner === 'them').length;
  const cur = sets[sets.length - 1];
  const matchOver = won >= st.toWin || lost >= st.toWin;
  return { sets, cur, won, lost, matchOver, result: matchOver ? (won > lost ? 'W' : 'L') : null };
}
// Rotations until a pid serves for us (counting side-outs). 0 = serving now.
export function sideoutsUntilServe(L, rot, serving, pid) {
  if (serving === 'us' && playerOf(L, courtCode(L, rot, 1, 'spots')) === pid) return 0;
  for (let k = 1; k <= 6; k++) if (playerOf(L, courtCode(L, (rot + k) % 6, 1, 'spots')) === pid) return k;
  return null;
}

export const STAT_US = [['ace', 'Ace', 'server'], ['kill', 'Kill', 'pick'], ['block', 'Block', 'pick'], ['tip', 'Tip/dump', 'pick'], ['oerr', 'Their error', null]];
export const STAT_THEM = [['serr', 'Serve error', 'server'], ['herr', 'Hit error', 'pick'], ['rerr', 'Pass error', 'pick'], ['nerr', 'Net/violation', 'pick'], ['tkill', 'Their kill', null], ['tace', 'Their ace', null]];
export const NOTES = [['dig', 'Dig'], ['assist', 'Assist'], ['pass3', 'Great pass'], ['pass1', 'Poor pass'], ['att', 'Attack (no point)']];

export function statLine() { return { sv: 0, ace: 0, serr: 0, ptsServed: 0, kill: 0, block: 0, tip: 0, herr: 0, rerr: 0, nerr: 0, dig: 0, assist: 0, pass3: 0, pass1: 0, att: 0 }; }
export function computeStats(matches) {
  const by = {}, team = { matches: 0, w: 0, l: 0, setsW: 0, setsL: 0, ptsFor: 0, ptsAg: 0, rotFor: [0,0,0,0,0,0], rotAg: [0,0,0,0,0,0] };
  const get = pid => (by[pid] = by[pid] || statLine());
  matches.forEach(m => {
    const L = norm(m.lineup), st = m.state;
    if (!st || !st.sets) return;
    const d = deriveMatch(L, st);
    team.matches++; if (d.result === 'W') team.w++; if (d.result === 'L') team.l++;
    team.setsW += d.won; team.setsL += d.lost;
    d.sets.forEach(s => {
      team.ptsFor += s.us; team.ptsAg += s.them;
      s.log.forEach(x => {
        if (x.w === 'us') team.rotFor[x.rot]++; else team.rotAg[x.rot]++;
        if (x.serverPid) { const a = get(x.serverPid); a.sv++; if (x.w === 'us') a.ptsServed++; }
        if (x.t === 'ace' && x.serverPid) get(x.serverPid).ace++;
        else if (x.t === 'serr' && x.serverPid) get(x.serverPid).serr++;
        else if (x.t && x.p && ['kill','block','tip','herr','rerr','nerr'].includes(x.t)) get(x.p)[x.t]++;
      });
    });
    (st.notes || []).forEach(n => { if (n.p && n.type in statLine()) get(n.p)[n.type]++; });
  });
  return { by, team };
}
