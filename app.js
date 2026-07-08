/* Trove — personal inventory PWA. Implements the "Trove Inventory" Claude Design prototype (variant 1a). */
'use strict';

/* ================= persistence ================= */
const KEY = 'trove.v1';

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && Array.isArray(d.rooms)) return d;
    }
  } catch (e) { /* corrupted — start fresh */ }
  return { rooms: [], dismissed: [] };
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* storage full */ } }
function uid(p) { return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

let db = load();

/* ================= ephemeral state ================= */
let view = { screen: 'home', roomId: null, boxId: null };
let ui = {
  addText: '', searchQ: '',
  menu: null, rename: null, importOpen: false,
  drag: null, suppressClick: false,
  cam: null, camStream: null,
  voice: null, rec: null,
  toastTimer: null
};

/* ================= reference data (from prototype) ================= */
const CATALOG = [
  { name: 'Disinfecting Wipes', brand: 'Clorox', category: 'Cleaning' },
  { name: 'Bleach', brand: 'Clorox', category: 'Cleaning' },
  { name: 'Toilet Bowl Cleaner', brand: 'Clorox', category: 'Cleaning' },
  { name: 'Glass Cleaner', brand: 'Windex', category: 'Cleaning' },
  { name: 'Disinfectant Spray', brand: 'Lysol', category: 'Cleaning' },
  { name: 'Dish Soap', brand: 'Dawn', category: 'Cleaning' },
  { name: 'Laundry Detergent', brand: 'Tide', category: 'Cleaning' },
  { name: 'Paper Towels', brand: 'Bounty', category: 'Cleaning' },
  { name: 'Magic Eraser', brand: 'Mr. Clean', category: 'Cleaning' },
  { name: 'AA Batteries', brand: 'Duracell', category: 'Electronics' },
  { name: 'AAA Batteries', brand: 'Energizer', category: 'Electronics' },
  { name: 'USB-C Cable', brand: 'Anker', category: 'Electronics' },
  { name: '20W Charger', brand: 'Apple', category: 'Electronics' },
  { name: 'Power Strip', brand: 'Belkin', category: 'Electronics' },
  { name: 'HDMI Cable', brand: '', category: 'Electronics' },
  { name: 'Phone Charger', brand: '', category: 'Electronics' },
  { name: 'Duct Tape', brand: '3M', category: 'Tools' },
  { name: 'Screwdriver Set', brand: 'Craftsman', category: 'Tools' },
  { name: 'Flashlight', brand: 'Maglite', category: 'Tools' },
  { name: 'Tape Measure', brand: 'Stanley', category: 'Tools' },
  { name: 'Cordless Drill', brand: 'DeWalt', category: 'Tools' },
  { name: 'Zip Ties', brand: '', category: 'Tools' },
  { name: 'Scissors', brand: 'Fiskars', category: 'Tools' },
  { name: 'Olive Oil', brand: 'Kirkland', category: 'Pantry' },
  { name: 'Espresso Beans', brand: 'Lavazza', category: 'Pantry' },
  { name: 'Ski Gloves', brand: 'The North Face', category: 'Clothing' },
  { name: 'Wool Scarves', brand: '', category: 'Clothing' },
  { name: 'String Lights', brand: 'GE', category: 'Holiday' },
  { name: 'Ornament Set', brand: '', category: 'Holiday' }
];
const UNIT_VOL = { Cleaning: 2, Tools: 1.2, Electronics: 0.35, Pantry: 0.9, Clothing: 2.5, Books: 0.7, Holiday: 2, General: 1 };
const SYNONYMS = { clean: 'cleaning', cleaner: 'cleaning', cleaners: 'cleaning', wipes: 'cleaning', battery: 'electronics', batteries: 'electronics', charger: 'electronics', chargers: 'electronics', cable: 'electronics', cables: 'electronics', electronic: 'electronics', tool: 'tools', decor: 'holiday', 'décor': 'holiday', christmas: 'holiday', food: 'pantry', winter: 'clothing', clothes: 'clothing', gloves: 'clothing', book: 'books' };

/* ================= helpers ================= */
const $ = sel => document.querySelector(sel);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function findRoom(id) { return db.rooms.find(r => r.id === id); }
function currentRoom() { return findRoom(view.roomId); }
function currentBox() {
  const r = currentRoom();
  return r ? r.boxes.find(b => b.id === view.boxId) : null;
}
function locateBox(boxId) {
  for (const r of db.rooms) { const b = r.boxes.find(x => x.id === boxId); if (b) return { room: r, box: b }; }
  return null;
}
function boxUsage(box) {
  const used = box.items.reduce((a, i) => a + i.qty * (UNIT_VOL[i.category] || 1), 0);
  const vol = box.vol || 40;
  return { used: Math.round(used * 10) / 10, pct: Math.min(100, Math.round(used / vol * 100)) };
}
function itemQtySum(box) { return box.items.reduce((a, i) => a + i.qty, 0); }

function inferMeta(name) {
  const n = name.toLowerCase();
  for (const r of db.rooms) for (const b of r.boxes) {
    const hit = b.items.find(i => i.name.toLowerCase() === n);
    if (hit) return { brand: hit.brand, category: hit.category };
  }
  const c = CATALOG.find(c => c.name.toLowerCase() === n);
  if (c) return { brand: c.brand, category: c.category };
  return { brand: '', category: 'General' };
}

function addItemsToCurrentBox(list) {
  const box = currentBox();
  if (!box || !list.length) return;
  list.forEach(n => {
    const ex = box.items.find(i => i.name.toLowerCase() === n.name.toLowerCase() && (i.brand || '').toLowerCase() === (n.brand || '').toLowerCase());
    if (ex) ex.qty += (n.qty || 1);
    else box.items.push({ id: uid('i'), name: n.name, brand: n.brand || '', category: n.category || 'General', qty: n.qty || 1 });
  });
  save();
  const count = list.reduce((a, n) => a + (n.qty || 1), 0);
  toast(count === 1 ? 'Added ' + list[0].name : 'Added ' + count + ' items');
}

function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#app').appendChild(el);
  clearTimeout(ui.toastTimer);
  ui.toastTimer = setTimeout(() => el.remove(), 1800);
}

/* ================= search (ported from prototype) ================= */
function searchInventory(q) {
  const norm = t => t.toLowerCase();
  const tokens = norm(q).split(/[^a-z0-9é'-]+/i).filter(t => t.length > 1 && ['the', 'of', 'my', 'supplies', 'stuff', 'things'].indexOf(t) < 0);
  if (!tokens.length) return { items: [], places: [] };
  const brandCats = {};
  const allItems = [];
  db.rooms.forEach(r => r.boxes.forEach(b => b.items.forEach(i => {
    allItems.push({ item: i, room: r, box: b });
    if (i.brand) { const bk = norm(i.brand); (brandCats[bk] = brandCats[bk] || {})[norm(i.category)] = true; }
  })));
  CATALOG.forEach(c => { if (c.brand) { const bk = norm(c.brand); (brandCats[bk] = brandCats[bk] || {})[norm(c.category)] = true; } });
  const scored = allItems.map(e => {
    let s = 0, reason = null;
    tokens.forEach(tok => {
      const cat = norm(e.item.category);
      const brand = norm(e.item.brand);
      if (brand && (brand.indexOf(tok) === 0 || brand.split(/\s+/).some(w => w.indexOf(tok) === 0))) { s += 100; reason = 'BRAND'; }
      if (norm(e.item.name).indexOf(tok) >= 0) { s += 40; }
      const catTok = SYNONYMS[tok] || tok;
      if (cat.indexOf(catTok) === 0) { s += 25; if (!reason) reason = 'CATEGORY'; }
      const bc = brandCats[tok];
      if (bc && bc[cat] && brand.indexOf(tok) !== 0) { s += 10; if (!reason) reason = 'RELATED'; }
    });
    return { ...e, score: s, reason };
  }).filter(e => e.score > 0).sort((a, b) => b.score - a.score);
  const places = [];
  db.rooms.forEach(r => {
    if (tokens.some(t => norm(r.name).indexOf(t) >= 0)) places.push({ kind: 'ROOM', name: r.name, meta: r.boxes.length + ' boxes', roomId: r.id, boxId: null });
    r.boxes.forEach(b => {
      if (tokens.some(t => norm(b.name).indexOf(t) >= 0)) places.push({ kind: 'BOX', name: b.name, meta: r.name, roomId: r.id, boxId: b.id });
    });
  });
  return { items: scored.slice(0, 10), places: places.slice(0, 5) };
}

/* ================= organize recommendations (ported) ================= */
function moveItemsBetween(srcId, dstId, pred) {
  const src = locateBox(srcId), dst = locateBox(dstId);
  if (!src || !dst) return;
  const moved = src.box.items.filter(pred);
  src.box.items = src.box.items.filter(i => !pred(i));
  moved.forEach(m => {
    const ex = dst.box.items.find(i => i.name === m.name && i.brand === m.brand);
    if (ex) ex.qty += m.qty;
    else dst.box.items.push(m);
  });
  save();
}
function mergeBoxes(srcId, dstId) {
  moveItemsBetween(srcId, dstId, () => true);
  db.rooms.forEach(r => { r.boxes = r.boxes.filter(b => b.id !== srcId); });
  save();
}
function buildRecs() {
  const recs = [];
  const catBoxes = {};
  db.rooms.forEach(r => r.boxes.forEach(b => {
    const byCat = {};
    b.items.forEach(i => { (byCat[i.category] = byCat[i.category] || []).push(i); });
    Object.keys(byCat).forEach(c => { (catBoxes[c] = catBoxes[c] || []).push({ r, b, items: byCat[c] }); });
  }));
  Object.keys(catBoxes).forEach(c => {
    if (c === 'General') return;
    const entries = catBoxes[c];
    if (entries.length < 2) return;
    const home = entries.slice().sort((x, y) => y.items.length - x.items.length)[0];
    entries.forEach(e => {
      if (e === home) return;
      recs.push({
        key: 'cons-' + c + '-' + e.b.id, tag: 'CONSOLIDATE',
        title: 'Keep ' + c.toLowerCase() + ' in one box',
        detail: 'Move ' + e.items.map(i => i.name).join(', ') + ' from ' + e.r.name + ' · ' + e.b.name + ' into ' + home.b.name + ' (' + home.r.name + ').',
        impact: 'One place to look for ' + c.toLowerCase() + '.',
        apply: () => moveItemsBetween(e.b.id, home.b.id, i => i.category === c)
      });
    });
  });
  let best = null;
  db.rooms.forEach(r => {
    r.boxes.forEach(a => r.boxes.forEach(b => {
      if (a === b) return;
      const ua = boxUsage(a), ub = boxUsage(b);
      if (ua.pct > 0 && ua.pct < 40 && ub.pct < 60 && (ua.used + ub.used) <= (b.vol || 40) * 0.9) {
        const score = ua.pct + ub.pct;
        if (!best || score < best.score) best = { a, b, ua, score };
      }
    }));
  });
  if (best) {
    const bb = best;
    recs.push({
      key: 'merge-' + bb.a.id + '-' + bb.b.id, tag: 'FREE A BOX',
      title: 'Empty out ' + bb.a.name,
      detail: 'Everything in ' + bb.a.name + ' (' + bb.ua.pct + '% full) fits inside ' + bb.b.name + ' — same room.',
      impact: 'Frees a ' + (bb.a.vol || 40) + ' L box.',
      apply: () => mergeBoxes(bb.a.id, bb.b.id)
    });
  }
  db.rooms.forEach(r => r.boxes.forEach(b => {
    const u = boxUsage(b);
    if (u.pct < 95 || r.boxes.length < 2) return;
    const dst = r.boxes.filter(x => x !== b).sort((x, y) => boxUsage(x).pct - boxUsage(y).pct)[0];
    const big = b.items.slice().sort((x, y) => (y.qty * (UNIT_VOL[y.category] || 1)) - (x.qty * (UNIT_VOL[x.category] || 1)))[0];
    if (!dst || !big) return;
    recs.push({
      key: 'over-' + b.id, tag: 'OVERFULL',
      title: b.name + ' is packed tight',
      detail: 'Move ' + big.name + ' ×' + big.qty + ' into ' + dst.name + ' (' + boxUsage(dst).pct + '% full).',
      impact: 'Brings ' + b.name + ' back under capacity.',
      apply: () => moveItemsBetween(b.id, dst.id, i => i.id === big.id)
    });
  }));
  const dismissed = db.dismissed || [];
  return recs.filter(x => dismissed.indexOf(x.key) < 0).slice(0, 4);
}

/* ================= voice parsing ================= */
const NUM_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12, couple: 2, few: 3 };
function titleCase(s) { return s.replace(/\b[a-z]/g, c => c.toUpperCase()); }
function parseVoiceItems(transcript) {
  const parts = transcript.toLowerCase()
    .replace(/\band\b/g, ',').replace(/\bplus\b/g, ',')
    .split(/[,;.]/).map(s => s.trim()).filter(Boolean);
  const out = [];
  parts.forEach(p => {
    let qty = 1;
    let m = p.match(/^(\d+|a couple of|a few|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a dozen)\s+(.+)$/);
    if (m) {
      const qw = m[1].replace(/^a /, '').trim();
      qty = /^\d+$/.test(qw) ? parseInt(qw, 10) : (NUM_WORDS[qw] || 1);
      p = m[2];
    }
    p = p.replace(/^(bottles?|rolls?|packs?|pairs?|cans?|bags?|sets?|boxes?|tubes?|jars?)\s+of\s+/, '').trim();
    if (!p) return;
    const singular = p.length > 3 && p.endsWith('s') && !p.endsWith('ss') ? p.slice(0, -1) : p;
    const cat = CATALOG.find(c => {
      const cn = c.name.toLowerCase();
      return cn === p || cn === singular || cn.indexOf(p) >= 0 || p.indexOf(cn) >= 0;
    });
    if (cat) out.push({ name: cat.name, brand: cat.brand, category: cat.category, qty });
    else {
      const meta = inferMeta(titleCase(p));
      out.push({ name: titleCase(p), brand: meta.brand, category: meta.category, qty });
    }
  });
  return out;
}

/* ================= rendering ================= */
function render() {
  stopCameraStream(false);
  const app = $('#app');
  let html = '';
  if (view.screen === 'home') html = tplHome();
  else if (view.screen === 'room') html = tplRoom();
  else if (view.screen === 'box') html = tplBox();
  else if (view.screen === 'search') html = tplSearch();
  else if (view.screen === 'organize') html = tplOrganize();
  html += tplOverlays();
  app.innerHTML = html;
  bind();
}

/* ---------- home ---------- */
function tplHome() {
  const statBoxes = db.rooms.reduce((a, r) => a + r.boxes.length, 0);
  const statItems = db.rooms.reduce((a, r) => a + r.boxes.reduce((x, b) => x + itemQtySum(b), 0), 0);
  const recCount = buildRecs().length;
  const rooms = db.rooms.map(r => {
    const items = r.boxes.reduce((a, b) => a + b.items.length, 0);
    const lifted = ui.drag && ui.drag.kind === 'room' && ui.drag.id === r.id;
    return `<div class="room-card${lifted ? ' card-lifted' : ''}" data-nav-room="${r.id}" data-drag-id="${r.id}" data-drag-kind="room">
      <span class="watermark">${esc(r.name.charAt(0))}</span>
      <span class="name">${esc(r.name)}</span>
      <span class="meta">${r.boxes.length} ${r.boxes.length === 1 ? 'box' : 'boxes'} · ${items} ${items === 1 ? 'item' : 'items'}</span>
    </div>`;
  }).join('');
  return `<div class="screen home">
    <div class="wordmark-wrap">
      <div class="wordmark">Trove</div>
      <div class="gold-rule"></div>
      <div class="stats">${db.rooms.length} ROOMS · ${statBoxes} BOXES · ${statItems} ITEMS</div>
    </div>
    <div class="room-grid">
      ${rooms}
      <div class="add-card span" data-act="add-room">＋ New room</div>
    </div>
    ${db.rooms.length === 0 ? '<div class="empty-note">Welcome to Trove.<br>Create a room — Garage, Closet, Storage Unit —<br>then add boxes and what’s inside them.</div>' : ''}
  </div>
  <div class="bottom-bar">
    <div class="search-pill" data-act="go-search"><div class="lens"></div><span class="hint">Search everything…</span></div>
    <div class="fab purple" data-act="go-organize" title="Organize suggestions">✦${recCount > 0 ? `<span class="badge">${recCount}</span>` : ''}</div>
    <div class="fab gold" data-act="add-room">＋</div>
  </div>`;
}

/* ---------- room ---------- */
function tplRoom() {
  const room = currentRoom();
  if (!room) { view = { screen: 'home', roomId: null, boxId: null }; return tplHome(); }
  const itemCount = room.boxes.reduce((a, b) => a + b.items.length, 0);
  const boxes = room.boxes.map(b => {
    const u = boxUsage(b);
    const lifted = ui.drag && ui.drag.kind === 'box' && ui.drag.id === b.id;
    const preview = b.items.slice(0, 3).map(i => i.name).join(' · ') || '—';
    return `<div class="box-card${lifted ? ' card-lifted' : ''}" data-nav-box="${b.id}" data-drag-id="${b.id}" data-drag-kind="box">
      <div class="tag">${esc(b.tag)}</div>
      <div class="name">${esc(b.name)}</div>
      <div class="count">${b.items.length} ${b.items.length === 1 ? 'item' : 'items'}</div>
      <div class="preview">${esc(preview)}</div>
      <div class="volrow">
        <div class="meter"><div class="${u.pct >= 90 ? 'hot' : ''}" style="width:${u.pct}%"></div></div>
        <span class="vol-label">${b.vol || 40} L · ${u.pct}% full</span>
      </div>
    </div>`;
  }).join('');
  return `<div class="screen">
    <div class="head">
      <div class="icon-btn" data-act="go-home">‹</div>
      <div class="titles">
        <span class="title">${esc(room.name)}</span>
        <span class="sub">${room.boxes.length} ${room.boxes.length === 1 ? 'box' : 'boxes'} · ${itemCount} ${itemCount === 1 ? 'item' : 'items'}</span>
      </div>
      <div class="icon-btn dots" data-act="room-menu">⋯</div>
    </div>
    <div class="box-grid">
      ${boxes}
      <div class="add-card boxy" data-act="add-box"><span class="plus">＋</span><span class="lbl">New box</span></div>
    </div>
  </div>`;
}

/* ---------- box ---------- */
function tplBox() {
  const room = currentRoom(), box = currentBox();
  if (!room || !box) { view = { screen: 'home', roomId: null, boxId: null }; return tplHome(); }
  const u = boxUsage(box);
  const chips = [['S', 20], ['M', 40], ['L', 60], ['XL', 90]].map(d =>
    `<div class="size-chip${box.vol === d[1] ? ' active' : ''}" data-vol="${d[1]}">${d[0]} · ${d[1]} L</div>`).join('');
  const items = box.items.map(it => `
    <div class="item-row">
      <div class="info">
        <span class="iname">${esc(it.name)}</span>
        <div class="badges">
          ${it.brand ? `<span class="brand-badge">${esc(it.brand)}</span>` : ''}
          <span class="cat-badge">${esc(it.category)}</span>
        </div>
      </div>
      <div class="qty-ctrl">
        <div class="qty-btn" data-dec="${it.id}">−</div>
        <span class="qty-num">${it.qty}</span>
        <div class="qty-btn" data-inc="${it.id}">＋</div>
      </div>
    </div>`).join('');
  return `<div class="screen boxview">
    <div class="head">
      <div class="icon-btn" data-act="go-room-back">‹</div>
      <div class="titles">
        <span class="title sm">${esc(box.name)}</span>
        <span class="sub">${esc(room.name)} · ${esc(box.tag)}</span>
      </div>
      <div class="icon-btn dots" data-act="box-menu">⋯</div>
    </div>
    <div class="cap-card">
      <div class="row"><span class="cap-tag">CAPACITY</span><span class="cap-val">${u.used} of ${box.vol || 40} L · ${u.pct}% full</span></div>
      <div class="meter"><div class="${u.pct >= 90 ? 'hot' : ''}" style="width:${u.pct}%"></div></div>
      ${box.dims ? `<span class="dims">≈ ${esc(box.dims)} — measured by camera</span>` : ''}
      <div class="chip-row">${chips}<div class="measure-link" data-act="open-measure">⤢ Measure</div></div>
    </div>
    <div class="item-list">
      ${items}
      ${box.items.length === 0 ? '<div class="empty-note">Empty box — add items below,<br>or use the camera / mic for bulk entry.</div>' : ''}
    </div>
    <div class="add-zone">
      <div id="suggest-pop"></div>
      <div class="add-bar">
        <input id="add-input" class="text-input" placeholder="Add an item…" autocomplete="off" value="${esc(ui.addText)}">
        <div class="tool-btn" data-act="open-camera" title="Scan with camera"><div class="cam-glyph"><div></div></div></div>
        <div class="tool-btn" data-act="open-voice" title="Dictate items"><div class="mic-glyph"><div class="head"></div><div class="base"></div></div></div>
      </div>
    </div>
  </div>`;
}

function tplSuggestions() {
  const q = ui.addText.trim().toLowerCase();
  if (q.length < 2) return '';
  const seen = {};
  const pool = [];
  db.rooms.forEach(r => r.boxes.forEach(b => b.items.forEach(i => {
    const k = (i.name + '|' + i.brand).toLowerCase();
    if (!seen[k]) { seen[k] = 1; pool.push({ name: i.name, brand: i.brand, category: i.category }); }
  })));
  CATALOG.forEach(c => {
    const k = (c.name + '|' + c.brand).toLowerCase();
    if (!seen[k]) { seen[k] = 1; pool.push(c); }
  });
  const hits = pool.filter(c => c.name.toLowerCase().indexOf(q) >= 0 || (c.brand || '').toLowerCase().indexOf(q) >= 0).slice(0, 4);
  if (!hits.length) return '';
  return `<div class="suggest-pop">${hits.map((c, ix) => `
    <div class="suggest-row" data-pick="${ix}">
      <span class="slabel">${esc(c.name)}</span>
      ${c.brand ? `<span class="sbrand">${esc(c.brand)}</span>` : ''}
      <span class="scat">${esc(c.category)}</span>
    </div>`).join('')}</div>`;
}

/* ---------- search ---------- */
function tplSearch() {
  return `<div class="screen">
    <div class="head">
      <div class="icon-btn" data-act="go-home">‹</div>
      <input id="search-input" class="text-input" placeholder="Try &#8220;Clorox&#8221; or &#8220;cleaning supplies&#8221;…" autocomplete="off" value="${esc(ui.searchQ)}">
    </div>
    <div id="search-results">${tplSearchResults()}</div>
  </div>`;
}
function tplSearchResults() {
  const q = ui.searchQ.trim();
  if (q.length < 2) {
    const chips = ['Clorox', 'Cleaning supplies', 'Batteries', 'Chargers', 'Winter'].map(l => `<div class="try-chip" data-chip="${esc(l)}">${esc(l)}</div>`).join('');
    return `<div style="display:flex;flex-direction:column;gap:12px">
      <span class="section-label">TRY SEARCHING</span>
      <div class="try-chips">${chips}</div>
      <div class="search-tip">Search understands brands and categories. Ask for <em>Clorox</em> and Clorox items rank first — with other cleaning supplies right behind them.</div>
    </div>`;
  }
  const res = searchInventory(q);
  let out = '';
  if (res.items.length) {
    out += `<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px"><span class="section-label">ITEMS</span>`;
    out += res.items.map(e => {
      const cls = e.reason === 'BRAND' ? 'brand' : (e.reason === 'CATEGORY' ? 'category' : 'related');
      const lbl = e.reason === 'BRAND' ? 'BRAND MATCH' : (e.reason === 'CATEGORY' ? 'CATEGORY' : 'RELATED');
      return `<div class="result-row" data-open-box="${e.box.id}" data-open-room="${e.room.id}">
        <div class="info">
          <div class="toprow"><span class="rname">${esc(e.item.name)}</span>${e.reason ? `<span class="reason-badge ${cls}">${lbl}</span>` : ''}</div>
          <span class="rloc">${esc(e.room.name)} → ${esc(e.box.name)}</span>
        </div>
        <span class="rqty">×${e.item.qty}</span>
      </div>`;
    }).join('');
    out += '</div>';
  }
  if (res.places.length) {
    out += `<div style="display:flex;flex-direction:column;gap:8px"><span class="section-label">ROOMS &amp; BOXES</span>`;
    out += res.places.map(p => `
      <div class="place-row" ${p.boxId ? `data-open-box="${p.boxId}" data-open-room="${p.roomId}"` : `data-open-room-only="${p.roomId}"`}>
        <span class="kind">${p.kind}</span>
        <span class="pname">${esc(p.name)}</span>
        <span class="pmeta">${esc(p.meta)}</span>
      </div>`).join('');
    out += '</div>';
  }
  if (!res.items.length && !res.places.length) out = `<div class="no-results">Nothing matches “${esc(q)}” yet.</div>`;
  return out;
}

/* ---------- organize ---------- */
function tplOrganize() {
  const recs = buildRecs();
  const cards = recs.map((rc, ix) => `
    <div class="rec-card">
      <span class="rec-tag">${esc(rc.tag)}</span>
      <span class="rec-title">${esc(rc.title)}</span>
      <span class="rec-detail">${esc(rc.detail)}</span>
      <span class="rec-impact">${esc(rc.impact)}</span>
      <div class="btn-row">
        <div class="btn primary" data-rec-apply="${ix}">Apply</div>
        <div class="btn ghost" data-rec-dismiss="${esc(rc.key)}">Dismiss</div>
      </div>
    </div>`).join('');
  return `<div class="screen">
    <div class="head">
      <div class="icon-btn" data-act="go-home">‹</div>
      <div class="titles">
        <span class="title">Organize</span>
        <span class="sub">Grouping suggestions from your inventory</span>
      </div>
    </div>
    ${recs.length ? `<div style="display:flex;flex-direction:column;gap:12px">${cards}</div>`
      : '<div class="empty-note" style="padding:40px 16px;border-radius:16px">Everything looks tidy.<br>Suggestions appear here as your inventory changes.</div>'}
    <div style="margin-top:auto;display:flex;flex-direction:column;gap:10px;padding-top:24px">
      <span class="section-label">BACKUP</span>
      <div class="btn-row" style="margin:0">
        <div class="btn ghost-gold" data-act="export-data">Export backup</div>
        <div class="btn ghost" data-act="import-data">Import</div>
      </div>
    </div>
  </div>`;
}

/* ---------- overlays (menu / rename / import / camera / voice) ---------- */
function tplOverlays() {
  let out = '';
  if (ui.menu) {
    let title = '';
    if (ui.menu.kind === 'room') { const r = findRoom(ui.menu.id); title = r ? r.name : ''; }
    else { const l = locateBox(ui.menu.id); title = l ? l.box.name : ''; }
    out += `<div class="menu-scrim" data-act="close-menu"></div>
    <div class="menu-sheet">
      <div class="m-title">${esc(title)}</div>
      <div class="m-item gold" data-act="menu-rename">Rename</div>
      <div class="m-item red" data-act="menu-delete">Delete</div>
      <div class="m-item dim" data-act="close-menu">Cancel</div>
    </div>`;
  }
  if (ui.rename) {
    out += `<div class="menu-scrim" data-act="rename-cancel"></div>
    <div class="rename-sheet">
      <span class="modal-label">RENAME</span>
      <input id="rename-input" class="rename-input" value="${esc(ui.rename.value)}" autocomplete="off">
      <div class="btn-row" style="margin:0">
        <div class="btn primary" data-act="rename-save">Save</div>
        <div class="btn ghost" data-act="rename-cancel">Cancel</div>
      </div>
    </div>`;
  }
  if (ui.importOpen) {
    out += `<div class="menu-scrim" data-act="import-cancel"></div>
    <div class="rename-sheet">
      <span class="modal-label">IMPORT BACKUP</span>
      <textarea id="import-input" class="rename-input" placeholder="Paste your Trove backup JSON here…"></textarea>
      <div class="btn-row" style="margin:0">
        <div class="btn primary" data-act="import-save">Restore</div>
        <div class="btn ghost" data-act="import-cancel">Cancel</div>
      </div>
    </div>`;
  }
  if (ui.cam) out += tplCamera();
  if (ui.voice) out += tplVoice();
  return out;
}

function tplCamera() {
  const c = ui.cam;
  const isItem = c.mode === 'item';
  let body = '';
  if (c.err) {
    body = `<div class="viewfinder"><div class="placeholder">${esc(c.err)}</div></div>`;
  } else {
    body = `<div class="viewfinder">
      <div class="corner tl"></div><div class="corner tr"></div><div class="corner bl"></div><div class="corner br"></div>
      ${c.shot ? `<img src="${c.shot}" alt="">` : `<video id="cam-video" autoplay playsinline muted></video>`}
      ${!c.shot && !c.ready ? '<div class="placeholder">starting camera…</div>' : ''}
      ${!c.shot && c.ready ? '<div class="scanline"></div>' : ''}
    </div>`;
  }
  let footer = '';
  if (isItem) {
    if (!c.shot && !c.err) footer = `<div class="shutter-row"><div class="shutter" data-act="cam-shoot"><div></div></div></div>
      <div class="blink-note" style="animation:none;color:rgba(244,240,232,0.5)">Center the item, then tap the shutter</div>`;
    if (c.shot || c.err) footer = `<div class="result-card">
      <div class="r-head"><span class="r-name">Name this item</span><span class="r-note">photo won’t be saved</span></div>
      <input id="cam-name" class="rename-input" placeholder="e.g. Clorox Wipes" autocomplete="off" value="${esc(c.name || '')}">
      <div class="btn-row">
        <div class="btn primary lg" data-act="cam-add">Add to box</div>
        ${c.err ? '' : '<div class="btn ghost-gold lg" data-act="cam-retake">Retake</div>'}
      </div>
    </div>`;
  } else {
    const l = parseFloat(c.dims.l), w = parseFloat(c.dims.w), h = parseFloat(c.dims.h);
    const liters = (l > 0 && w > 0 && h > 0) ? Math.round(l * w * h / 1000) : null;
    footer = `<div class="result-card">
      <div class="r-head"><span class="r-name">${liters ? '≈ ' + liters + ' L' : 'Box size'}</span><span class="r-note">length × width × height, cm</span></div>
      <div class="dim-row">
        <input class="dim-input" id="dim-l" inputmode="decimal" placeholder="L" value="${esc(c.dims.l)}">
        <span class="dim-x">×</span>
        <input class="dim-input" id="dim-w" inputmode="decimal" placeholder="W" value="${esc(c.dims.w)}">
        <span class="dim-x">×</span>
        <input class="dim-input" id="dim-h" inputmode="decimal" placeholder="H" value="${esc(c.dims.h)}">
      </div>
      <div class="btn-row"><div class="btn primary lg" data-act="measure-apply">${liters ? 'Apply — ' + liters + ' L box' : 'Enter dimensions'}</div></div>
    </div>`;
  }
  return `<div class="modal-full">
    <div class="modal-head"><span class="modal-label">CAMERA</span><div class="close-btn" data-act="close-camera">×</div></div>
    <div class="seg">
      <div class="${isItem ? 'active' : ''}" data-act="cam-mode-item">Identify item</div>
      <div class="${!isItem ? 'active' : ''}" data-act="cam-mode-measure">Measure box</div>
    </div>
    ${body}
    ${footer}
  </div>`;
}

function tplVoice() {
  const v = ui.voice;
  let body = '';
  if (v.phase === 'listening') {
    body = `<div class="mic-stage"><div class="mic-orb-wrap">
        <div class="mic-pulse"></div>
        <div class="mic-orb"><div class="mic-glyph"><div class="head"></div><div class="base"></div></div></div>
      </div></div>
      <div class="blink-note">Listening…</div>
      ${v.interim ? `<div class="transcript">“${esc(v.interim)}”</div>` : ''}
      <div class="btn-row"><div class="btn ghost lg" data-act="voice-stop">Done</div></div>`;
  } else if (v.phase === 'typed') {
    body = `<div class="transcript" style="font-style:normal;color:rgba(244,240,232,0.6);font-size:13px">Voice recognition isn’t available here — type what you’d say instead:</div>
      <input id="voice-typed" class="rename-input" placeholder="e.g. two bottles of bleach and three AA batteries" autocomplete="off" value="${esc(v.typed || '')}">
      <div class="btn-row"><div class="btn primary lg" data-act="voice-parse-typed">Parse items</div></div>`;
  } else if (v.phase === 'parsed') {
    const count = v.items.reduce((a, i) => a + i.qty, 0);
    body = `<div class="transcript">“${esc(v.transcript)}”</div>
      ${v.items.length ? `<div class="voice-chips">${v.items.map(i => `
        <div class="voice-chip"><span class="vqty">×${i.qty}</span><span class="vlabel">${esc(i.name)}${i.brand ? ' — ' + esc(i.brand) : ''}</span></div>`).join('')}</div>` : '<div class="transcript" style="font-style:normal;color:rgba(244,240,232,0.5)">Couldn’t pick out any items.</div>'}
      <div class="btn-row">
        ${v.items.length ? `<div class="btn primary lg" data-act="voice-add-all">Add ${count} ${count === 1 ? 'item' : 'items'}</div>` : ''}
        <div class="btn ghost-gold lg" data-act="voice-retry">Say it again</div>
      </div>`;
  }
  return `<div class="sheet-scrim" data-act="close-voice-scrim">
    <div class="voice-sheet">
      <div class="modal-head"><span class="modal-label">VOICE ENTRY</span><div class="close-btn" data-act="close-voice">×</div></div>
      ${body}
    </div>
  </div>`;
}

/* ================= event binding ================= */
function bind() {
  const app = $('#app');

  app.querySelectorAll('[data-act]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      handleAction(el.getAttribute('data-act'), el, e);
    });
  });

  // navigation to rooms/boxes (guarded against drag)
  app.querySelectorAll('[data-nav-room]').forEach(el => {
    el.addEventListener('click', () => {
      if (ui.suppressClick || ui.drag) return;
      view = { screen: 'room', roomId: el.getAttribute('data-nav-room'), boxId: null };
      render();
    });
  });
  app.querySelectorAll('[data-nav-box]').forEach(el => {
    el.addEventListener('click', () => {
      if (ui.suppressClick || ui.drag) return;
      view = { screen: 'box', roomId: view.roomId, boxId: el.getAttribute('data-nav-box') };
      ui.addText = '';
      render();
    });
  });

  // long-press to reorder / open menu
  app.querySelectorAll('[data-drag-id]').forEach(el => {
    el.addEventListener('pointerdown', e => startPress(el.getAttribute('data-drag-kind'), el.getAttribute('data-drag-id'), e));
  });

  // qty +/- on items
  app.querySelectorAll('[data-inc]').forEach(el => el.addEventListener('click', () => changeQty(el.getAttribute('data-inc'), 1)));
  app.querySelectorAll('[data-dec]').forEach(el => el.addEventListener('click', () => changeQty(el.getAttribute('data-dec'), -1)));

  // size chips
  app.querySelectorAll('[data-vol]').forEach(el => el.addEventListener('click', () => {
    const box = currentBox();
    if (!box) return;
    box.vol = parseInt(el.getAttribute('data-vol'), 10);
    box.dims = null;
    save(); render();
  }));

  // search results navigation
  app.querySelectorAll('[data-open-box]').forEach(el => el.addEventListener('click', () => {
    view = { screen: 'box', roomId: el.getAttribute('data-open-room'), boxId: el.getAttribute('data-open-box') };
    ui.addText = ''; render();
  }));
  app.querySelectorAll('[data-open-room-only]').forEach(el => el.addEventListener('click', () => {
    view = { screen: 'room', roomId: el.getAttribute('data-open-room-only'), boxId: null };
    render();
  }));

  // search chips + input
  app.querySelectorAll('[data-chip]').forEach(el => el.addEventListener('click', () => {
    ui.searchQ = el.getAttribute('data-chip');
    const inp = $('#search-input');
    if (inp) inp.value = ui.searchQ;
    updateSearchResults();
  }));
  const searchInput = $('#search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => { ui.searchQ = searchInput.value; updateSearchResults(); });
    if (view.screen === 'search' && !ui.searchQ) searchInput.focus();
  }

  // add-item input
  const addInput = $('#add-input');
  if (addInput) {
    addInput.addEventListener('input', () => { ui.addText = addInput.value; updateSuggestions(); });
    addInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && ui.addText.trim()) {
        const name = ui.addText.trim();
        const meta = inferMeta(name);
        addItemsToCurrentBox([{ name, brand: meta.brand, category: meta.category, qty: 1 }]);
        ui.addText = '';
        render();
        const ai = $('#add-input');
        if (ai) ai.focus();
      }
    });
    updateSuggestions();
  }

  // organize recs
  app.querySelectorAll('[data-rec-apply]').forEach(el => el.addEventListener('click', () => {
    const recs = buildRecs();
    const rc = recs[parseInt(el.getAttribute('data-rec-apply'), 10)];
    if (rc) { rc.apply(); toast('Applied — inventory updated'); render(); }
  }));
  app.querySelectorAll('[data-rec-dismiss]').forEach(el => el.addEventListener('click', () => {
    db.dismissed = (db.dismissed || []).concat([el.getAttribute('data-rec-dismiss')]);
    save(); render();
  }));

  // rename input enter key
  const rn = $('#rename-input');
  if (rn) {
    rn.addEventListener('input', () => { ui.rename.value = rn.value; });
    rn.addEventListener('keydown', e => { if (e.key === 'Enter') applyRename(); });
    rn.focus(); rn.select();
  }

  // measure dims inputs
  ['dim-l', 'dim-w', 'dim-h'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => {
      ui.cam.dims[id.slice(4)] = el.value;
      // update the computed liters label without full re-render
      const l = parseFloat(ui.cam.dims.l), w = parseFloat(ui.cam.dims.w), h = parseFloat(ui.cam.dims.h);
      const liters = (l > 0 && w > 0 && h > 0) ? Math.round(l * w * h / 1000) : null;
      const nameEl = document.querySelector('.result-card .r-name');
      const btn = document.querySelector('[data-act="measure-apply"]');
      if (nameEl) nameEl.textContent = liters ? '≈ ' + liters + ' L' : 'Box size';
      if (btn) btn.textContent = liters ? 'Apply — ' + liters + ' L box' : 'Enter dimensions';
    });
  });

  const camName = $('#cam-name');
  if (camName) {
    camName.addEventListener('input', () => { ui.cam.name = camName.value; });
    camName.addEventListener('keydown', e => { if (e.key === 'Enter') handleAction('cam-add'); });
  }
  const vTyped = $('#voice-typed');
  if (vTyped) {
    vTyped.addEventListener('input', () => { ui.voice.typed = vTyped.value; });
    vTyped.addEventListener('keydown', e => { if (e.key === 'Enter') handleAction('voice-parse-typed'); });
  }

  // start camera stream if the camera modal wants live video
  if (ui.cam && !ui.cam.shot && !ui.cam.err) startCameraStream();
}

function updateSuggestions() {
  const pop = $('#suggest-pop');
  if (!pop) return;
  pop.innerHTML = tplSuggestions();
  const q = ui.addText.trim().toLowerCase();
  pop.querySelectorAll('[data-pick]').forEach(el => el.addEventListener('click', () => {
    // rebuild same hit list to resolve pick index
    const seen = {}; const pool = [];
    db.rooms.forEach(r => r.boxes.forEach(b => b.items.forEach(i => {
      const k = (i.name + '|' + i.brand).toLowerCase();
      if (!seen[k]) { seen[k] = 1; pool.push({ name: i.name, brand: i.brand, category: i.category }); }
    })));
    CATALOG.forEach(c => { const k = (c.name + '|' + c.brand).toLowerCase(); if (!seen[k]) { seen[k] = 1; pool.push(c); } });
    const hits = pool.filter(c => c.name.toLowerCase().indexOf(q) >= 0 || (c.brand || '').toLowerCase().indexOf(q) >= 0).slice(0, 4);
    const c = hits[parseInt(el.getAttribute('data-pick'), 10)];
    if (c) {
      addItemsToCurrentBox([{ ...c, qty: 1 }]);
      ui.addText = '';
      render();
      const ai = $('#add-input'); if (ai) ai.focus();
    }
  }));
}

function updateSearchResults() {
  const box = $('#search-results');
  if (!box) return;
  box.innerHTML = tplSearchResults();
  box.querySelectorAll('[data-open-box]').forEach(el => el.addEventListener('click', () => {
    view = { screen: 'box', roomId: el.getAttribute('data-open-room'), boxId: el.getAttribute('data-open-box') };
    ui.addText = ''; ui.searchQ = ''; render();
  }));
  box.querySelectorAll('[data-open-room-only]').forEach(el => el.addEventListener('click', () => {
    view = { screen: 'room', roomId: el.getAttribute('data-open-room-only'), boxId: null };
    ui.searchQ = ''; render();
  }));
  box.querySelectorAll('[data-chip]').forEach(el => el.addEventListener('click', () => {
    ui.searchQ = el.getAttribute('data-chip');
    const inp = $('#search-input');
    if (inp) inp.value = ui.searchQ;
    updateSearchResults();
  }));
}

function changeQty(itemId, delta) {
  const box = currentBox();
  if (!box) return;
  const it = box.items.find(x => x.id === itemId);
  if (!it) return;
  it.qty += delta;
  if (it.qty <= 0) box.items = box.items.filter(x => x.id !== itemId);
  save(); render();
}

/* ================= actions ================= */
function handleAction(act, el, e) {
  switch (act) {
    case 'go-home': view = { screen: 'home', roomId: null, boxId: null }; ui.searchQ = ''; render(); break;
    case 'go-search': view = { screen: 'search', roomId: null, boxId: null }; render(); break;
    case 'go-organize': view = { screen: 'organize', roomId: null, boxId: null }; render(); break;
    case 'go-room-back': view = { screen: 'room', roomId: view.roomId, boxId: null }; render(); break;

    case 'add-room': {
      const room = { id: uid('r'), name: 'Room ' + (db.rooms.length + 1), boxes: [] };
      db.rooms.push(room); save();
      ui.rename = { kind: 'room', id: room.id, value: room.name, fresh: true };
      render();
      break;
    }
    case 'add-box': {
      const room = currentRoom();
      if (!room) break;
      const box = { id: uid('b'), tag: 'BOX ' + room.name.charAt(0).toUpperCase() + (room.boxes.length + 1), name: 'New Box ' + (room.boxes.length + 1), vol: 40, items: [] };
      room.boxes.push(box); save();
      ui.rename = { kind: 'box', id: box.id, value: box.name, fresh: true };
      render();
      break;
    }

    case 'room-menu': { const r = currentRoom(); if (r) { ui.menu = { kind: 'room', id: r.id }; render(); } break; }
    case 'box-menu': { const b = currentBox(); if (b) { ui.menu = { kind: 'box', id: b.id }; render(); } break; }
    case 'close-menu': ui.menu = null; render(); break;
    case 'menu-rename': {
      const m = ui.menu;
      let val = '';
      if (m.kind === 'room') { const r = findRoom(m.id); val = r ? r.name : ''; }
      else { const l = locateBox(m.id); val = l ? l.box.name : ''; }
      ui.rename = { kind: m.kind, id: m.id, value: val };
      ui.menu = null; render();
      break;
    }
    case 'menu-delete': deleteEntity(ui.menu.kind, ui.menu.id); break;
    case 'rename-save': applyRename(); break;
    case 'rename-cancel': cancelRename(); break;

    case 'export-data': exportData(); break;
    case 'import-data': ui.importOpen = true; render(); break;
    case 'import-cancel': ui.importOpen = false; render(); break;
    case 'import-save': {
      const ta = $('#import-input');
      try {
        const d = JSON.parse(ta.value);
        if (!d || !Array.isArray(d.rooms)) throw new Error('bad');
        db = { rooms: d.rooms, dismissed: d.dismissed || [] };
        save();
        ui.importOpen = false;
        toast('Backup restored');
        render();
      } catch (e) { toast('That doesn’t look like a Trove backup'); }
      break;
    }

    case 'open-camera': ui.cam = { mode: 'item', shot: null, name: '', dims: { l: '', w: '', h: '' }, ready: false, err: null }; render(); break;
    case 'open-measure': ui.cam = { mode: 'measure', shot: null, name: '', dims: { l: '', w: '', h: '' }, ready: false, err: null }; render(); break;
    case 'close-camera': ui.cam = null; render(); break;
    case 'cam-mode-item': if (ui.cam.mode !== 'item') { ui.cam.mode = 'item'; ui.cam.shot = null; render(); } break;
    case 'cam-mode-measure': if (ui.cam.mode !== 'measure') { ui.cam.mode = 'measure'; ui.cam.shot = null; render(); } break;
    case 'cam-shoot': {
      const video = $('#cam-video');
      if (!video || !video.videoWidth) break;
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 900 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      ui.cam.shot = canvas.toDataURL('image/jpeg', 0.7);
      render();
      const cn = $('#cam-name'); if (cn) cn.focus();
      break;
    }
    case 'cam-retake': ui.cam.shot = null; ui.cam.name = ''; render(); break;
    case 'cam-add': {
      const name = (ui.cam.name || '').trim();
      if (!name) { toast('Give the item a name first'); break; }
      const meta = inferMeta(name);
      addItemsToCurrentBox([{ name, brand: meta.brand, category: meta.category, qty: 1 }]);
      ui.cam.shot = null; ui.cam.name = '';
      render();
      break;
    }
    case 'measure-apply': {
      const d = ui.cam.dims;
      const l = parseFloat(d.l), w = parseFloat(d.w), h = parseFloat(d.h);
      if (!(l > 0 && w > 0 && h > 0)) { toast('Enter all three dimensions'); break; }
      const liters = Math.round(l * w * h / 1000);
      const box = currentBox();
      if (box) {
        box.vol = liters;
        box.dims = Math.round(l) + ' × ' + Math.round(w) + ' × ' + Math.round(h) + ' cm';
        save();
        toast('Measured — ' + liters + ' L box');
      }
      ui.cam = null;
      render();
      break;
    }

    case 'open-voice': openVoice(); break;
    case 'close-voice': closeVoice(); break;
    case 'close-voice-scrim': if (!e || e.target === el) closeVoice(); break;
    case 'voice-stop': if (ui.rec) { try { ui.rec.stop(); } catch (e) {} } break;
    case 'voice-parse-typed': {
      const t = (ui.voice.typed || '').trim();
      if (!t) break;
      ui.voice = { phase: 'parsed', transcript: t, items: parseVoiceItems(t) };
      render();
      break;
    }
    case 'voice-add-all': {
      addItemsToCurrentBox(ui.voice.items);
      closeVoice();
      break;
    }
    case 'voice-retry': openVoice(); break;
  }
}

function deleteEntity(kind, id) {
  if (kind === 'room') {
    db.rooms = db.rooms.filter(r => r.id !== id);
    if (view.roomId === id) view = { screen: 'home', roomId: null, boxId: null };
  } else {
    db.rooms.forEach(r => { r.boxes = r.boxes.filter(b => b.id !== id); });
    if (view.boxId === id) view = { screen: 'room', roomId: view.roomId, boxId: null };
  }
  ui.menu = null;
  save();
  toast('Deleted');
  render();
}

function applyRename() {
  const rn = ui.rename;
  if (!rn) return;
  const name = (rn.value || '').trim();
  ui.rename = null;
  if (name) {
    if (rn.kind === 'room') { const r = findRoom(rn.id); if (r) r.name = name; }
    else { const l = locateBox(rn.id); if (l) l.box.name = name; }
    save();
    toast(rn.fresh ? 'Created' : 'Renamed');
  }
  render();
}
function cancelRename() {
  const rn = ui.rename;
  ui.rename = null;
  // a brand-new room/box whose naming was cancelled keeps its default name
  render();
}

/* ================= export ================= */
function exportData() {
  const payload = JSON.stringify(db, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  if (navigator.share) {
    navigator.share({ title: 'Trove backup ' + stamp, text: payload }).catch(() => {});
  } else {
    const blob = new Blob([payload], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'trove-backup-' + stamp + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Backup downloaded');
  }
}

/* ================= camera stream ================= */
async function startCameraStream() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    ui.cam.err = 'Camera isn’t available in this browser — you can still type the item name below.';
    render();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    ui.camStream = stream;
    if (!ui.cam) { stream.getTracks().forEach(t => t.stop()); ui.camStream = null; return; }
    const video = $('#cam-video');
    if (video) {
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        if (ui.cam && !ui.cam.ready) {
          ui.cam.ready = true;
          const ph = document.querySelector('.viewfinder .placeholder');
          if (ph) ph.remove();
          const vf = document.querySelector('.viewfinder');
          if (vf && !vf.querySelector('.scanline')) {
            const sl = document.createElement('div');
            sl.className = 'scanline';
            vf.appendChild(sl);
          }
        }
      };
    }
  } catch (e) {
    if (ui.cam) {
      ui.cam.err = 'Camera permission was denied — you can still type the item name below.';
      render();
    }
  }
}
function stopCameraStream(keepModal) {
  if (ui.camStream) {
    ui.camStream.getTracks().forEach(t => t.stop());
    ui.camStream = null;
  }
}

/* ================= voice ================= */
function openVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    ui.voice = { phase: 'typed', typed: '' };
    render();
    const vt = $('#voice-typed'); if (vt) vt.focus();
    return;
  }
  ui.voice = { phase: 'listening', interim: '' };
  render();
  const rec = new SR();
  ui.rec = rec;
  rec.lang = 'en-US';
  rec.continuous = false;
  rec.interimResults = true;
  let finalText = '';
  rec.onresult = ev => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript;
      else interim += ev.results[i][0].transcript;
    }
    if (ui.voice && ui.voice.phase === 'listening') {
      ui.voice.interim = (finalText + ' ' + interim).trim();
      const t = document.querySelector('.voice-sheet .transcript');
      if (t) t.textContent = '“' + ui.voice.interim + '”';
      else render();
    }
  };
  rec.onend = () => {
    ui.rec = null;
    if (!ui.voice || ui.voice.phase !== 'listening') return;
    const text = (finalText || ui.voice.interim || '').trim();
    if (text) ui.voice = { phase: 'parsed', transcript: text, items: parseVoiceItems(text) };
    else ui.voice = { phase: 'typed', typed: '' };
    render();
  };
  rec.onerror = () => {
    ui.rec = null;
    if (ui.voice && ui.voice.phase === 'listening') {
      ui.voice = { phase: 'typed', typed: '' };
      render();
      const vt = $('#voice-typed'); if (vt) vt.focus();
    }
  };
  try { rec.start(); } catch (e) {
    ui.voice = { phase: 'typed', typed: '' };
    render();
  }
}
function closeVoice() {
  if (ui.rec) { try { ui.rec.abort(); } catch (e) {} ui.rec = null; }
  ui.voice = null;
  render();
}

/* ================= long-press drag reorder (ported) ================= */
let pressStart = null, pressTimer = null;

function startPress(kind, id, e) {
  if (ui.menu || ui.rename || ui.drag || ui.cam || ui.voice) return;
  pressStart = { x: e.clientX, y: e.clientY };
  const onEarlyMove = ev => {
    if (Math.abs(ev.clientX - pressStart.x) + Math.abs(ev.clientY - pressStart.y) > 12) cancel();
  };
  const cancel = () => {
    clearTimeout(pressTimer);
    window.removeEventListener('pointermove', onEarlyMove);
    window.removeEventListener('pointerup', cancel);
    window.removeEventListener('pointercancel', cancel);
  };
  window.addEventListener('pointermove', onEarlyMove);
  window.addEventListener('pointerup', cancel);
  window.addEventListener('pointercancel', cancel);
  pressTimer = setTimeout(() => {
    window.removeEventListener('pointermove', onEarlyMove);
    window.removeEventListener('pointerup', cancel);
    window.removeEventListener('pointercancel', cancel);
    beginLift(kind, id);
  }, 350);
}

const blockScroll = e => { if (ui.drag) e.preventDefault(); };

function beginLift(kind, id) {
  ui.drag = { kind, id, moved: false };
  document.addEventListener('touchmove', blockScroll, { passive: false });
  render();

  const onMove = ev => {
    ev.preventDefault();
    const far = Math.abs(ev.clientX - pressStart.x) + Math.abs(ev.clientY - pressStart.y) > 12;
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const card = el && el.closest ? el.closest('[data-drag-id]') : null;
    const overId = card && card.getAttribute('data-drag-kind') === kind ? card.getAttribute('data-drag-id') : null;
    if (!ui.drag) return;
    if (far) ui.drag.moved = true;
    if (overId && overId !== id) {
      const reorder = list => {
        const from = list.findIndex(x => x.id === id);
        const to = list.findIndex(x => x.id === overId);
        if (from < 0 || to < 0) return;
        list.splice(to, 0, list.splice(from, 1)[0]);
      };
      ui.drag.moved = true;
      if (kind === 'room') reorder(db.rooms);
      else { const r = currentRoom(); if (r) reorder(r.boxes); }
      save();
      render();
    }
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    document.removeEventListener('touchmove', blockScroll);
    const d = ui.drag;
    ui.drag = null;
    if (d && !d.moved) {
      ui.menu = { kind: d.kind, id: d.id };
    } else {
      ui.suppressClick = true;
      setTimeout(() => { ui.suppressClick = false; }, 200);
    }
    render();
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

/* ================= boot ================= */
render();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
