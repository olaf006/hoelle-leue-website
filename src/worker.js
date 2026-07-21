// Haupt-Worker: liefert die statische Website aus und stellt die komplette
// Forum-API bereit — inkl. Mitgliederkonten, Ämtern/Rollen, Moderation,
// Datei-Uploads und Admin-Audit-Log.
//
// WICHTIG: Im Cloudflare-Dashboard unter "Bindings" muss eine KV-Namespace
// mit dem Variablennamen FORUM_KV verbunden sein.

const THREADS_KEY = 'threads';
const AUDITLOG_KEY = 'auditlog';
const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB
const SESSION_DAYS = 30;
const MAX_LOG_ENTRIES = 400;

// Ämter der Zunft. "moderator: true" bedeutet: Inhaber:innen dieses Amts
// dürfen Themen/Beiträge moderieren (löschen/wiederherstellen), zusätzlich
// zur separaten, vollen Admin-Rolle.
const OFFICES = [
  { id: 'mitglied',        label: 'Mitglied',              moderator: false },
  { id: 'zunftvogt',       label: 'Zunftvogt',              moderator: true  },
  { id: 'stellv_zunftvogt',label: 'Stellv. Zunftvogt',      moderator: true  },
  { id: 'schriftfuehrer',  label: 'Schriftführer',          moderator: true  },
  { id: 'kassenwart',      label: 'Kassenwart',             moderator: true  },
  { id: 'jugendwart',      label: 'Jugendwart',             moderator: true  },
  { id: 'beisitzer',       label: 'Beisitzer',              moderator: false }
];
function officeInfo(id){ return OFFICES.find(o => o.id === id) || OFFICES[0]; }

// ---------------- Hilfsfunktionen ----------------

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
function makeId(){ return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
function sanitize(str, max){ if (typeof str !== 'string') return ''; return str.trim().slice(0, max || 4000); }
function sanitizeUsername(str){
  const s = sanitize(str, 30).toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  return s;
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
    username: u.username,
    displayName: u.displayName,
    office: u.office,
    officeLabel: off.label,
    isAdmin: !!u.isAdmin,
    canModerate: !!u.isAdmin || off.moderator,
    status: u.status,
    createdAt: u.createdAt
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
  return user;
}

async function requireAuth(request, url, kv){
  const user = await getSessionUser(request, url, kv);
  if (!user) return { error: json({ error: 'Bitte melde dich an.' }, 401) };
  return { user };
}
async function requireModerator(request, url, kv){
  const r = await requireAuth(request, url, kv);
  if (r.error) return r;
  const off = officeInfo(r.user.office);
  if (!r.user.isAdmin && !off.moderator) return { error: json({ error: 'Keine Moderationsrechte.' }, 403) };
  return r;
}
async function requireAdmin(request, url, kv){
  const r = await requireAuth(request, url, kv);
  if (r.error) return r;
  if (!r.user.isAdmin) return { error: json({ error: 'Nur für Admins.' }, 403) };
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

  if (username.length < 3) return json({ error:'Benutzername muss mind. 3 Zeichen haben (nur Buchstaben, Zahlen, _ . -).' }, 400);
  if (!displayName) return json({ error:'Bitte gib deinen Namen an.' }, 400);
  if (password.length < 4) return json({ error:'Passwort muss mind. 4 Zeichen haben.' }, 400);

  const existing = await getJSON(kv, 'user:' + username, null);
  if (existing) return json({ error:'Dieser Benutzername ist bereits vergeben.' }, 409);

  // Ist das der allererste Account? Dann wird er automatisch Admin & sofort aktiv.
  const listResult = await kv.list({ prefix: 'user:', limit: 1 });
  const isFirstUser = listResult.keys.length === 0;

  const { hash, salt } = await hashPassword(password);
  const now = Date.now();
  const user = {
    username, displayName, office,
    passwordHash: hash, passwordSalt: salt,
    isAdmin: isFirstUser,
    status: isFirstUser ? 'active' : 'pending',
    createdAt: now
  };
  await kv.put('user:' + username, JSON.stringify(user));
  await addLogEntry(kv, {
    action: isFirstUser ? 'register_first_admin' : 'register_pending',
    actorUsername: username, actorDisplayName: displayName,
    summary: isFirstUser ? `${displayName} hat sich als erstes Mitglied registriert und ist automatisch Admin geworden.` : `${displayName} hat sich registriert und wartet auf Freischaltung.`
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

// ---------------- Forum-Handler ----------------

function visiblePost(p, canModerate){
  if (p.deleted && !canModerate) {
    return { id:p.id, deleted:true, createdAt:p.createdAt };
  }
  return p;
}

async function handleForumGet(request, url, kv, currentUser){
  const canModerate = currentUser.isAdmin || officeInfo(currentUser.office).moderator;
  const action = url.searchParams.get('action');

  if (action === 'thread') {
    const id = url.searchParams.get('id');
    const thread = await getJSON(kv, 'thread:' + id, null);
    if (!thread) return json({ error:'Thema nicht gefunden.' }, 404);
    if (thread.deleted && !canModerate) return json({ error:'Thema nicht gefunden.' }, 404);
    const out = { ...thread, posts: thread.posts.map(p => visiblePost(p, canModerate)) };
    return json(out);
  }

  const threads = await getJSON(kv, THREADS_KEY, []);
  const visible = threads.filter(t => canModerate || !t.deleted);
  visible.sort((a,b) => b.lastActivity - a.lastActivity);
  return json({ threads: visible, me: publicUser(currentUser) });
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

  if (body.action === 'newThread') {
    const title = sanitize(body.title, 150);
    const category = sanitize(body.category, 40) || 'Allgemein';
    const message = sanitize(body.message, 4000);
    if (!title || !message) return json({ error:'Titel und Nachricht dürfen nicht leer sein.' }, 400);

    const id = makeId();
    const now = Date.now();
    const firstPost = { id: makeId(), author, authorDisplayName, authorOffice, message, createdAt: now, attachments, deleted:false };
    const threadDoc = { id, title, category, createdAt: now, lastActivity: now, deleted:false, posts:[firstPost] };
    await kv.put('thread:' + id, JSON.stringify(threadDoc));

    const threads = await getJSON(kv, THREADS_KEY, []);
    threads.push({ id, title, category, author, authorDisplayName, createdAt: now, lastActivity: now, replyCount:0, deleted:false });
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
    threadDoc.posts.push({ id: makeId(), author, authorDisplayName, authorOffice, message, createdAt: now, attachments, deleted:false });
    threadDoc.lastActivity = now;
    await kv.put('thread:' + threadId, JSON.stringify(threadDoc));

    const threads = await getJSON(kv, THREADS_KEY, []);
    const idx = threads.findIndex(t => t.id === threadId);
    if (idx !== -1) {
      threads[idx].lastActivity = now;
      threads[idx].replyCount = threadDoc.posts.filter(p => !p.deleted).length - 1;
      await kv.put(THREADS_KEY, JSON.stringify(threads));
    }
    return json(threadDoc);
  }

  return json({ error:'Unbekannte Aktion.' }, 400);
}

// ---------------- Moderation ----------------

async function handleModerate(request, kv, currentUser){
  let body;
  try { body = await request.json(); } catch(e){ return json({ error:'Ungültige Anfrage.' }, 400); }
  const reason = sanitize(body.reason, 300);

  if (body.action === 'deletePost' || body.action === 'restorePost') {
    const threadId = sanitize(body.threadId, 100);
    const postId = sanitize(body.postId, 100);
    const threadDoc = await getJSON(kv, 'thread:' + threadId, null);
    if (!threadDoc) return json({ error:'Thema nicht gefunden.' }, 404);
    const post = threadDoc.posts.find(p => p.id === postId);
    if (!post) return json({ error:'Beitrag nicht gefunden.' }, 404);

    if (body.action === 'deletePost') {
      post.deleted = true; post.deletedAt = Date.now(); post.deletedBy = currentUser.username; post.deletedReason = reason;
      await addLogEntry(kv, {
        action:'delete_post', actorUsername: currentUser.username, actorDisplayName: currentUser.displayName,
        threadId, postId, reason,
        summary: `${currentUser.displayName} hat einen Beitrag von ${post.authorDisplayName} im Thema „${threadDoc.title}" gelöscht.`,
        deletedContent: { author: post.authorDisplayName, message: post.message, createdAt: post.createdAt }
      });
    } else {
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
    if (idx !== -1) { threads[idx].replyCount = threadDoc.posts.filter(p => !p.deleted).length - 1; await kv.put(THREADS_KEY, JSON.stringify(threads)); }

    return json({ ok:true });
  }

  if (body.action === 'deleteThread' || body.action === 'restoreThread') {
    const threadId = sanitize(body.threadId, 100);
    const threadDoc = await getJSON(kv, 'thread:' + threadId, null);
    if (!threadDoc) return json({ error:'Thema nicht gefunden.' }, 404);
    const del = body.action === 'deleteThread';
    threadDoc.deleted = del;
    await kv.put('thread:' + threadId, JSON.stringify(threadDoc));

    const threads = await getJSON(kv, THREADS_KEY, []);
    const idx = threads.findIndex(t => t.id === threadId);
    if (idx !== -1) { threads[idx].deleted = del; await kv.put(THREADS_KEY, JSON.stringify(threads)); }

    await addLogEntry(kv, {
      action: del ? 'delete_thread' : 'restore_thread',
      actorUsername: currentUser.username, actorDisplayName: currentUser.displayName,
      threadId, reason,
      summary: `${currentUser.displayName} hat das Thema „${threadDoc.title}" ${del ? 'gelöscht' : 'wiederhergestellt'}.`,
      deletedContent: del ? { title: threadDoc.title, category: threadDoc.category } : undefined
    });
    return json({ ok:true });
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

  return json({ id, name, type, size: file.size, url: '/api/file?id=' + encodeURIComponent(id) });
}

async function handleFileGet(url, kv, currentUser){
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
  for (const k of list.keys) {
    const u = await getJSON(kv, k.name, null);
    if (u && u.status === 'pending') users.push(publicUser(u));
  }
  users.sort((a,b) => a.createdAt - b.createdAt);
  return json({ users });
}

async function handleAdminUsers(kv){
  const list = await kv.list({ prefix: 'user:' });
  const users = [];
  for (const k of list.keys) {
    const u = await getJSON(kv, k.name, null);
    if (u) users.push(publicUser(u));
  }
  users.sort((a,b) => a.displayName.localeCompare(b.displayName, 'de'));
  return json({ users, offices: OFFICES });
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
    actorUsername: currentUser.username, actorDisplayName: currentUser.displayName,
    targetUsername: username,
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
    if (off.id !== user.office) { changes.push(`Amt: ${officeInfo(user.office).label} → ${off.label}`); user.office = off.id; }
  }
  if (typeof body.isAdmin === 'boolean' && body.isAdmin !== user.isAdmin) {
    changes.push(`Admin-Rechte: ${user.isAdmin ? 'ja' : 'nein'} → ${body.isAdmin ? 'ja' : 'nein'}`);
    user.isAdmin = body.isAdmin;
  }
  await kv.put('user:' + username, JSON.stringify(user));
  if (changes.length) {
    await addLogEntry(kv, {
      action:'update_user', actorUsername: currentUser.username, actorDisplayName: currentUser.displayName,
      targetUsername: username,
      summary: `${currentUser.displayName} hat das Profil von ${user.displayName} geändert: ${changes.join(', ')}.`
    });
  }
  return json({ ok:true, user: publicUser(user) });
}

async function handleAdminLog(kv){
  const log = await getJSON(kv, AUDITLOG_KEY, []);
  return json({ log });
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
        const user = await getSessionUser(request, url, kv);
        if (!user) return json({ error:'Nicht angemeldet.' }, 401);
        return json({ user: publicUser(user) });
      }

      if (path === '/api/forum') {
        const r = await requireAuth(request, url, kv);
        if (r.error) return r.error;
        if (request.method === 'GET') return await handleForumGet(request, url, kv, r.user);
        if (request.method === 'POST') return await handleForumPost(request, kv, r.user);
      }

      if (path === '/api/forum/moderate' && request.method === 'POST') {
        const r = await requireModerator(request, url, kv);
        if (r.error) return r.error;
        return await handleModerate(request, kv, r.user);
      }

      if (path === '/api/upload' && request.method === 'POST') {
        const r = await requireAuth(request, url, kv);
        if (r.error) return r.error;
        return await handleUpload(request, kv, r.user);
      }
      if (path === '/api/file' && request.method === 'GET') {
        const r = await requireAuth(request, url, kv);
        if (r.error) return r.error;
        return await handleFileGet(url, kv, r.user);
      }

      if (path === '/api/admin/pending' && request.method === 'GET') {
        const r = await requireAdmin(request, url, kv); if (r.error) return r.error;
        return await handleAdminPending(kv);
      }
      if (path === '/api/admin/users' && request.method === 'GET') {
        const r = await requireAdmin(request, url, kv); if (r.error) return r.error;
        return await handleAdminUsers(kv);
      }
      if (path === '/api/admin/approve' && request.method === 'POST') {
        const r = await requireAdmin(request, url, kv); if (r.error) return r.error;
        return await handleAdminApprove(request, kv, r.user);
      }
      if (path === '/api/admin/update-user' && request.method === 'POST') {
        const r = await requireAdmin(request, url, kv); if (r.error) return r.error;
        return await handleAdminUpdateUser(request, kv, r.user);
      }
      if (path === '/api/admin/log' && request.method === 'GET') {
        const r = await requireAdmin(request, url, kv); if (r.error) return r.error;
        return await handleAdminLog(kv);
      }

      if (path.startsWith('/api/')) return json({ error:'Nicht gefunden.' }, 404);
    } catch (err) {
      return json({ error: 'Serverfehler: ' + (err && err.message ? err.message : String(err)) }, 500);
    }

    // Alles andere: statische Website ausliefern
    return env.ASSETS.fetch(request);
  }
};
