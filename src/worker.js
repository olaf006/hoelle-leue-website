// Haupt-Worker: liefert die statische Website aus und stellt die komplette
// Forum-API bereit — Mitgliederkonten, Ämter/Rollen, Moderation, Datei-Uploads,
// Admin-Audit-Log, Reaktionen, angepinnte Themen, Beitragszähler, RSVP-Termine,
// Mitgliederverzeichnis und Geburtstage.
//
// WICHTIG: Im Cloudflare-Dashboard unter "Bindings" muss eine KV-Namespace
// mit dem Variablennamen FORUM_KV verbunden sein.

const THREADS_KEY = 'threads';
const AUDITLOG_KEY = 'auditlog';
const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB
const SESSION_DAYS = 30;
const MAX_LOG_ENTRIES = 400;
const REACTION_EMOJIS = ['👍','❤️','😂','😮'];

const OFFICES = [
  { id: 'mitglied',        label: 'Mitglied',              adminByDefault: false },
  { id: 'admin',           label: 'Admin',                  adminByDefault: true  },
  { id: 'zunftvogt',       label: 'Zunftvogt',              adminByDefault: true  },
  { id: 'stellv_zunftvogt',label: 'Stellv. Zunftvogt',      adminByDefault: true  },
  { id: 'schriftfuehrer',  label: 'Schriftführer',          adminByDefault: true  },
  { id: 'kassenwart',      label: 'Kassenwart',             adminByDefault: false },
  { id: 'jugendwart',      label: 'Jugendwart',             adminByDefault: false },
  { id: 'beisitzer',       label: 'Beisitzer',              adminByDefault: false }
];
function officeInfo(id){ return OFFICES.find(o => o.id === id) || OFFICES[0]; }

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
function makeId(){ return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
function sanitize(str, max){ if (typeof str !== 'string') return ''; return str.trim().slice(0, max || 4000); }
function sanitizeUsername(str){ return sanitize(str, 30).toLowerCase().replace(/[^a-z0-9_.-]/g, ''); }
function sanitizeBirthday(str){
  if (typeof str !== 'string') return null;
  const m = str.trim().match(/^(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  // Eingabe im Format TT-MM (deutsche Schreibweise), intern als MM-DD gespeichert
  const dd = Math.min(31, Math.max(1, parseInt(m[1],10)));
  const mm = Math.min(12, Math.max(1, parseInt(m[2],10)));
  return String(mm).padStart(2,'0') + '-' + String(dd).padStart(2,'0');
}
async function getJSON(kv, key, fallback){
  const val = await kv.get(key, { type: 'json' });
  return val === null ? fallback : val;
}

function bytesToHex(bytes){ return Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(''); }
function hexToBytes(hex){ const arr = new Uint8Array(hex.length/2); for (let i=0;i<arr.length;i++) arr[i]=parseInt(hex.substr(i*2,2),16); return arr; }

async function hashPassword(password, existingSaltHex){
  const enc = new TextEncoder();
  const salt = existingSaltHex ? hexToBytes(existingSaltHex) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', salt, iterations:100000, hash:'SHA-256' }, keyMaterial, 256);
  return { hash: bytesToHex(new Uint8Array(bits)), salt: bytesToHex(salt) };
}
async function verifyPassword(password, saltHex, hashHex){
  const { hash } = await hashPassword(password, saltHex);
  return hash === hashHex;
}

function publicUser(u){
  const off = officeInfo(u.office);
  return {
    username: u.username, displayName: u.displayName, office: u.office, officeLabel: off.label,
    isAdmin: !!u.isAdmin, canModerate: !!u.isAdmin, status: u.status, createdAt: u.createdAt,
    postCount: u.postCount || 0, birthday: u.birthday || null,
    memberSince: u.memberSince || new Date(u.createdAt).getFullYear(),
    manualBadges: u.manualBadges || [],
    avatarId: u.avatarId || null
  };
}

async function blobToBase64(blob){
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i=0;i<bytes.length;i+=chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i+chunk));
  return btoa(binary);
}
function base64ToBytes(b64){
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function addLogEntry(kv, entry){
  const log = await getJSON(kv, AUDITLOG_KEY, []);
  log.unshift({ id: makeId(), timestamp: Date.now(), ...entry });
  if (log.length > MAX_LOG_ENTRIES) log.length = MAX_LOG_ENTRIES;
  await kv.put(AUDITLOG_KEY, JSON.stringify(log));
}

// ---------------- Zunft-Abzeichen ----------------
// Automatische Ehrenabzeichen basierend auf echten Zunftdaten, PLUS manuell vergebbare
// Abzeichen für Dinge, die sich nicht automatisch berechnen lassen (z.B. Gründungsmitglied).
// "memberSince" (Jahr) ist unabhängig vom Registrierungsdatum durch einen Admin setzbar,
// da die Zunft schon lange vor der Website existiert.

const MANUAL_BADGES = [
  { id:'founder',   label:'Gründungsmitglied', icon:'🏆' },
  { id:'honorary',  label:'Ehrenmitglied',      icon:'👑' },
  { id:'helper',    label:'Vereinshelfer',      icon:'🛠️' },
  { id:'performer', label:'Bühnenstar',         icon:'🎭' },
  { id:'musician',  label:'Guggenmusiker',      icon:'🥁' }
];
function manualBadgeInfo(id){ return MANUAL_BADGES.find(b => b.id === id); }

async function getBadgesMap(kv, usernames){
  const threads = await getJSON(kv, THREADS_KEY, []);
  const now = Date.now();
  const currentYear = new Date().getFullYear();
  const pastEvents = threads
    .filter(t => t.isEvent && !t.deleted && t.eventDate && t.eventDate <= now)
    .sort((a,b) => b.eventDate - a.eventDate)
    .slice(0, 5);

  const map = {};
  const avatarMap = {};
  const uniqueNames = [...new Set(usernames)];

  for (const uname of uniqueNames) {
    const u = await getJSON(kv, 'user:' + uname, null);
    const badges = [];
    avatarMap[uname] = u ? (u.avatarId || null) : null;

    if (u) {
      const memberSince = u.memberSince || new Date(u.createdAt).getFullYear();
      const yearsSince = currentYear - memberSince;
      if (yearsSince < 1) badges.push({ id:'newbie', label:'Narren-Neuling', icon:'🌱' });
      if (yearsSince >= 10) badges.push({ id:'veteran', label:'Zunft-Urgestein', icon:'🏛️' });
      if ((u.postCount || 0) >= 50) badges.push({ id:'prolific', label:'Vielschreiber', icon:'✍️' });
      if ((u.uploadCount || 0) >= 10) badges.push({ id:'photographer', label:'Fotograf', icon:'📷' });

      const ownThreads = threads.filter(t => t.author === uname && !t.deleted);
      if (ownThreads.length >= 10) badges.push({ id:'starter', label:'Diskussionsstarter', icon:'🗣️' });
      if (ownThreads.filter(t => t.isEvent).length >= 3) badges.push({ id:'organizer', label:'Termin-Macher', icon:'🎪' });

      (u.manualBadges || []).forEach(id => { const info = manualBadgeInfo(id); if (info) badges.push(info); });
    }

    if (pastEvents.length >= 3 && pastEvents.every(e => (e.rsvp && e.rsvp.yes || []).includes(uname))) {
      badges.push({ id:'regular', label:'Stammgast', icon:'⭐' });
    }
    map[uname] = badges;
  }
  return { badgesMap: map, avatarMap };
}

// ---------------- Auth ----------------

function getToken(request, url){
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  const qp = url.searchParams.get('token');
  if (qp) return qp;
  return null;
}
async function getSessionUser(request, url, kv){
  const token = getToken(request, url);
  if (!token) return null;
  const session = await getJSON(kv, 'session:' + token, null);
  if (!session || session.expiresAt < Date.now()) return null;
  const user = await getJSON(kv, 'user:' + session.username, null);
  if (!user || user.status !== 'active') return null;
  return { user, token };
}
async function requireAuth(request, url, kv){
  const s = await getSessionUser(request, url, kv);
  if (!s) return { error: json({ error:'Bitte melde dich an.' }, 401) };
  return { user: s.user, token: s.token };
}
async function requireAdmin(request, url, kv){
  const r = await requireAuth(request, url, kv);
  if (r.error) return r;
  if (!r.user.isAdmin) return { error: json({ error:'Nur für Admins.' }, 403) };
  return r;
}

// ---------------- Auth-Handler ----------------

async function handleRegister(request, kv){
  let body;
  try { body = await request.json(); } catch(e){ return json({ error:'Ungültige Anfrage.' }, 400); }

  const username = sanitizeUsername(body.username);
  const displayName = sanitize(body.displayName, 60);
  const password = typeof body.password === 'string' ? body.password : '';
  const office = officeInfo(sanitize(body.office, 40)).id;
  const birthday = sanitizeBirthday(body.birthday);

  if (username.length < 3) return json({ error:'Benutzername muss mind. 3 Zeichen haben (nur Buchstaben, Zahlen, _ . -).' }, 400);
  if (!displayName) return json({ error:'Bitte gib deinen Namen an.' }, 400);
  if (password.length < 4) return json({ error:'Passwort muss mind. 4 Zeichen haben.' }, 400);

  const existing = await getJSON(kv, 'user:' + username, null);
  if (existing) return json({ error:'Dieser Benutzername ist bereits vergeben.' }, 409);

  const listResult = await kv.list({ prefix: 'user:', limit: 1 });
  const isFirstUser = listResult.keys.length === 0;

  const { hash, salt } = await hashPassword(password);
  const now = Date.now();
  const user = {
    username, displayName, office, birthday,
    passwordHash: hash, passwordSalt: salt,
    isAdmin: isFirstUser || officeInfo(office).adminByDefault,
    status: isFirstUser ? 'active' : 'pending',
    postCount: 0,
    createdAt: now
  };
  await kv.put('user:' + username, JSON.stringify(user));
  await addLogEntry(kv, {
    action: isFirstUser ? 'register_first_admin' : 'register_pending',
    actorUsername: username, actorDisplayName: displayName,
    summary: isFirstUser ? `${displayName} hat sich als erstes Mitglied registriert und ist automatisch Admin geworden.` : `${displayName} hat sich registriert (${officeInfo(office).label}) und wartet auf Freischaltung.`
  });

  if (isFirstUser) {
    const token = crypto.randomUUID();
    await kv.put('session:' + token, JSON.stringify({ username, expiresAt: Date.now() + SESSION_DAYS*86400000 }));
    return json({ ok:true, autoLogin:true, token, user: publicUser(user) });
  }
  return json({ ok:true, autoLogin:false, pending:true });
}

async function handleLogin(request, kv){
  let body;
  try { body = await request.json(); } catch(e){ return json({ error:'Ungültige Anfrage.' }, 400); }
  const username = sanitizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';

  const user = await getJSON(kv, 'user:' + username, null);
  if (!user) return json({ error:'Ungültige Zugangsdaten.' }, 401);
  const ok = await verifyPassword(password, user.passwordSalt, user.passwordHash);
  if (!ok) return json({ error:'Ungültige Zugangsdaten.' }, 401);
  if (user.status === 'pending') return json({ error:'Dein Konto wartet noch auf Freischaltung durch den Admin.' }, 403);
  if (user.status === 'rejected') return json({ error:'Dieses Konto wurde nicht freigeschaltet.' }, 403);

  const token = crypto.randomUUID();
  await kv.put('session:' + token, JSON.stringify({ username, expiresAt: Date.now() + SESSION_DAYS*86400000 }));
  return json({ token, user: publicUser(user) });
}

async function handleDeleteAccount(kv, currentUser, currentToken){
  await kv.delete('user:' + currentUser.username);
  await kv.delete('session:' + currentToken);
  await addLogEntry(kv, {
    action:'delete_own_account', actorUsername: currentUser.username, actorDisplayName: currentUser.displayName,
    summary: `${currentUser.displayName} (@${currentUser.username}) hat das eigene Konto gelöscht.`
  });
  return json({ ok:true });
}

async function handleUpdateAccount(request, kv, currentUser){
  let body;
  try { body = await request.json(); } catch(e){ return json({ error:'Ungültige Anfrage.' }, 400); }
  const user = await getJSON(kv, 'user:' + currentUser.username, null);
  if (!user) return json({ error:'Konto nicht gefunden.' }, 404);

  if (typeof body.displayName === 'string') {
    const dn = sanitize(body.displayName, 60);
    if (dn) user.displayName = dn;
  }
  if (body.birthday !== undefined) {
    user.birthday = body.birthday === null || body.birthday === '' ? null : sanitizeBirthday(body.birthday);
  }
  if (body.avatarId !== undefined) {
    user.avatarId = body.avatarId === null ? null : sanitize(body.avatarId, 100);
  }
  await kv.put('user:' + currentUser.username, JSON.stringify(user));
  return json({ ok:true, user: publicUser(user) });
}

// ---------------- Mitgliederverzeichnis ----------------

async function handleMembersList(kv){
  const list = await kv.list({ prefix: 'user:' });
  const users = [];
  for (const k of list.keys) {
    const u = await getJSON(kv, k.name, null);
    if (u && u.status === 'active') users.push(publicUser(u));
  }
  users.sort((a,b) => a.displayName.localeCompare(b.displayName, 'de'));
  const { badgesMap } = await getBadgesMap(kv, users.map(u => u.username));
  users.forEach(u => { u.badges = badgesMap[u.username] || []; });
  return json({ users });
}

// ---------------- Forum-Handler ----------------

function visiblePost(p, canSeeDeleted){
  if (p.deleted && !canSeeDeleted) return { id:p.id, deleted:true, createdAt:p.createdAt };
  return p;
}

async function handleForumGet(request, url, kv, currentUser){
  const canModerate = !!currentUser.isAdmin;
  const action = url.searchParams.get('action');

  if (action === 'thread') {
    const id = url.searchParams.get('id');
    const thread = await getJSON(kv, 'thread:' + id, null);
    if (!thread) return json({ error:'Thema nicht gefunden.' }, 404);
    if (thread.deleted && !canModerate) return json({ error:'Thema nicht gefunden.' }, 404);
    const authorNames = thread.posts.filter(p => !p.deleted || canModerate || p.author === currentUser.username).map(p => p.author);
    const { badgesMap, avatarMap } = await getBadgesMap(kv, authorNames);
    const out = { ...thread, posts: thread.posts.map(p => {
      const vp = visiblePost(p, canModerate || p.author === currentUser.username);
      if (vp.message !== undefined) { vp.authorBadges = badgesMap[p.author] || []; vp.authorAvatarId = avatarMap[p.author] || null; }
      return vp;
    }) };
    return json(out);
  }

  const threads = await getJSON(kv, THREADS_KEY, []);
  const visible = threads.filter(t => canModerate || !t.deleted || t.author === currentUser.username);
  visible.sort((a,b) => (b.pinned?1:0) - (a.pinned?1:0) || b.lastActivity - a.lastActivity);
  const { avatarMap: listAvatarMap } = await getBadgesMap(kv, visible.map(t => t.author));
  visible.forEach(t => { t.authorAvatarId = listAvatarMap[t.author] || null; });
  return json({ threads: visible, me: publicUser(currentUser), reactionEmojis: REACTION_EMOJIS });
}

async function handleForumPost(request, kv, currentUser){
  let body;
  try { body = await request.json(); } catch(e){ return json({ error:'Ungültige Anfrage.' }, 400); }

  const author = currentUser.username;
  const authorDisplayName = currentUser.displayName;
  const authorOffice = currentUser.office;
  const attachments = Array.isArray(body.attachments) ? body.attachments.slice(0, 5).map(a => ({
    id: sanitize(a.id, 100), name: sanitize(a.name, 150), type: sanitize(a.type, 100), size: Number(a.size) || 0
  })) : [];
  let quote = null;
  if (body.quote && typeof body.quote === 'object') {
    quote = { author: sanitize(body.quote.author, 60), message: sanitize(body.quote.message, 300) };
  }

  const userRecord = await getJSON(kv, 'user:' + author, null);
  const newPostCount = ((userRecord && userRecord.postCount) || 0) + 1;
  if (userRecord) { userRecord.postCount = newPostCount; await kv.put('user:' + author, JSON.stringify(userRecord)); }

  if (body.action === 'newThread') {
    const title = sanitize(body.title, 150);
    const category = sanitize(body.category, 40) || 'Allgemein';
    const message = sanitize(body.message, 4000);
    if (!title || !message) return json({ error:'Titel und Nachricht dürfen nicht leer sein.' }, 400);

    const isEvent = !!body.isEvent;
    let eventDate = null;
    if (isEvent && body.eventDate) {
      const ts = Date.parse(body.eventDate);
      if (!isNaN(ts)) eventDate = ts;
    }

    const id = makeId();
    const now = Date.now();
    const firstPost = { id: makeId(), author, authorDisplayName, authorOffice, authorPostCount: newPostCount, message, createdAt: now, attachments, deleted:false, reactions:{} };
    const threadDoc = {
      id, title, category, author, authorDisplayName, createdAt: now, lastActivity: now, deleted:false, pinned:false,
      isEvent, eventDate, rsvp: isEvent ? { yes:[], maybe:[], no:[] } : undefined,
      posts:[firstPost]
    };
    await kv.put('thread:' + id, JSON.stringify(threadDoc));

    const threads = await getJSON(kv, THREADS_KEY, []);
    threads.push({ id, title, category, author, authorDisplayName, createdAt: now, lastActivity: now, replyCount:0, deleted:false, pinned:false, isEvent, eventDate, rsvp: threadDoc.rsvp });
    await kv.put(THREADS_KEY, JSON.stringify(threads));

    return json(threadDoc);
  }

  if (body.action === 'reply') {
    const threadId = sanitize(body.threadId, 100);
    const message = sanitize(body.message, 4000);
    if (!threadId || !message) return json({ error:'Nachricht darf nicht leer sein.' }, 400);

    const threadDoc = await getJSON(kv, 'thread:' + threadId, null);
    if (!threadDoc || threadDoc.deleted) return json({ error:'Thema nicht gefunden.' }, 404);

    const now = Date.now();
    threadDoc.posts.push({ id: makeId(), author, authorDisplayName, authorOffice, authorPostCount: newPostCount, message, createdAt: now, attachments, deleted:false, reactions:{}, quote });
    threadDoc.lastActivity = now;
    await kv.put('thread:' + threadId, JSON.stringify(threadDoc));

    const threads = await getJSON(kv, THREADS_KEY, []);
    const idx = threads.findIndex(t => t.id === threadId);
    if (idx !== -1) {
      threads[idx].lastActivity = now;
      threads[idx].replyCount = threadDoc.posts.slice(1).filter(p => !p.deleted).length;
      await kv.put(THREADS_KEY, JSON.stringify(threads));
    }
    return json(threadDoc);
  }

  return json({ error:'Unbekannte Aktion.' }, 400);
}

// ---------------- RSVP ----------------

async function handleRsvp(request, kv, currentUser){
  let body;
  try { body = await request.json(); } catch(e){ return json({ error:'Ungültige Anfrage.' }, 400); }
  const threadId = sanitize(body.threadId, 100);
  const status = ['yes','maybe','no'].includes(body.status) ? body.status : null;

  const threadDoc = await getJSON(kv, 'thread:' + threadId, null);
  if (!threadDoc || !threadDoc.isEvent) return json({ error:'Kein Termin.' }, 404);
  if (!threadDoc.rsvp) threadDoc.rsvp = { yes:[], maybe:[], no:[] };

  ['yes','maybe','no'].forEach(k => { threadDoc.rsvp[k] = threadDoc.rsvp[k].filter(u => u !== currentUser.username); });
  if (status) threadDoc.rsvp[status].push(currentUser.username);

  await kv.put('thread:' + threadId, JSON.stringify(threadDoc));

  const threads = await getJSON(kv, THREADS_KEY, []);
  const idx = threads.findIndex(t => t.id === threadId);
  if (idx !== -1) { threads[idx].rsvp = threadDoc.rsvp; await kv.put(THREADS_KEY, JSON.stringify(threads)); }

  return json({ ok:true, rsvp: threadDoc.rsvp });
}

// ---------------- Reaktionen ----------------

async function handleReact(request, kv, currentUser){
  let body;
  try { body = await request.json(); } catch(e){ return json({ error:'Ungültige Anfrage.' }, 400); }
  const threadId = sanitize(body.threadId, 100);
  const postId = sanitize(body.postId, 100);
  const emoji = REACTION_EMOJIS.includes(body.emoji) ? body.emoji : null;
  if (!threadId || !postId || !emoji) return json({ error:'Ungültige Reaktion.' }, 400);

  const threadDoc = await getJSON(kv, 'thread:' + threadId, null);
  if (!threadDoc) return json({ error:'Thema nicht gefunden.' }, 404);
  const post = threadDoc.posts.find(p => p.id === postId);
  if (!post) return json({ error:'Beitrag nicht gefunden.' }, 404);
  if (!post.reactions) post.reactions = {};
  if (!post.reactions[emoji]) post.reactions[emoji] = [];

  const idx = post.reactions[emoji].indexOf(currentUser.username);
  if (idx === -1) post.reactions[emoji].push(currentUser.username);
  else post.reactions[emoji].splice(idx, 1);

  await kv.put('thread:' + threadId, JSON.stringify(threadDoc));
  return json({ ok:true, reactions: post.reactions });
}

// ---------------- Eigene Beiträge bearbeiten ----------------

async function handleEditPost(request, kv, currentUser){
  let body;
  try { body = await request.json(); } catch(e){ return json({ error:'Ungültige Anfrage.' }, 400); }
  const threadId = sanitize(body.threadId, 100);
  const postId = sanitize(body.postId, 100);
  const message = sanitize(body.message, 4000);
  if (!threadId || !postId || !message) return json({ error:'Nachricht darf nicht leer sein.' }, 400);

  const threadDoc = await getJSON(kv, 'thread:' + threadId, null);
  if (!threadDoc) return json({ error:'Thema nicht gefunden.' }, 404);
  const post = threadDoc.posts.find(p => p.id === postId);
  if (!post) return json({ error:'Beitrag nicht gefunden.' }, 404);

  if (!currentUser.isAdmin && post.author !== currentUser.username) {
    return json({ error:'Du kannst nur eigene Beiträge bearbeiten.' }, 403);
  }

  const wasOthers = post.author !== currentUser.username;
  post.message = message;
  post.editedAt = Date.now();
  post.editedBy = currentUser.username;
  await kv.put('thread:' + threadId, JSON.stringify(threadDoc));

  if (wasOthers) {
    await addLogEntry(kv, {
      action:'edit_post', actorUsername: currentUser.username, actorDisplayName: currentUser.displayName,
      threadId, postId,
      summary: `${currentUser.displayName} hat einen Beitrag von ${post.authorDisplayName} im Thema „${threadDoc.title}" bearbeitet.`
    });
  }
  return json(threadDoc);
}

// ---------------- Moderation / Löschen / Anheften ----------------

async function handleModerate(request, kv, currentUser){
  let body;
  try { body = await request.json(); } catch(e){ return json({ error:'Ungültige Anfrage.' }, 400); }
  const reason = sanitize(body.reason, 300);

  if (body.action === 'pinThread' || body.action === 'unpinThread') {
    if (!currentUser.isAdmin) return json({ error:'Nur Admins können Themen anheften.' }, 403);
    const threadId = sanitize(body.threadId, 100);
    const threadDoc = await getJSON(kv, 'thread:' + threadId, null);
    if (!threadDoc) return json({ error:'Thema nicht gefunden.' }, 404);
    threadDoc.pinned = body.action === 'pinThread';
    await kv.put('thread:' + threadId, JSON.stringify(threadDoc));
    const threads = await getJSON(kv, THREADS_KEY, []);
    const idx = threads.findIndex(t => t.id === threadId);
    if (idx !== -1) { threads[idx].pinned = threadDoc.pinned; await kv.put(THREADS_KEY, JSON.stringify(threads)); }
    await addLogEntry(kv, {
      action: threadDoc.pinned ? 'pin_thread' : 'unpin_thread',
      actorUsername: currentUser.username, actorDisplayName: currentUser.displayName, threadId,
      summary: `${currentUser.displayName} hat das Thema „${threadDoc.title}" ${threadDoc.pinned ? 'angeheftet' : 'gelöst'}.`
    });
    return json({ ok:true, pinned: threadDoc.pinned });
  }

  if (body.action === 'deletePost' || body.action === 'restorePost') {
    const threadId = sanitize(body.threadId, 100);
    const postId = sanitize(body.postId, 100);
    const threadDoc = await getJSON(kv, 'thread:' + threadId, null);
    if (!threadDoc) return json({ error:'Thema nicht gefunden.' }, 404);
    const post = threadDoc.posts.find(p => p.id === postId);
    if (!post) return json({ error:'Beitrag nicht gefunden.' }, 404);

    const isOwner = post.author === currentUser.username;

    if (body.action === 'deletePost') {
      if (!currentUser.isAdmin && !isOwner) return json({ error:'Keine Berechtigung.' }, 403);
      post.deleted = true; post.deletedAt = Date.now(); post.deletedBy = currentUser.username; post.deletedReason = reason;
      await addLogEntry(kv, {
        action:'delete_post', actorUsername: currentUser.username, actorDisplayName: currentUser.displayName,
        threadId, postId, reason,
        summary: `${currentUser.displayName} hat ${isOwner ? 'seinen/ihren eigenen' : 'einen'} Beitrag von ${post.authorDisplayName} im Thema „${threadDoc.title}" gelöscht.`,
        deletedContent: { author: post.authorDisplayName, message: post.message, createdAt: post.createdAt }
      });
    } else {
      const canRestore = currentUser.isAdmin || (isOwner && post.deletedBy === currentUser.username);
      if (!canRestore) return json({ error:'Nur ein Admin kann diesen Beitrag wiederherstellen.' }, 403);
      post.deleted = false; post.deletedAt = null; post.deletedBy = null; post.deletedReason = null;
      await addLogEntry(kv, {
        action:'restore_post', actorUsername: currentUser.username, actorDisplayName: currentUser.displayName,
        threadId, postId,
        summary: `${currentUser.displayName} hat einen Beitrag von ${post.authorDisplayName} im Thema „${threadDoc.title}" wiederhergestellt.`
      });
    }
    await kv.put('thread:' + threadId, JSON.stringify(threadDoc));

    const threads = await getJSON(kv, THREADS_KEY, []);
    const idx = threads.findIndex(t => t.id === threadId);
    if (idx !== -1) { threads[idx].replyCount = threadDoc.posts.slice(1).filter(p => !p.deleted).length; await kv.put(THREADS_KEY, JSON.stringify(threads)); }

    return json({ ok:true });
  }

  if (body.action === 'deleteThread' || body.action === 'restoreThread') {
    const threadId = sanitize(body.threadId, 100);
    const threadDoc = await getJSON(kv, 'thread:' + threadId, null);
    if (!threadDoc) return json({ error:'Thema nicht gefunden.' }, 404);
    const isOwner = threadDoc.author === currentUser.username;
    const del = body.action === 'deleteThread';

    if (del) {
      if (!currentUser.isAdmin && !isOwner) return json({ error:'Keine Berechtigung.' }, 403);
      threadDoc.deleted = true; threadDoc.deletedBy = currentUser.username;
    } else {
      const canRestore = currentUser.isAdmin || (isOwner && threadDoc.deletedBy === currentUser.username);
      if (!canRestore) return json({ error:'Nur ein Admin kann dieses Thema wiederherstellen.' }, 403);
      threadDoc.deleted = false; threadDoc.deletedBy = null;
    }
    await kv.put('thread:' + threadId, JSON.stringify(threadDoc));

    const threads = await getJSON(kv, THREADS_KEY, []);
    const idx = threads.findIndex(t => t.id === threadId);
    if (idx !== -1) { threads[idx].deleted = threadDoc.deleted; await kv.put(THREADS_KEY, JSON.stringify(threads)); }

    await addLogEntry(kv, {
      action: del ? 'delete_thread' : 'restore_thread',
      actorUsername: currentUser.username, actorDisplayName: currentUser.displayName,
      threadId, reason,
      summary: `${currentUser.displayName} hat das Thema „${threadDoc.title}" ${del ? 'gelöscht' : 'wiederhergestellt'}.`,
      deletedContent: del ? { title: threadDoc.title, category: threadDoc.category } : undefined
    });
    return json({ ok:true });
  }

  if (body.action === 'purgeThread') {
    if (!currentUser.isAdmin) return json({ error:'Nur Admins können Themen endgültig löschen.' }, 403);
    const threadId = sanitize(body.threadId, 100);
    const threadDoc = await getJSON(kv, 'thread:' + threadId, null);
    if (!threadDoc) return json({ error:'Thema nicht gefunden.' }, 404);

    await kv.delete('thread:' + threadId);
    const threads = await getJSON(kv, THREADS_KEY, []);
    const filtered = threads.filter(t => t.id !== threadId);
    await kv.put(THREADS_KEY, JSON.stringify(filtered));

    await addLogEntry(kv, {
      action:'purge_thread', actorUsername: currentUser.username, actorDisplayName: currentUser.displayName,
      threadId, reason,
      summary: `${currentUser.displayName} hat das Thema „${threadDoc.title}" endgültig und unwiderruflich gelöscht.`,
      deletedContent: { title: threadDoc.title, category: threadDoc.category, postCount: threadDoc.posts.length }
    });
    return json({ ok:true, purged:true });
  }

  return json({ error:'Unbekannte Aktion.' }, 400);
}

// ---------------- Datei-Upload ----------------

async function handleUpload(request, kv, currentUser){
  let form;
  try { form = await request.formData(); } catch(e){ return json({ error:'Ungültige Anfrage.' }, 400); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ error:'Keine Datei erhalten.' }, 400);
  if (file.size > MAX_FILE_SIZE) return json({ error:`Datei zu groß (max. ${Math.round(MAX_FILE_SIZE/1024/1024)} MB).` }, 400);

  const id = makeId();
  const dataBase64 = await blobToBase64(file);
  const name = sanitize(file.name || 'datei', 150);
  const type = sanitize(file.type || 'application/octet-stream', 100);
  await kv.put('file:' + id, JSON.stringify({ name, type, size: file.size, dataBase64, uploadedBy: currentUser.username, uploadedAt: Date.now() }));

  const userRecord = await getJSON(kv, 'user:' + currentUser.username, null);
  if (userRecord) { userRecord.uploadCount = (userRecord.uploadCount || 0) + 1; await kv.put('user:' + currentUser.username, JSON.stringify(userRecord)); }

  return json({ id, name, type, size: file.size, url: '/api/file?id=' + encodeURIComponent(id) });
}
async function handleFileGet(url, kv){
  const id = url.searchParams.get('id');
  const fileDoc = await getJSON(kv, 'file:' + id, null);
  if (!fileDoc) return new Response('Nicht gefunden', { status:404 });
  const bytes = base64ToBytes(fileDoc.dataBase64);
  return new Response(bytes, { headers: { 'Content-Type': fileDoc.type, 'Cache-Control':'private, max-age=3600' } });
}

// ---------------- Admin ----------------

async function handleAdminPending(kv){
  const list = await kv.list({ prefix: 'user:' });
  const users = [];
  for (const k of list.keys) { const u = await getJSON(kv, k.name, null); if (u && u.status === 'pending') users.push(publicUser(u)); }
  users.sort((a,b) => a.createdAt - b.createdAt);
  return json({ users });
}
async function handleAdminUsers(kv){
  const list = await kv.list({ prefix: 'user:' });
  const users = [];
  for (const k of list.keys) { const u = await getJSON(kv, k.name, null); if (u) users.push(publicUser(u)); }
  users.sort((a,b) => a.displayName.localeCompare(b.displayName, 'de'));
  return json({ users, offices: OFFICES, manualBadgeCatalog: MANUAL_BADGES });
}
async function handleAdminApprove(request, kv, currentUser){
  let body; try { body = await request.json(); } catch(e){ return json({ error:'Ungültige Anfrage.' }, 400); }
  const username = sanitizeUsername(body.username);
  const user = await getJSON(kv, 'user:' + username, null);
  if (!user) return json({ error:'Konto nicht gefunden.' }, 404);
  user.status = body.approve ? 'active' : 'rejected';
  await kv.put('user:' + username, JSON.stringify(user));
  await addLogEntry(kv, {
    action: body.approve ? 'approve_user' : 'reject_user',
    actorUsername: currentUser.username, actorDisplayName: currentUser.displayName, targetUsername: username,
    summary: `${currentUser.displayName} hat das Konto von ${user.displayName} ${body.approve ? 'freigeschaltet' : 'abgelehnt'}.`
  });
  return json({ ok:true });
}
async function handleAdminUpdateUser(request, kv, currentUser){
  let body; try { body = await request.json(); } catch(e){ return json({ error:'Ungültige Anfrage.' }, 400); }
  const username = sanitizeUsername(body.username);
  const user = await getJSON(kv, 'user:' + username, null);
  if (!user) return json({ error:'Konto nicht gefunden.' }, 404);

  const changes = [];
  if (typeof body.office === 'string') {
    const off = officeInfo(sanitize(body.office, 40));
    if (off.id !== user.office) changes.push(`Amt: ${officeInfo(user.office).label} → ${off.label}`);
    user.office = off.id;
    if (typeof body.isAdmin !== 'boolean') {
      const newAdmin = off.adminByDefault;
      if (newAdmin !== user.isAdmin) changes.push(`Admin-Rechte: ${user.isAdmin?'ja':'nein'} → ${newAdmin?'ja':'nein'} (durch Amt)`);
      user.isAdmin = newAdmin;
    }
  }
  if (typeof body.isAdmin === 'boolean' && body.isAdmin !== user.isAdmin) {
    changes.push(`Admin-Rechte: ${user.isAdmin?'ja':'nein'} → ${body.isAdmin?'ja':'nein'}`);
    user.isAdmin = body.isAdmin;
  }
  if (body.memberSince !== undefined) {
    const year = parseInt(body.memberSince, 10);
    const currentYear = new Date().getFullYear();
    if (!isNaN(year) && year >= 1900 && year <= currentYear) {
      const oldYear = user.memberSince || new Date(user.createdAt).getFullYear();
      if (year !== oldYear) changes.push(`Mitglied seit: ${oldYear} → ${year}`);
      user.memberSince = year;
    }
  }
  if (Array.isArray(body.manualBadges)) {
    const valid = body.manualBadges.filter(id => manualBadgeInfo(id));
    const oldBadges = user.manualBadges || [];
    if (JSON.stringify(valid.sort()) !== JSON.stringify([...oldBadges].sort())) {
      changes.push(`Abzeichen: ${valid.map(id=>manualBadgeInfo(id).label).join(', ') || '(keine)'}`);
    }
    user.manualBadges = valid;
  }
  await kv.put('user:' + username, JSON.stringify(user));
  if (changes.length) {
    await addLogEntry(kv, {
      action:'update_user', actorUsername: currentUser.username, actorDisplayName: currentUser.displayName, targetUsername: username,
      summary: `${currentUser.displayName} hat das Profil von ${user.displayName} geändert: ${changes.join(', ')}.`
    });
  }
  return json({ ok:true, user: publicUser(user) });
}
async function handleAdminLog(kv){
  const log = await getJSON(kv, AUDITLOG_KEY, []);
  return json({ log });
}

async function handleAdminExport(kv){
  const userList = await kv.list({ prefix: 'user:' });
  const users = [];
  for (const k of userList.keys) {
    const u = await getJSON(kv, k.name, null);
    if (!u) continue;
    // Passwort-Hashes aus Sicherheitsgründen NICHT im Export enthalten
    const { passwordHash, passwordSalt, ...safeUser } = u;
    users.push(safeUser);
  }

  const threadsIndex = await getJSON(kv, THREADS_KEY, []);
  const threads = [];
  for (const t of threadsIndex) {
    const full = await getJSON(kv, 'thread:' + t.id, null);
    if (full) threads.push(full);
  }

  const log = await getJSON(kv, AUDITLOG_KEY, []);

  return json({
    exportedAt: new Date().toISOString(),
    note: 'Backup der Friburger Hölle-Leue Website. Passwörter sind aus Sicherheitsgründen nicht enthalten.',
    users, threads, auditLog: log
  });
}

// ---------------- Router ----------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const kv = env.FORUM_KV;
    const path = url.pathname;

    if (!kv && path.startsWith('/api/')) {
      return json({ error:'Der Speicher ist noch nicht verbunden. Bitte im Cloudflare-Dashboard unter „Bindings" eine KV-Namespace namens FORUM_KV hinzufügen.' }, 500);
    }

    try {
      if (path === '/api/auth/register' && request.method === 'POST') return await handleRegister(request, kv);
      if (path === '/api/auth/login' && request.method === 'POST') return await handleLogin(request, kv);

      if (path === '/api/me' && request.method === 'GET') {
        const s = await getSessionUser(request, url, kv);
        if (!s) return json({ error:'Nicht angemeldet.' }, 401);
        return json({ user: publicUser(s.user) });
      }

      if (path === '/api/account/delete' && request.method === 'POST') {
        const r = await requireAuth(request, url, kv); if (r.error) return r.error;
        return await handleDeleteAccount(kv, r.user, r.token);
      }
      if (path === '/api/account/update' && request.method === 'POST') {
        const r = await requireAuth(request, url, kv); if (r.error) return r.error;
        return await handleUpdateAccount(request, kv, r.user);
      }

      if (path === '/api/members' && request.method === 'GET') {
        const r = await requireAuth(request, url, kv); if (r.error) return r.error;
        return await handleMembersList(kv);
      }

      if (path === '/api/forum') {
        const r = await requireAuth(request, url, kv); if (r.error) return r.error;
        if (request.method === 'GET') return await handleForumGet(request, url, kv, r.user);
        if (request.method === 'POST') return await handleForumPost(request, kv, r.user);
      }
      if (path === '/api/forum/edit' && request.method === 'POST') {
        const r = await requireAuth(request, url, kv); if (r.error) return r.error;
        return await handleEditPost(request, kv, r.user);
      }
      if (path === '/api/forum/react' && request.method === 'POST') {
        const r = await requireAuth(request, url, kv); if (r.error) return r.error;
        return await handleReact(request, kv, r.user);
      }
      if (path === '/api/forum/rsvp' && request.method === 'POST') {
        const r = await requireAuth(request, url, kv); if (r.error) return r.error;
        return await handleRsvp(request, kv, r.user);
      }
      if (path === '/api/forum/moderate' && request.method === 'POST') {
        const r = await requireAuth(request, url, kv); if (r.error) return r.error;
        return await handleModerate(request, kv, r.user);
      }

      if (path === '/api/upload' && request.method === 'POST') {
        const r = await requireAuth(request, url, kv); if (r.error) return r.error;
        return await handleUpload(request, kv, r.user);
      }
      if (path === '/api/file' && request.method === 'GET') {
        const r = await requireAuth(request, url, kv); if (r.error) return r.error;
        return await handleFileGet(url, kv);
      }

      if (path === '/api/admin/pending' && request.method === 'GET') { const r = await requireAdmin(request, url, kv); if (r.error) return r.error; return await handleAdminPending(kv); }
      if (path === '/api/admin/users' && request.method === 'GET') { const r = await requireAdmin(request, url, kv); if (r.error) return r.error; return await handleAdminUsers(kv); }
      if (path === '/api/admin/approve' && request.method === 'POST') { const r = await requireAdmin(request, url, kv); if (r.error) return r.error; return await handleAdminApprove(request, kv, r.user); }
      if (path === '/api/admin/update-user' && request.method === 'POST') { const r = await requireAdmin(request, url, kv); if (r.error) return r.error; return await handleAdminUpdateUser(request, kv, r.user); }
      if (path === '/api/admin/log' && request.method === 'GET') { const r = await requireAdmin(request, url, kv); if (r.error) return r.error; return await handleAdminLog(kv); }
      if (path === '/api/admin/export' && request.method === 'GET') { const r = await requireAdmin(request, url, kv); if (r.error) return r.error; return await handleAdminExport(kv); }

      if (path.startsWith('/api/')) return json({ error:'Nicht gefunden.' }, 404);
    } catch (err) {
      return json({ error: 'Serverfehler: ' + (err && err.message ? err.message : String(err)) }, 500);
    }

    return env.ASSETS.fetch(request);
  }
};
