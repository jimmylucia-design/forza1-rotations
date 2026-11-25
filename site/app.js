import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import * as E from './engine.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
const $ = id => document.getElementById(id);
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const view = $('view');

const S = {
  user: null, member: null, team: null, members: [], players: [], lineups: [], matches: [], follows: new Set(),
  tab: localStorage.getItem('tab2') || 'rot', rot: 0, mode: 'spots', lineupId: null, liveId: null,
  draft: null, draftId: null, statsScope: 'all', pending: null
};
const isAdmin = () => S.member?.role === 'admin';
const canScore = () => ['admin', 'scorekeeper'].includes(S.member?.role);
const P = id => S.players.find(p => p.id === id);
const pname = id => { const p = P(id); return p ? p.name : '—'; };
const first = id => pname(id).split(' ')[0];
const jersey = id => { const p = P(id); return p ? (p.number || p.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()) : '?'; };

function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 2600); }
function fail(e) { console.error(e); toast(e?.message || String(e)); }
function sheet(html, bind) {
  $('sheetCard').innerHTML = html; $('sheet').hidden = false;
  const close = () => { $('sheet').hidden = true; };
  $('sheet').onclick = e => { if (e.target === $('sheet')) close(); };
  $('sheetCard').querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  bind && bind($('sheetCard'), close);
  const f = $('sheetCard').querySelector('input,select,button'); f && f.focus();
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('sheet').hidden = true; });

// ---------------- auth ----------------
function authView(stage, email) {
  $('tabs').hidden = true; $('acct').hidden = true;
  if (stage === 'code') {
    view.innerHTML = `<div class="auth card stack">
      <h1>Check your email</h1>
      <p>We sent a sign-in link to <b>${esc(email)}</b>. Tap it on this device.</p>
      <p class="muted">Tap the link on this phone or computer. If the email shows a 6-digit code, you can type it here instead.</p>
      <label for="code">Code</label><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10">
      <button class="primary" id="verify">Sign in</button>
      <button class="ghost" id="back">Use a different email</button></div>`;
    $('verify').onclick = async () => {
      const token = $('code').value.trim(); if (!token) return;
      $('verify').disabled = true;
      const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
      $('verify').disabled = false;
      if (error) fail(error);
    };
    $('code').onkeydown = e => { if (e.key === 'Enter') $('verify').click(); };
    $('back').onclick = () => authView('email');
    return;
  }
  view.innerHTML = `<div class="auth card stack">
    <div class="authbrand"><div class="wordmark">FORZA<b>1</b></div><span class="useonly">Forza 1 use only</span></div>
    <h1>Sign in</h1>
    <p class="muted">For Forza 1 Volleyball families, players, and coaches. Enter your email. We'll send a link. No password.</p>
    <label for="email">Email</label><input id="email" type="email" autocomplete="email" inputmode="email">
    <button class="primary" id="send">Email me a link</button></div>`;
  $('email').value = localStorage.getItem('lastEmail') || '';
  $('send').onclick = async () => {
    const em = $('email').value.trim(); if (!/.+@.+\..+/.test(em)) return toast('Enter a valid email.');
    $('send').disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email: em, options: { emailRedirectTo: location.origin + location.pathname + location.search } });
    $('send').disabled = false;
    if (error) return fail(error);
    localStorage.setItem('lastEmail', em); authView('code', em);
  };
  $('email').onkeydown = e => { if (e.key === 'Enter') $('send').click(); };
}

async function onboardView() {
  $('tabs').hidden = true; $('acct').hidden = false;
  const { data: exists, error } = await sb.rpc('team_exists');
  if (error) return fail(error);
  const code = new URLSearchParams(location.search).get('join') || '';
  if (!exists) {
    view.innerHTML = `<div class="auth card stack"><h1>Create your team</h1>
      <p class="muted">You'll be the team admin. Parents join with a code.</p>
      <label for="tn">Team name</label><input id="tn" placeholder="Example: Wasatch 14 Black">
      <label for="mn">Your name</label><input id="mn" autocomplete="name">
      <button class="primary" id="go">Create team</button></div>`;
    $('go').onclick = async () => {
      const tn = $('tn').value.trim(), mn = $('mn').value.trim(); if (!tn || !mn) return toast('Fill in both names.');
      const { error } = await sb.rpc('create_team', { team_name: tn, my_name: mn }); if (error) return fail(error);
      boot();
    };
    return;
  }
  view.innerHTML = `<div class="auth card stack"><h1>Welcome</h1>
    <p class="muted">One step. What should the team call you?</p>
    <label for="mn">Your name</label><input id="mn" autocomplete="name" placeholder="Example: Sam Lee (Jane's dad)">
    ${code ? '' : `<label for="jc">Team code</label><input id="jc" autocapitalize="characters" placeholder="From the coach's invite">
    <p class="small muted">Tip: open the invite link from your coach and you won't need this.</p>`}
    <button class="primary" id="go">Continue</button></div>`;
  $('go').onclick = async () => {
    const mn = $('mn').value.trim(); if (!mn) return toast('Enter your name.');
    const jc = code || ($('jc') ? $('jc').value.trim() : '');
    if (!jc) return toast('Open the invite link from your coach, or enter the team code.');
    const { error } = await sb.rpc('join_team', { code: jc, my_name: mn }); if (error) return fail(error);
    history.replaceState(null, '', location.pathname); boot();
  };
}

$('acct').onclick = () => sheet(`<h3>Account</h3>
  <p>${esc(S.user?.email)}</p>${S.member ? `<p class="muted">${esc(S.member.display_name || '')} · ${esc(S.member.role)}</p>` : ''}
  <label for="dn">Your display name</label><input id="dn" value="${esc(S.member?.display_name || '')}">
  <div class="row" style="margin-top:12px"><button class="primary" id="saveDn">Save</button><button id="out" class="danger">Sign out</button><button data-close>Close</button></div>`,
  (c, close) => {
    c.querySelector('#saveDn').onclick = async () => {
      if (!S.member) return close();
      const { error } = await sb.from('members').update({ display_name: c.querySelector('#dn').value.trim() }).eq('team_id', S.team.id).eq('user_id', S.user.id);
      if (error) return fail(error); await loadAll(); close(); toast('Saved.');
    };
    c.querySelector('#out').onclick = async () => { await sb.auth.signOut(); close(); location.reload(); };
  });

// ---------------- data ----------------
async function loadAll() {
  const uid = S.user.id;
  const { data: mem, error: e1 } = await sb.from('members').select('*').eq('user_id', uid).limit(1);
  if (e1) throw e1;
  S.member = mem?.[0] || null;
  if (!S.member) return;
  const tid = S.member.team_id;
  const [t, ms, ps, ls, mt, fo] = await Promise.all([
    sb.from('teams').select('*').eq('id', tid).single(),
    sb.from('members').select('*').eq('team_id', tid).order('created_at'),
    sb.from('players').select('*').eq('team_id', tid).order('sort').order('created_at'),
    sb.from('lineups').select('*').eq('team_id', tid).order('updated_at', { ascending: false }),
    sb.from('matches').select('*').eq('team_id', tid).order('created_at', { ascending: false }).limit(200),
    sb.from('follows').select('player_id').eq('user_id', uid)
  ]);
  for (const r of [t, ms, ps, ls, mt, fo]) if (r.error) throw r.error;
  S.team = t.data; S.members = ms.data; S.players = ps.data; S.lineups = ls.data; S.matches = mt.data;
  S.follows = new Set(fo.data.map(f => f.player_id));
  if (!S.lineupId || !S.lineups.find(l => l.id === S.lineupId)) S.lineupId = (S.lineups.find(l => l.is_default) || S.lineups[0])?.id || null;
  $('teamName').textContent = S.team.name;
}
let channel = null;
function subscribe() {
  if (channel) sb.removeChannel(channel);
  const tid = S.team.id;
  channel = sb.channel('team-' + tid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: 'team_id=eq.' + tid }, payload => {
      const row = payload.new;
      if (payload.eventType === 'DELETE') S.matches = S.matches.filter(m => m.id !== payload.old.id);
      else {
        const i = S.matches.findIndex(m => m.id === row.id);
        if (i >= 0) { if ((S.matches[i].updated_at || '') > (row.updated_at || '')) return; S.matches[i] = row; }
        else S.matches.unshift(row);
      }
      if (S.tab === 'live' || S.tab === 'mine' || S.tab === 'stats') render();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: 'team_id=eq.' + tid }, () => refresh())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lineups', filter: 'team_id=eq.' + tid }, () => { if (!S.draft) refresh(); })
    .subscribe();
}
let refreshT = null;
function refresh() { clearTimeout(refreshT); refreshT = setTimeout(async () => { try { await loadAll(); render(); } catch (e) { fail(e); } }, 250); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.team) refresh(); });

// ---------------- court renderer ----------------
function lineupById(id) { const l = S.lineups.find(x => x.id === id); return l ? E.norm(l.data) : null; }
function curLineup() { return lineupById(S.lineupId) || E.blankLineup(); }
function hasLineup() { return !!lineupById(S.lineupId); }
function chipLabel(L, code) { const pid = E.playerOf(L, code); return pid ? jersey(pid) : code; }
function chipTag(L, r, code) { const pid = E.playerOf(L, code); return pid ? first(pid) : E.roleName(L, r, code); }

function courtHTML(L, r, mode, o = {}) {
  let h = `<div class="net"></div><div class="court${o.drag ? ' drag' : ''}" data-court><div class="att"></div>`;
  const ZX = { 4: 0, 3: 33.3, 2: 66.6, 5: 0, 6: 33.3, 1: 66.6 };
  for (let p = 1; p <= 6; p++) h += `<div class="zone ${E.FRONT[p] ? 'zf' : 'zb'}" style="left:${ZX[p]}%;top:33.3%">${p}</div>`;
  const setter = E.courtCode(L, r, E.posOf(L, r, E.setterOf(L, r)), mode);
  for (let p = 1; p <= 6; p++) {
    const code = E.courtCode(L, r, p, mode), xy = E.xyAt(L, r, p, mode), pid = E.playerOf(L, code);
    const cls = ['chip', 'k-' + E.kind(L, code)];
    if (pid && S.follows.has(pid)) cls.push('star');
    if (code === setter) cls.push('sets');
    if (o.servingCode === code) cls.push('serving');
    h += `<div class="${cls.join(' ')}" data-code="${code}" style="left:${xy[0]}%;top:${xy[1]}%" tabindex="${o.drag ? 0 : -1}" aria-label="${esc((pid ? pname(pid) + ', ' : '') + E.roleName(L, r, code) + ', spot ' + p)}">
      <div class="dot">${esc(chipLabel(L, code))}</div><div class="tag">${esc(chipTag(L, r, code))}</div></div>`;
  }
  return h + '</div>';
}
function legendHTML() {
  return `<div class="legend"><span><i style="background:var(--s)"></i>Setter</span><span><i style="background:var(--opp)"></i>Opposite</span>
  <span><i style="background:var(--oh)"></i>Outside</span><span><i style="background:var(--m)"></i>Middle</span><span><i style="background:var(--lib)"></i>Libero</span>
  <span><i style="border:2px dashed var(--ink)"></i>Setting</span><span><i style="background:var(--her)"></i>Your player</span></div>`;
}
function statusHTML(L, r, mode) {
  if (mode === 'switch') return `<div class="status">Overlap rules end once the ball is served.</div>`;
  const iss = E.overlaps(L, r, mode);
  if (!iss.length) return `<div class="status ok">Legal at the serve. No overlap.</div>`;
  const nm = c => { const pid = E.playerOf(L, c); return pid ? first(pid) : c; };
  const i = iss[0];
  const msg = i.t === 'net' ? `${nm(i.ca)} (spot ${i.a}) must be closer to the net than ${nm(i.cb)} (spot ${i.b}).` : `${nm(i.ca)} (spot ${i.a}) must be left of ${nm(i.cb)} (spot ${i.b}).`;
  return `<div class="status bad">Overlap: ${esc(msg)}${iss.length > 1 ? ` (+${iss.length - 1} more)` : ''}</div>`;
}
function bindDrag(root, L, r, mode, onMove) {
  const court = root.querySelector('[data-court]');
  court.querySelectorAll('.chip').forEach(c => {
    const code = c.dataset.code; let start = null, moved = false, last = null;
    c.addEventListener('pointerdown', e => { if (e.button > 0) return; start = [e.clientX, e.clientY]; moved = false; last = null; try { c.setPointerCapture(e.pointerId); } catch (_) {} });
    c.addEventListener('pointermove', e => {
      if (!start) return;
      if (!moved && Math.hypot(e.clientX - start[0], e.clientY - start[1]) < 7) return;
      moved = true; c.classList.add('dragging');
      const b = court.getBoundingClientRect();
      const x = clamp((e.clientX - b.left) / b.width * 100, 3, 97), y = clamp((e.clientY - b.top) / b.height * 100, 3, 97);
      c.style.left = x + '%'; c.style.top = y + '%'; last = [Math.round(x * 10) / 10, Math.round(y * 10) / 10]; e.preventDefault();
    });
    const end = () => { if (!start) return; start = null; c.classList.remove('dragging'); if (moved && last) onMove(code, last); };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', () => { start = null; c.classList.remove('dragging'); onMove(null); });
    c.addEventListener('keydown', e => {
      const d = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] }[e.key]; if (!d) return;
      e.preventDefault(); const p = E.spotOfCode(L, r, code, mode); const xy = E.xyAt(L, r, p, mode);
      onMove(code, [clamp(xy[0] + d[0], 3, 97), clamp(xy[1] + d[1], 3, 97)], true);
    });
  });
}
function rotButtons(cur, cls = '') { let h = `<div class="seg ${cls}" role="group" aria-label="Rotation">`; for (let i = 0; i < 6; i++) h += `<button data-rot="${i}" aria-pressed="${i === cur}">${i + 1}</button>`; return h + '</div>'; }
function modeButtons(cur) { return `<div class="seg" role="group" aria-label="View">${Object.entries(E.MODES).map(([k, v]) => `<button data-mode="${k}" aria-pressed="${k === cur}">${v}</button>`).join('')}</div>`; }
function miniGrid(L, mode, cur, capFn) {
  let h = '<div class="grid6">';
  for (let r = 0; r < 6; r++) {
    const bad = E.overlaps(L, r, mode).length;
    h += `<button class="mini" data-mini="${r}" aria-current="${r === cur}"><h4>Rotation ${r + 1}<em>${bad ? 'Overlap' : E.edited(L, r, mode) ? 'Custom' : ''}</em></h4>${courtHTML(L, r, mode)}<p>${esc(capFn(r))}</p></button>`;
  }
  return h + '</div>';
}
function caption(L, r, mode) {
  const nm = c => { const pid = E.playerOf(L, c); return pid ? first(pid) : c; };
  const parts = [];
  if (mode === 'sr') parts.push('Passers: ' + E.passersAt(L, r).map(nm).join(', ') + '.');
  else parts.push(nm(E.courtCode(L, r, E.posOf(L, r, E.setterOf(L, r)), mode)) + ' sets.');
  const subs = E.subsIn(L, r, mode).map(o => nm(o.code) + ' in for ' + nm(o.out));
  if (subs.length) parts.push(subs.join('; ') + '.');
  return parts.join(' ');
}

// ---------------- tabs ----------------
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; localStorage.setItem('tab2', S.tab); render(); window.scrollTo(0, 0); });
function render() {
  if (!S.team) return;
  $('tabs').hidden = false; $('acct').hidden = false;
  document.querySelectorAll('#tabs button').forEach(b => b.setAttribute('aria-current', b.dataset.tab === S.tab ? 'page' : 'false'));
  if (S.tab === 'team' && S.draft) return renderEditor();
  try { ({ live: renderLive, mine: renderMine, rot: renderRot, stats: renderStats, team: renderTeam })[S.tab](); }
  catch (e) { fail(e); }
}

// ---------- Rotations tab ----------
function lineupPicker(id, cur) {
  if (!S.lineups.length) return '';
  return `<label for="${id}">Lineup</label><select id="${id}">${S.lineups.map(l => `<option value="${l.id}" ${l.id === cur ? 'selected' : ''}>${esc(l.name)}${l.is_default ? ' (default)' : ''}</option>`).join('')}</select>`;
}
function renderRot() {
  const L = curLineup();
  const r = S.rot, mode = S.mode;
  view.innerHTML = `<div class="stack">
    ${hasLineup() ? '' : `<div class="card small">6-2 rotation chart. ${isAdmin() ? '<button class="primary" id="goTeam" style="margin-top:6px">Add players</button> to put names on it.' : 'Names appear once the coach adds the roster.'}</div>`}
    ${S.lineups.length > 1 ? `<div class="card">${lineupPicker('lp', S.lineupId)}</div>` : ''}
    <div class="two"><div>
      <div class="stack">${rotButtons(r)}${modeButtons(mode)}</div><div style="height:10px"></div>
      ${courtHTML(L, r, mode)}${statusHTML(L, r, mode)}${legendHTML()}
    </div><div class="card">${rotInfoHTML(L, r)}</div></div>
    <h2>All six rotations</h2>${miniGrid(L, mode, r, rr => caption(L, rr, mode))}</div>`;
  bindRotNav(renderRot);
  const gt = $('goTeam'); if (gt) gt.onclick = () => { S.tab = 'team'; localStorage.setItem('tab2', 'team'); render(); };
  const lp = $('lp'); if (lp) lp.onchange = () => { S.lineupId = lp.value; renderRot(); };
}
function bindRotNav(re) {
  view.querySelectorAll('[data-rot]').forEach(b => b.onclick = () => { S.rot = +b.dataset.rot; re(); });
  view.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { S.mode = b.dataset.mode; re(); });
  view.querySelectorAll('[data-mini]').forEach(b => b.onclick = () => { S.rot = +b.dataset.mini; re(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
}
function rotInfoHTML(L, r) {
  const nm = c => { const pid = E.playerOf(L, c); return pid ? pname(pid) : c; };
  const sp = E.posOf(L, r, E.setterOf(L, r)), sc = E.courtCode(L, r, sp, 'sr');
  const subs = E.subsIn(L, r, 'sr').map(o => `${nm(o.code)} in for ${nm(o.out)} (spot ${o.p})`);
  let h = `<h3>Rotation ${r + 1}</h3><dl>
    <dt><b>Serving</b></dt><dd>${esc(nm(E.courtCode(L, r, 1, 'spots')))} from spot 1.</dd>
    <dt><b>Setting</b></dt><dd>${esc(nm(sc))} ${E.FRONT[sp] ? 'from the front row' : 'from the back row, starts in spot ' + sp}.</dd>
    <dt><b>Front row, left to right</b></dt><dd>${[4, 3, 2].map(p => esc(nm(E.courtCode(L, r, p, 'sr')))).join(', ')}.</dd>
    <dt><b>Passers, left to right</b></dt><dd>${E.passersAt(L, r).map(c => esc(nm(c))).join(', ')}.</dd>
    <dt><b>Subs this rotation</b></dt><dd>${subs.length ? esc(subs.join('; ')) + '.' : 'None.'}</dd></dl>`;
  [...S.follows].forEach(pid => {
    const row = E.playerPlan(L, pid)[r]; if (!row) return;
    h += `<div class="callout" style="margin-top:8px"><b>${esc(pname(pid))}:</b> ${esc(planText(row))}</div>`;
  });
  return h;
}
function planText(x) {
  if (!x.on) return x.role + '.';
  if (x.role === 'Serves, then off') return 'Serves from spot 1, then comes off for the libero.';
  let t = `${x.front ? 'Front' : 'Back'} row, spot ${x.spot}. ${x.role}.`;
  if (x.sets) t += ' Sets this rotation.';
  else if (x.passes) t += ' Passes in serve receive.';
  if (x.serves) t += ' Serves this rotation.';
  return t;
}

// ---------- My player tab ----------
function renderMine() {
  const L = curLineup();
  const opts = S.players.map(p => `<button data-follow="${p.id}" aria-pressed="${S.follows.has(p.id)}">${esc((p.number ? '#' + p.number + ' ' : '') + p.name)}</button>`).join('');
  let h = `<div class="stack"><div class="card"><h2 style="margin-top:0">Your player</h2>
    <p class="muted">Tap your player. She gets a yellow ring on every court, and you see her in and out below.</p>
    ${S.players.length ? `<div class="chips">${opts}</div>` : '<p class="muted">The roster is empty. The coach adds it on the Team tab.</p>'}</div>`;
  const live = S.matches.find(m => m.status === 'live');
  [...S.follows].forEach(pid => {
    if (!P(pid)) return;
    if (live) h += liveMineHTML(live, pid);
    if (hasLineup()) {
      const plan = E.playerPlan(L, pid);
      h += `<div class="card"><h3>${esc(pname(pid))} — in and out</h3><p class="muted small">Lineup: ${esc(S.lineups.find(l => l.id === S.lineupId)?.name || '')}</p>
      <div class="scroll"><table class="plan"><thead><tr><th>Rot</th><th>Court</th><th>Spot</th><th>Role</th><th title="Passes in serve receive">Pass</th><th title="Serves">Srv</th></tr></thead><tbody>
      ${plan.map(x => `<tr${x.r === S.rot ? ' class="me"' : ''}><td>${x.r + 1}</td><td><span class="pill ${x.on ? 'on' : 'off'}">${x.on ? (x.role === 'Serves, then off' ? 'Serve' : 'In') : 'Out'}</span></td>
        <td>${x.spot ? x.spot + (x.front ? 'F' : 'B') : '—'}</td><td>${esc(x.on ? (x.role === 'Serves, then off' ? 'Serves, out' : x.role) : x.role.replace('Off: ', ''))}</td><td>${x.passes ? '✓' : ''}</td><td>${x.serves ? '✓' : ''}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="small muted" style="margin-top:8px">F = front row, B = back row. ${esc(summary(plan))}</p></div>`;
    }
    h += playerStatsCard(pid);
  });
  view.innerHTML = h + '</div>';
  view.querySelectorAll('[data-follow]').forEach(b => b.onclick = async () => {
    const pid = b.dataset.follow, on = S.follows.has(pid);
    const q = on ? sb.from('follows').delete().eq('user_id', S.user.id).eq('player_id', pid) : sb.from('follows').insert({ user_id: S.user.id, player_id: pid });
    const { error } = await q; if (error) return fail(error);
    on ? S.follows.delete(pid) : S.follows.add(pid); renderMine();
  });
}
function summary(plan) {
  const ins = plan.filter(x => x.on && x.role !== 'Serves, then off').map(x => x.r + 1);
  const outs = plan.filter(x => !x.on).map(x => x.r + 1);
  const serve = plan.filter(x => x.serves).map(x => x.r + 1);
  return `On court in rotations ${ins.join(', ') || 'none'}. ${outs.length ? 'Off in ' + outs.join(', ') + '. ' : ''}${serve.length ? 'Serves in rotation ' + serve.join(', ') + '.' : 'Does not serve.'}`;
}
function liveMineHTML(m, pid) {
  const L = E.norm(m.lineup), d = E.deriveMatch(L, m.state), c = d.cur;
  const row = E.playerPlan(L, pid)[c.rot];
  const k = E.sideoutsUntilServe(L, c.rot, c.serving, pid);
  let serveTxt = k === 0 ? 'She is serving now.' : k === null ? 'She does not serve in this lineup.' : `She serves after ${k} more side-out${k > 1 ? 's' : ''}.`;
  return `<div class="card callout"><b><span class="live-dot"></span>Live vs ${esc(m.opponent)}: ${c.us}–${c.them}</b><br>
    Rotation ${c.rot + 1}. ${esc(pname(pid))}: ${esc(planText(row))} ${esc(serveTxt)}</div>`;
}

// ---------- Live tab ----------
function matchCard(m) {
  const L = E.norm(m.lineup), d = E.deriveMatch(L, m.state);
  const sets = d.sets.filter(s => s.closed || s.us + s.them > 0).map(s => `${s.us}-${s.them}`).join(', ');
  return `<button class="li" data-open="${m.id}" style="width:100%;border:0;border-top:1px solid var(--line);border-radius:0;background:none;justify-content:flex-start;text-align:left">
    <span class="num" style="background:${m.status === 'live' ? '#E0362C' : d.result === 'W' ? 'var(--ok)' : d.result === 'L' ? 'var(--bad)' : 'var(--muted)'}">${m.status === 'live' ? 'LIVE' : d.result || '–'}</span>
    <span class="grow"><b>vs ${esc(m.opponent)}</b><br><span class="small muted">${esc(m.played_on)} · ${esc(sets || 'no points yet')}</span></span></button>`;
}
function renderLive() {
  const m = S.liveId === '__list' ? null : S.liveId ? S.matches.find(x => x.id === S.liveId) : S.matches.find(x => x.status === 'live');
  if (m) return renderMatch(m);
  renderLiveList();
}
function newMatchSheet() {
  sheet(`<h3>Start a game</h3>
    <label for="opp">Opponent</label><input id="opp" placeholder="Team name">
    <label for="dt">Date</label><input id="dt" type="date" value="${new Date().toLocaleDateString('en-CA')}">
    ${lineupPicker('ml', S.lineupId)}
    <label for="fmt">Format</label><select id="fmt"><option value="2">Best of 3 (25, 25, 15)</option><option value="3">Best of 5 (25 ×4, 15)</option><option value="1">One set to 25</option></select>
    <label for="sr">Starting rotation</label><select id="sr">${[0, 1, 2, 3, 4, 5].map(i => `<option value="${i}">Rotation ${i + 1}</option>`).join('')}</select>
    <label for="ss">First serve</label><select id="ss"><option value="us">We serve</option><option value="them">They serve</option></select>
    <div class="row" style="margin-top:14px"><button class="primary" id="go">Start</button><button data-close>Cancel</button></div>`,
    (c, close) => c.querySelector('#go').onclick = async () => {
      const opp = c.querySelector('#opp').value.trim(); if (!opp) return toast('Enter the opponent.');
      const lid = c.querySelector('#ml')?.value || S.lineupId, lu = S.lineups.find(l => l.id === lid);
      const fmt = +c.querySelector('#fmt').value;
      const st = E.newMatchState({ toWin: fmt, pts: fmt === 1 ? [25, 25, 25] : [25, 25, 15], startRot: +c.querySelector('#sr').value, startServe: c.querySelector('#ss').value });
      const { data, error } = await sb.from('matches').insert({ team_id: S.team.id, opponent: opp, played_on: c.querySelector('#dt').value, lineup: lu.data, state: st, status: 'live' }).select().single();
      if (error) return fail(error);
      S.matches.unshift(data); S.liveId = data.id; close(); renderLive();
    });
}
let saving = Promise.resolve();
function saveMatch(m) {
  m.updated_at = new Date().toISOString();
  const snap = JSON.parse(JSON.stringify({ state: m.state, status: m.status }));
  saving = saving.then(async () => {
    const { error } = await sb.from('matches').update({ ...snap, updated_at: m.updated_at }).eq('id', m.id);
    if (error) fail(error);
  });
}
function renderMatch(m) {
  const L = E.norm(m.lineup), st = m.state, d = E.deriveMatch(L, st), c = d.cur, si = st.sets.length - 1;
  const scorer = canScore() && m.status === 'live';
  const last = st.sets[si].rallies[st.sets[si].rallies.length - 1];
  const lastLog = c.log[c.log.length - 1];
  const serverName = c.serving === 'us' ? (c.serverPid ? pname(c.serverPid) : c.serverCode) : esc(m.opponent);
  let h = `<div class="stack"><div class="row"><button id="back">All games</button><span class="grow"></span>
      ${m.status === 'live' ? '<span class="badge"><span class="live-dot"></span>Live</span>' : `<span class="badge">Final: ${d.result || '—'}</span>`}</div>
    <div class="card"><div class="score">
      <div><div class="small muted">Us ${c.serving === 'us' ? '<span class="serveball" title="Serving"></span>' : ''}</div><div class="big us">${c.us}</div></div>
      <div class="muted small">Set ${si + 1}<br>${d.won}–${d.lost}</div>
      <div><div class="small muted">${c.serving === 'them' ? '<span class="serveball"></span>' : ''}${esc(m.opponent)}</div><div class="big them">${c.them}</div></div>
    </div>
    <div class="setline">${d.sets.map((s, i) => `<span class="${s.closed ? (s.winner === 'us' ? 'w' : 'l') : ''}">S${i + 1} ${s.us}-${s.them}</span>`).join('')}</div>
    <p style="text-align:center;margin-top:8px"><b>Rotation ${c.rot + 1}</b> · Serving: <b>${esc(serverName)}</b></p></div>
    ${scorer ? `<div class="pointbar"><div class="scoremini"><span style="color:var(--us)">Us ${c.us}</span><span class="muted">Rot ${c.rot + 1} · ${c.serving === 'us' ? 'We serve' : 'They serve'}</span><span style="color:var(--them)">${c.them} Them</span></div><div class="pointbtns"><button class="pu" id="pu">Point us</button><button class="pt" id="pt">Point them</button></div></div><div class="card">
      ${last ? `<div style="margin-top:10px"><div class="small muted">Last point (${last.w === 'us' ? 'us' : 'them'}): how?</div><div class="chips" id="how">
        ${(last.w === 'us' ? E.STAT_US : E.STAT_THEM).map(([k, lbl]) => `<button data-how="${k}" aria-pressed="${last.t === k}">${lbl}${last.t === k && last.p ? ': ' + esc(first(last.p)) : ''}</button>`).join('')}</div></div>` : ''}
      <div class="row" style="margin-top:10px"><button id="undo" ${last ? '' : 'disabled'}>Undo</button><button id="rotFix">Fix rotation/serve</button><button id="notes">Extra stats</button>
      ${c.over && !st.sets[si].closed ? `<button class="primary" id="endSet">End set ${si + 1}</button>` : ''}
      ${st.sets[si].closed || c.over ? '' : '<button id="endSet2" class="ghost">End set early</button>'}</div></div>` : ''}
    <div class="two"><div>${courtHTML(L, c.rot, c.serving === 'us' ? 'spots' : 'sr', { servingCode: c.serverCode })}${legendHTML()}</div>
    <div class="card">${rotInfoHTML(L, c.rot)}</div></div>
    ${[...S.follows].filter(P).map(pid => liveMineHTML(m, pid)).join('')}
    <div class="card"><h3>Rally log</h3><div class="scroll"><table><thead><tr><th>#</th><th>Score</th><th>Rot</th><th>Server</th><th>Result</th></tr></thead><tbody>
      ${logRows(L, d, m)}</tbody></table></div></div>
    ${canScore() ? `<div class="row">${m.status === 'live' ? '<button id="final">Mark game final</button>' : '<button id="reopen">Reopen game</button>'}${isAdmin() ? '<button class="danger" id="delM">Delete game</button>' : ''}</div>` : ''}
  </div>`;
  view.innerHTML = h;
  $('back').onclick = () => { S.liveId = '__list'; renderLive(); };
  if (scorer) {
    $('pu').onclick = () => point(m, 'us'); $('pt').onclick = () => point(m, 'them');
    $('undo').onclick = () => { if (!last) return; st.sets[si].rallies.pop(); saveMatch(m); renderMatch(m); };
    view.querySelectorAll('[data-how]').forEach(b => b.onclick = () => tagHow(m, L, last, lastLog, b.dataset.how));
    $('rotFix').onclick = () => fixSheet(m);
    $('notes').onclick = () => notesSheet(m, L, c.rot);
    const es = $('endSet'), es2 = $('endSet2');
    const endIt = () => { st.sets[si].closed = true; const dd = E.deriveMatch(L, st); if (!dd.matchOver) newSetSheet(m, dd); else { m.status = 'final'; saveMatch(m); renderMatch(m); toast('Game over: ' + (dd.result === 'W' ? 'win' : 'loss') + '.'); } saveMatch(m); };
    if (es) es.onclick = endIt;
    if (es2) es2.onclick = () => { if (confirm('End this set now at ' + c.us + '-' + c.them + '?')) endIt(); };
  }
  const f = $('final'); if (f) f.onclick = () => { if (!confirm('Mark this game final?')) return; m.status = 'final'; st.sets[si].closed = st.sets[si].closed || c.us + c.them > 0; saveMatch(m); renderMatch(m); };
  const ro = $('reopen'); if (ro) ro.onclick = () => { m.status = 'live'; saveMatch(m); renderMatch(m); };
  const dm = $('delM'); if (dm) dm.onclick = async () => {
    if (!confirm('Delete this game and its stats? This cannot be undone.')) return;
    const { error } = await sb.from('matches').delete().eq('id', m.id); if (error) return fail(error);
    S.matches = S.matches.filter(x => x.id !== m.id); S.liveId = '__list'; renderLive();
  };
}
function renderLiveList() {
  const live = S.matches.find(x => x.status === 'live');
  view.innerHTML = `<div class="stack"><div class="card"><h2 style="margin-top:0">Games</h2>
    ${live ? `<button class="primary" data-open="${live.id}"><span class="live-dot"></span>Live now vs ${esc(live.opponent)}</button> ` : ''}
    ${canScore() ? `<button class="${live ? '' : 'primary'}" id="newMatch" ${S.lineups.length ? '' : 'disabled'}>Start a game</button>${S.lineups.length ? '' : '<p class="muted small">Build a lineup on the Team tab first.</p>'}` : live ? '' : '<p class="muted">No game is live right now.</p>'}</div>
    <div class="card"><h3>All games</h3><div class="list">${S.matches.map(matchCard).join('') || '<p class="muted">No games yet.</p>'}</div></div></div>`;
  view.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { S.liveId = b.dataset.open; renderLive(); });
  const nb = $('newMatch'); if (nb) nb.onclick = newMatchSheet;
}
function logRows(L, d, m) {
  const rows = [];
  d.sets.forEach((s, si) => {
    let us = 0, them = 0;
    s.log.forEach((x, i) => {
      x.w === 'us' ? us++ : them++;
      const lbl = [...E.STAT_US, ...E.STAT_THEM].find(a => a[0] === x.t)?.[1] || '';
      rows.push(`<tr><td>S${si + 1}.${i + 1}</td><td>${us}-${them}</td><td>${x.rot + 1}</td><td>${x.serving === 'us' ? esc(x.serverPid ? first(x.serverPid) : x.serverCode) : 'Them'}</td>
        <td style="color:${x.w === 'us' ? 'var(--us)' : 'var(--them)'}">${x.w === 'us' ? 'Us' : 'Them'}${lbl ? ' · ' + esc(lbl) : ''}${x.p ? ' (' + esc(first(x.p)) + ')' : ''}</td></tr>`);
    });
  });
  return rows.reverse().slice(0, 60).join('') || '<tr><td colspan="5" class="muted">No rallies yet.</td></tr>';
}
function point(m, w) {
  const st = m.state, si = st.sets.length - 1;
  if (st.sets[si].closed) return toast('Set is closed. Start the next set.');
  st.sets[si].rallies.push({ w, ts: Date.now() });
  if (navigator.vibrate) navigator.vibrate(15);
  saveMatch(m); renderMatch(m);
}
function onCourtPids(L, r) { const o = []; for (let p = 1; p <= 6; p++) { const pid = E.playerOf(L, E.courtCode(L, r, p, 'sr')); if (pid) o.push(pid); } return o; }
function tagHow(m, L, last, lastLog, k) {
  if (last.t === k) { delete last.t; delete last.p; saveMatch(m); return renderMatch(m); }
  const def = [...E.STAT_US, ...E.STAT_THEM].find(a => a[0] === k);
  last.t = k; delete last.p;
  if (def[2] === 'server') { if (lastLog?.serverPid) last.p = lastLog.serverPid; saveMatch(m); return renderMatch(m); }
  if (def[2] !== 'pick') { saveMatch(m); return renderMatch(m); }
  const pids = onCourtPids(L, lastLog.rot);
  sheet(`<h3>${def[1]}: who?</h3><div class="chips">${pids.map(p => `<button data-p="${p}">${esc(jersey(p) + ' ' + pname(p))}</button>`).join('')}</div>
    <div class="row" style="margin-top:12px"><button data-close>Skip</button></div>`, (c, close) => {
    c.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { last.p = b.dataset.p; close(); saveMatch(m); renderMatch(m); });
    c.querySelector('[data-close]').addEventListener('click', () => { saveMatch(m); renderMatch(m); });
  });
}
function notesSheet(m, L, rot) {
  const pids = onCourtPids(L, rot); let type = 'dig';
  sheet(`<h3>Extra stats</h3><p class="muted small">Pick a stat, then tap the player. These do not change the score.</p>
    <div class="chips" id="nt">${E.NOTES.map(([k, l]) => `<button data-t="${k}" aria-pressed="${k === type}">${l}</button>`).join('')}</div>
    <h4 style="margin-top:12px">Player</h4><div class="chips">${pids.map(p => `<button data-p="${p}">${esc(jersey(p) + ' ' + pname(p))}</button>`).join('')}</div>
    <div class="row" style="margin-top:12px"><button data-close>Done</button></div>`, c => {
    c.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { type = b.dataset.t; c.querySelectorAll('[data-t]').forEach(x => x.setAttribute('aria-pressed', x === b)); });
    c.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
      (m.state.notes = m.state.notes || []).push({ s: m.state.sets.length - 1, type, p: b.dataset.p, ts: Date.now() });
      saveMatch(m); toast(E.NOTES.find(n => n[0] === type)[1] + ': ' + first(b.dataset.p));
    });
  });
}
function fixSheet(m) {
  const st = m.state, si = st.sets.length - 1, s = st.sets[si];
  sheet(`<h3>Fix set ${si + 1} start</h3><p class="muted small">Changes where this set started. Every rally recalculates from here.</p>
    <label for="fr">Starting rotation</label><select id="fr">${[0, 1, 2, 3, 4, 5].map(i => `<option value="${i}" ${i === s.startRot ? 'selected' : ''}>Rotation ${i + 1}</option>`).join('')}</select>
    <label for="fs">First serve</label><select id="fs"><option value="us" ${s.startServe === 'us' ? 'selected' : ''}>We served first</option><option value="them" ${s.startServe === 'them' ? 'selected' : ''}>They served first</option></select>
    <div class="row" style="margin-top:12px"><button class="primary" id="ok">Save</button><button data-close>Cancel</button></div>`,
    (c, close) => c.querySelector('#ok').onclick = () => { s.startRot = +c.querySelector('#fr').value; s.startServe = c.querySelector('#fs').value; close(); saveMatch(m); renderMatch(m); });
}
function newSetSheet(m, d) {
  const n = m.state.sets.length + 1;
  sheet(`<h3>Set ${n}</h3><p>Sets: ${d.won}–${d.lost}.</p>
    <label for="nr">Starting rotation</label><select id="nr">${[0, 1, 2, 3, 4, 5].map(i => `<option value="${i}">Rotation ${i + 1}</option>`).join('')}</select>
    <label for="ns">First serve</label><select id="ns"><option value="${d.sets.length % 2 ? 'them' : 'us'}">${d.sets.length % 2 ? 'They serve' : 'We serve'}</option><option value="${d.sets.length % 2 ? 'us' : 'them'}">${d.sets.length % 2 ? 'We serve' : 'They serve'}</option></select>
    <div class="row" style="margin-top:12px"><button class="primary" id="ok">Start set ${n}</button></div>`,
    (c, close) => c.querySelector('#ok').onclick = () => { m.state.sets.push({ startRot: +c.querySelector('#nr').value, startServe: c.querySelector('#ns').value, rallies: [] }); close(); saveMatch(m); renderMatch(m); });
}

// ---------- Stats tab ----------
const STAT_COLS = [['sv', 'Serves'], ['ace', 'Aces'], ['serr', 'Srv err'], ['ptsServed', 'Pts on srv'], ['kill', 'Kills'], ['block', 'Blocks'], ['tip', 'Tips'], ['herr', 'Hit err'], ['rerr', 'Pass err'], ['dig', 'Digs'], ['assist', 'Assists'], ['pass3', 'Great pass'], ['pass1', 'Poor pass']];
function scopedMatches() { return S.statsScope === 'all' ? S.matches : S.matches.filter(m => m.id === S.statsScope); }
function renderStats() {
  const { by, team } = E.computeStats(scopedMatches());
  const ids = S.players.map(p => p.id).filter(id => by[id]);
  const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
  view.innerHTML = `<div class="stack"><div class="card"><label for="sc">Show</label><select id="sc"><option value="all">All games</option>
    ${S.matches.map(m => `<option value="${m.id}" ${S.statsScope === m.id ? 'selected' : ''}>${esc(m.played_on + ' vs ' + m.opponent)}</option>`).join('')}</select></div>
    <div class="card"><h3>Team</h3><div class="kpis">
      <div class="kpi"><b>${team.w}–${team.l}</b><span>Games W–L</span></div><div class="kpi"><b>${team.setsW}–${team.setsL}</b><span>Sets</span></div>
      <div class="kpi"><b>${team.ptsFor}–${team.ptsAg}</b><span>Points</span></div></div>
      <h4 style="margin-top:12px">Points by rotation</h4><div class="scroll"><table><thead><tr><th>Rot</th>${[1, 2, 3, 4, 5, 6].map(i => `<th class="n">${i}</th>`).join('')}</tr></thead><tbody>
      <tr><td>Won</td>${team.rotFor.map(v => `<td class="n">${v}</td>`).join('')}</tr><tr><td>Lost</td>${team.rotAg.map(v => `<td class="n">${v}</td>`).join('')}</tr>
      <tr><td>Net</td>${team.rotFor.map((v, i) => `<td class="n" style="color:${v - team.rotAg[i] < 0 ? 'var(--bad)' : 'var(--ok)'}">${v - team.rotAg[i]}</td>`).join('')}</tr></tbody></table></div></div>
    <div class="card"><h3>Players</h3><div class="scroll"><table><thead><tr><th>Player</th>${STAT_COLS.map(c => `<th class="n">${c[1]}</th>`).join('')}<th class="n">Srv %</th></tr></thead><tbody>
      ${ids.map(id => { const a = by[id]; return `<tr${S.follows.has(id) ? ' class="me"' : ''}><td>${esc(jersey(id) + ' ' + pname(id))}</td>${STAT_COLS.map(c => `<td class="n">${a[c[0]]}</td>`).join('')}<td class="n">${pct(a.sv - a.serr, a.sv)}</td></tr>`; }).join('') || `<tr><td colspan="${STAT_COLS.length + 2}" class="muted">No stats yet.</td></tr>`}
    </tbody></table></div><p class="small muted" style="margin-top:6px">Serves and points on serve are counted for every rally. Other stats appear when the scorekeeper tags them.</p></div></div>`;
  $('sc').onchange = e => { S.statsScope = e.target.value; renderStats(); };
}
function playerStatsCard(pid) {
  const a = E.computeStats(S.matches).by[pid]; if (!a) return '';
  return `<div class="card"><h3>${esc(first(pid))}'s season stats</h3><div class="kpis">${STAT_COLS.filter(c => a[c[0]]).map(c => `<div class="kpi"><b>${a[c[0]]}</b><span>${c[1]}</span></div>`).join('') || '<p class="muted">No stats yet.</p>'}</div></div>`;
}

// ---------- Team tab ----------
function renderTeam() {
  const inv = location.origin + location.pathname + '?join=' + S.team.join_code;
  let h = `<div class="stack">`;
  if (isAdmin()) h += `<div class="card"><h2 style="margin-top:0">Invite parents</h2><p class="muted">Send the link. Parents sign in with their email and type their name. Backup code: <b>${esc(S.team.join_code)}</b></p>
    <div class="row"><button id="copyInv" class="primary">Copy invite link</button><button id="shareInv">Share</button></div></div>`;
  h += `<div class="card"><div class="row"><h2 class="grow" style="margin:0">Roster</h2>${isAdmin() ? '<button id="addP">Add player</button><button id="paste" class="primary">Paste roster</button>' : ''}</div>
    <div class="list" style="margin-top:8px">${S.players.map(p => `<div class="li"><span class="num">${esc(p.number || '–')}</span><span class="grow"><b>${esc(p.name)}</b><br><span class="small muted">${esc(p.position || 'No position')}</span></span>
      <span class="pill ${p.status === 'alternate' ? 'alt' : ''}">${p.status === 'alternate' ? 'Alternate' : 'Starter'}</span>${isAdmin() ? `<button data-editp="${p.id}" class="ghost">Edit</button>` : ''}</div>`).join('') || '<p class="muted">No players yet.</p>'}</div></div>`;
  h += `<div class="card"><div class="row"><h2 class="grow" style="margin:0">Lineups</h2>${isAdmin() ? '<button id="newL" class="primary" ' + (S.players.length ? '' : 'disabled') + '>New lineup</button>' : ''}</div>
    <div class="list" style="margin-top:8px">${S.lineups.map(l => `<div class="li"><span class="grow"><b>${esc(l.name)}</b> ${l.is_default ? '<span class="pill on">Default</span>' : ''}<br><span class="small muted">${esc(E.norm(l.data).sys)} · updated ${new Date(l.updated_at).toLocaleDateString()}</span></span>
      ${isAdmin() ? `<button data-editl="${l.id}">Edit</button>` : `<button data-viewl="${l.id}">View</button>`}</div>`).join('') || '<p class="muted">No lineups yet.</p>'}</div></div>`;
  if (isAdmin()) h += `<div class="card"><h2 style="margin-top:0">People</h2><p class="muted small">Scorekeepers can run live games. Admins can also edit the roster and lineups.</p>
    <div class="list">${S.members.map(mm => `<div class="li"><span class="grow"><b>${esc(mm.display_name || mm.email)}</b><br><span class="small muted">${esc(mm.email || '')}</span></span>
      ${mm.user_id === S.user.id ? '<span class="pill">You · admin</span>' : `<select data-role="${mm.user_id}" style="width:auto">${['parent', 'scorekeeper', 'admin'].map(r => `<option ${mm.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select><button class="ghost danger" data-rm="${mm.user_id}">Remove</button>`}</div>`).join('')}</div></div>`;
  view.innerHTML = h + '<p class="footnote">Forza 1 Volleyball · Forza 1 use only</p></div>';
  const ci = $('copyInv'); if (ci) ci.onclick = async () => { try { await navigator.clipboard.writeText(`Forza 1 ${S.team.name}: rotations and live scores (Forza 1 families only): ${inv}`); toast('Invite copied.'); } catch (e) { prompt('Copy this link:', inv); } };
  const si = $('shareInv'); if (si) si.onclick = () => navigator.share ? navigator.share({ title: S.team.name, text: 'Join our team app', url: inv }).catch(() => {}) : prompt('Copy this link:', inv);
  const ap = $('addP'); if (ap) ap.onclick = () => playerSheet(null);
  const pa = $('paste'); if (pa) pa.onclick = pasteSheet;
  view.querySelectorAll('[data-editp]').forEach(b => b.onclick = () => playerSheet(P(b.dataset.editp)));
  const nl = $('newL'); if (nl) nl.onclick = () => openEditor(null);
  view.querySelectorAll('[data-editl]').forEach(b => b.onclick = () => openEditor(b.dataset.editl));
  view.querySelectorAll('[data-viewl]').forEach(b => b.onclick = () => { S.lineupId = b.dataset.viewl; S.tab = 'rot'; render(); });
  view.querySelectorAll('[data-role]').forEach(s => s.onchange = async () => {
    const { error } = await sb.from('members').update({ role: s.value }).eq('team_id', S.team.id).eq('user_id', s.dataset.role); if (error) return fail(error); await loadAll(); toast('Role updated.');
  });
  view.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    const mm = S.members.find(x => x.user_id === b.dataset.rm);
    if (!confirm(`Remove ${mm.display_name || mm.email} from the team?`)) return;
    const { error } = await sb.from('members').delete().eq('team_id', S.team.id).eq('user_id', b.dataset.rm); if (error) return fail(error); await loadAll(); renderTeam();
  });
}
const POS = ['S', 'OH', 'MB', 'OPP', 'L', 'DS'];
function playerSheet(p) {
  sheet(`<h3>${p ? 'Edit player' : 'Add player'}</h3>
    <label for="pn">Name</label><input id="pn" value="${esc(p?.name || '')}">
    <label for="pj">Jersey number</label><input id="pj" inputmode="numeric" value="${esc(p?.number || '')}">
    <label for="pp">Position</label><select id="pp"><option value="">—</option>${POS.map(x => `<option ${p?.position === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <label for="ps">Status</label><select id="ps"><option value="starter">Starter</option><option value="alternate" ${p?.status === 'alternate' ? 'selected' : ''}>Alternate</option></select>
    <div class="row" style="margin-top:12px"><button class="primary" id="ok">Save</button>${p ? '<button class="danger" id="del">Delete</button>' : ''}<button data-close>Cancel</button></div>`,
    (c, close) => {
      c.querySelector('#ok').onclick = async () => {
        const row = { name: c.querySelector('#pn').value.trim(), number: c.querySelector('#pj').value.trim() || null, position: c.querySelector('#pp').value || null, status: c.querySelector('#ps').value };
        if (!row.name) return toast('Enter a name.');
        const q = p ? sb.from('players').update(row).eq('id', p.id) : sb.from('players').insert({ ...row, team_id: S.team.id, sort: S.players.length });
        const { error } = await q; if (error) return fail(error); close(); await loadAll(); renderTeam();
      };
      const d = c.querySelector('#del'); if (d) d.onclick = async () => {
        if (!confirm(`Delete ${p.name}? Her stats in past games will show as a dash.`)) return;
        const { error } = await sb.from('players').delete().eq('id', p.id); if (error) return fail(error); close(); await loadAll(); renderTeam();
      };
    });
}
export function parseRoster(text) {
  const out = [];
  text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
    if (/^(#|number|no\.?|jersey|name)\b/i.test(line) && /name/i.test(line)) return; // header
    let parts = line.includes('\t') ? line.split('\t') : line.includes(',') ? line.split(',') : null;
    let toks = parts ? parts.map(s => s.trim()).filter(Boolean) : line.split(/\s+/);
    let number = null, position = null, status = 'starter';
    const nameT = [];
    toks.forEach(t => {
      const u = t.replace(/[()#.]/g, '').toUpperCase();
      if (!number && /^\d{1,3}$/.test(u)) return number = u;
      if (/^(ALT|ALTERNATE|SUB|BENCH|RESERVE)$/.test(u)) return status = 'alternate';
      if (/^(STARTER|START)$/.test(u)) return status = 'starter';
      const map = { S: 'S', SETTER: 'S', OH: 'OH', OUTSIDE: 'OH', LH: 'OH', MB: 'MB', M: 'MB', MIDDLE: 'MB', MH: 'MB', OPP: 'OPP', RS: 'OPP', RH: 'OPP', OPPOSITE: 'OPP', L: 'L', LIB: 'L', LIBERO: 'L', DS: 'DS' };
      if (!position && map[u] && (nameT.length || toks.length > 2 || parts)) return position = map[u];
      nameT.push(t);
    });
    const name = nameT.join(' ').trim(); if (name) out.push({ name, number, position, status });
  });
  return out;
}
function pasteSheet() {
  sheet(`<h3>Paste roster</h3><p class="muted small">One player per line. Copy from a spreadsheet or type it. Add "alt" for alternates.</p>
    <textarea id="rt" placeholder="12 Jane Lucia MB&#10;4 Ava Smith S&#10;7 Bella Jones OH&#10;15 Cora Lee S alt"></textarea>
    <div id="pv" class="small" style="margin-top:8px"></div>
    <div class="row" style="margin-top:12px"><button class="primary" id="ok" disabled>Add players</button><button data-close>Cancel</button></div>`,
    (c, close) => {
      let rows = [];
      c.querySelector('#rt').oninput = e => {
        rows = parseRoster(e.target.value);
        c.querySelector('#pv').innerHTML = rows.length ? `<table><thead><tr><th>#</th><th>Name</th><th>Pos</th><th>Status</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.number || '')}</td><td>${esc(r.name)}</td><td>${esc(r.position || '')}</td><td>${r.status}</td></tr>`).join('')}</tbody></table>` : '';
        c.querySelector('#ok').disabled = !rows.length; c.querySelector('#ok').textContent = `Add ${rows.length} player${rows.length === 1 ? '' : 's'}`;
      };
      c.querySelector('#ok').onclick = async () => {
        const { error } = await sb.from('players').insert(rows.map((r, i) => ({ ...r, team_id: S.team.id, sort: S.players.length + i }))); if (error) return fail(error);
        close(); await loadAll(); renderTeam(); toast(rows.length + ' players added.');
      };
    });
}

// ---------- Lineup editor ----------
function autoSlots(L) {
  const cs = E.codes(L), used = new Set(Object.values(L.slots).filter(Boolean));
  const want = { S: ['S'], OH: ['OH'], M: ['MB'], OPP: ['OPP', 'OH'] };
  cs.forEach(code => {
    if (L.slots[code]) return;
    const k = code === 'OPP' ? 'OPP' : code[0] === 'S' ? 'S' : code.startsWith('OH') ? 'OH' : 'M';
    const pick = S.players.filter(p => p.status === 'starter' && !used.has(p.id)).find(p => want[k].includes(p.position));
    if (pick) { L.slots[code] = pick.id; used.add(pick.id); }
  });
  if (!L.libero) { const lib = S.players.find(p => p.position === 'L' && !used.has(p.id)); if (lib) L.libero = lib.id; }
}
function openEditor(id) {
  const row = id ? S.lineups.find(l => l.id === id) : null;
  S.draft = { name: row?.name || 'Lineup ' + (S.lineups.length + 1), is_default: row ? row.is_default : !S.lineups.length, L: E.norm(JSON.parse(JSON.stringify(row?.data || {}))) };
  S.draftId = id; S.rot = 0; S.mode = 'spots';
  if (!row) autoSlots(S.draft.L);
  renderEditor();
}
function playerOptions(sel, allowNone = true) {
  const starters = S.players.filter(p => p.status !== 'alternate'), alts = S.players.filter(p => p.status === 'alternate');
  const o = p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc((p.number ? '#' + p.number + ' ' : '') + p.name + (p.position ? ' · ' + p.position : ''))}</option>`;
  return (allowNone ? '<option value="">—</option>' : '') + `<optgroup label="Starters">${starters.map(o).join('')}</optgroup>${alts.length ? `<optgroup label="Alternates">${alts.map(o).join('')}</optgroup>` : ''}`;
}
function renderEditor() {
  const D = S.draft, L = D.L, r = S.rot, mode = S.mode;
  const cs = E.codes(L);
  const usedTwice = (() => { const ids = cs.map(c => L.slots[c]).filter(Boolean); return ids.filter((x, i) => ids.indexOf(x) !== i); })();
  view.innerHTML = `<div class="stack">
    <div class="row"><button id="cancel">Back</button><span class="grow"></span><button class="primary" id="save">Save lineup</button></div>
    <div class="card"><label for="ln">Lineup name</label><input id="ln" value="${esc(D.name)}">
      <label class="row" style="font-weight:500"><input type="checkbox" id="def" style="width:auto;min-height:0" ${D.is_default ? 'checked' : ''}> Default lineup parents see</label>
      <div class="row"><div class="grow"><label for="sys">System</label><select id="sys">${['6-2', '5-1', '4-2'].map(s => `<option ${L.sys === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="grow"><label for="ord">Order</label><select id="ord"><option value="a" ${L.ord === 'a' ? 'selected' : ''}>Setter, outside, middle</option><option value="b" ${L.ord === 'b' ? 'selected' : ''}>Setter, middle, outside</option></select></div></div></div>
    <div class="card"><h3>Starters</h3><p class="muted small">Rotation 1 spots: ${cs.map((c, i) => `${c} = spot ${i + 1}`).join(', ')}.</p>
      ${cs.map(c => `<label for="sl-${c}">${c} · ${E.baseRole(c)}</label><select id="sl-${c}" data-slot="${c}">${playerOptions(L.slots[c])}</select>`).join('')}
      ${usedTwice.length ? `<div class="status bad">${esc(pname(usedTwice[0]))} is in two spots.</div>` : ''}</div>
    <div class="card"><h3>Libero</h3><label class="row" style="font-weight:500"><input type="checkbox" id="libOn" style="width:auto;min-height:0" ${L.libOn ? 'checked' : ''}> Use a libero</label>
      ${L.libOn ? `<label for="lib">Libero</label><select id="lib">${playerOptions(L.libero)}</select>
      <label>Libero replaces (back row only)</label><div class="chips">${cs.filter(c => E.kind(L, c) !== 's').map(c => `<button data-lf="${c}" aria-pressed="${L.libFor.includes(c)}">${c}${L.slots[c] ? ' ' + esc(first(L.slots[c])) : ''}</button>`).join('')}</div>
      <label for="ls">When her player rotates to serve</label><select id="ls"><option value="0">Player serves, libero in after</option><option value="1" ${L.libServes ? 'selected' : ''}>Libero serves</option></select>` : ''}</div>
    <div class="card"><div class="row"><h3 class="grow" style="margin:0">Substitutions</h3><button id="addSub">Add sub</button></div>
      <p class="muted small">Pick the alternate, who she replaces, and the rotations she plays. The libero wins in the back row.</p>
      ${L.subs.map(s => `<div style="border-top:1px solid var(--line);padding:10px 0" data-sub="${s.id}">
        <div class="row"><b class="grow">${s.id}</b><button class="ghost danger" data-subdel="${s.id}">Remove</button></div>
        <label>Player coming in</label><select data-subp>${playerOptions(s.player)}</select>
        <label>Comes in for</label><select data-subfor>${cs.map(c => `<option value="${c}" ${s.for === c ? 'selected' : ''}>${c}${L.slots[c] ? ' · ' + esc(pname(L.slots[c])) : ''}</option>`).join('')}</select>
        <label>Plays in rotations</label><div class="seg">${[0, 1, 2, 3, 4, 5].map(i => `<button data-subr="${i}" aria-pressed="${s.rots.includes(i)}" title="${E.isFront(L, i, s.for) ? 'front row' : 'back row'}">${i + 1}${E.isFront(L, i, s.for) ? 'F' : 'B'}</button>`).join('')}</div>
        <div class="chips" style="margin-top:6px"><button data-subq="back">Back row</button><button data-subq="front">Front row</button><button data-subq="all">All</button><button data-subq="none">None</button></div></div>`).join('') || '<p class="muted small">No subs.</p>'}</div>
    <div class="card"><h3>Positions on the court</h3><p class="muted small">Drag players to match the coach's chart. Saves with the lineup.</p>
      <div class="stack">${rotButtons(r)}${modeButtons(mode)}</div><div style="height:8px"></div>
      <div id="board">${courtHTML(L, r, mode, { drag: true })}</div>${statusHTML(L, r, mode)}
      <div class="row" style="margin-top:8px"><button id="resetView">Reset this view</button></div></div>
    <h2>All six</h2>${miniGrid(L, mode, r, rr => caption(L, rr, mode))}
    ${S.draftId ? '<div class="row"><button class="danger" id="delL">Delete lineup</button></div>' : ''}</div>`;
  const re = () => renderEditor();
  $('cancel').onclick = () => { if (!confirm('Leave without saving?')) return; S.draft = null; renderTeam(); };
  $('ln').oninput = e => D.name = e.target.value;
  $('def').onchange = e => D.is_default = e.target.checked;
  $('sys').onchange = e => { const old = L.slots; L.sys = e.target.value; L.slots = {}; E.codes(L).forEach(c => { if (old[c]) L.slots[c] = old[c]; }); if (L.sys === '5-1' && old.S1) L.slots.S = old.S1; L.custom = {}; autoSlots(L); re(); };
  $('ord').onchange = e => { L.ord = e.target.value; L.custom = {}; re(); };
  view.querySelectorAll('[data-slot]').forEach(s => s.onchange = () => { L.slots[s.dataset.slot] = s.value || undefined; if (!s.value) delete L.slots[s.dataset.slot]; re(); });
  $('libOn').onchange = e => { L.libOn = e.target.checked; if (L.libOn && !L.libFor.length) L.libFor = E.codes(L).filter(c => E.kind(L, c) === 'm').slice(0, 2); re(); };
  const lb = $('lib'); if (lb) lb.onchange = () => { L.libero = lb.value || null; re(); };
  const ls = $('ls'); if (ls) ls.onchange = () => { L.libServes = ls.value === '1'; re(); };
  view.querySelectorAll('[data-lf]').forEach(b => b.onclick = () => { const c = b.dataset.lf, i = L.libFor.indexOf(c); i >= 0 ? L.libFor.splice(i, 1) : L.libFor.push(c); re(); });
  $('addSub').onclick = () => {
    let n = 1; L.subs.forEach(s => n = Math.max(n, +s.id.slice(1) + 1));
    const alt = S.players.find(p => p.status === 'alternate' && !L.subs.some(s => s.player === p.id));
    const forC = E.codes(L).find(c => c.startsWith('OH')) || E.codes(L)[1];
    L.subs.push({ id: 'X' + n, player: alt?.id || null, for: forC, rots: [0, 1, 2, 3, 4, 5].filter(i => !E.isFront(L, i, forC)) }); re();
  };
  view.querySelectorAll('[data-sub]').forEach(box => {
    const s = L.subs.find(x => x.id === box.dataset.sub);
    box.querySelector('[data-subp]').onchange = e => { s.player = e.target.value || null; re(); };
    box.querySelector('[data-subfor]').onchange = e => { s.for = e.target.value; re(); };
    box.querySelectorAll('[data-subr]').forEach(b => b.onclick = () => { const i = +b.dataset.subr, k = s.rots.indexOf(i); k >= 0 ? s.rots.splice(k, 1) : s.rots.push(i); re(); });
    box.querySelectorAll('[data-subq]').forEach(b => b.onclick = () => { const q = b.dataset.subq; s.rots = [0, 1, 2, 3, 4, 5].filter(i => q === 'all' || (q === 'back' && !E.isFront(L, i, s.for)) || (q === 'front' && E.isFront(L, i, s.for))); re(); });
    box.querySelector('[data-subdel]').onclick = () => { L.subs = L.subs.filter(x => x !== s); re(); };
  });
  bindRotNav(re);
  bindDrag($('board'), L, r, mode, (code, xy, keep) => {
    if (code) { const k = E.ckey(r, mode); L.custom[k] = L.custom[k] || {}; L.custom[k][code] = xy; }
    re(); if (keep) { const c = view.querySelector(`#board [data-code="${code}"]`); c && c.focus(); }
  });
  $('resetView').onclick = () => { delete L.custom[E.ckey(r, mode)]; re(); };
  $('save').onclick = async () => {
    if (!D.name.trim()) return toast('Name the lineup.');
    const missing = E.codes(L).filter(c => !L.slots[c]);
    if (missing.length && !confirm(`No player set for ${missing.join(', ')}. Save anyway?`)) return;
    $('save').disabled = true;
    try {
      if (D.is_default) { const { error } = await sb.from('lineups').update({ is_default: false }).eq('team_id', S.team.id).neq('id', S.draftId || '00000000-0000-0000-0000-000000000000'); if (error) throw error; }
      const row = { name: D.name.trim(), data: L, is_default: D.is_default, updated_at: new Date().toISOString() };
      const q = S.draftId ? sb.from('lineups').update(row).eq('id', S.draftId).select().single() : sb.from('lineups').insert({ ...row, team_id: S.team.id }).select().single();
      const { data, error } = await q; if (error) throw error;
      S.draft = null; S.lineupId = data.id; await loadAll(); renderTeam(); toast('Lineup saved.');
    } catch (e) { $('save').disabled = false; fail(e); }
  };
  const dl = $('delL'); if (dl) dl.onclick = async () => {
    if (!confirm('Delete this lineup? Past games keep their own copy.')) return;
    const { error } = await sb.from('lineups').delete().eq('id', S.draftId); if (error) return fail(error);
    S.draft = null; await loadAll(); renderTeam();
  };
}

// ---------------- boot ----------------
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  S.user = session?.user || null;
  if (!S.user) return authView('email');
  try { await loadAll(); } catch (e) { return fail(e); }
  if (!S.member) return onboardView();
  if (new URLSearchParams(location.search).has('join')) history.replaceState(null, '', location.pathname);
  subscribe(); render();
}
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN' && !S.team) boot(); if (ev === 'SIGNED_OUT') location.reload(); });
boot();
