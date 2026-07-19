// Forum-Backend für den Mitgliederbereich — Cloudflare Pages Function.
// Speichert Themen (Threads) und Beiträge dauerhaft in Cloudflare Workers KV,
// sodass alle Mitglieder dieselben Inhalte sehen (nicht nur lokal im eigenen Browser).
//
// WICHTIG: Damit das funktioniert, muss im Cloudflare-Dashboard unter
// "Workers & Pages" -> dein Projekt -> "Settings" -> "Functions" ->
// "KV namespace bindings" eine KV-Namespace mit dem Variablennamen FORUM_KV
// angelegt und gebunden werden (siehe Anleitung im Chat).

const THREADS_KEY = 'threads';
const MEMBER_PASSWORD = '1234'; // einfacher, geteilter Zugangscode für den Mitgliederbereich

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function makeId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

function sanitize(str, max) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, max || 4000);
}

async function getJSON(kv, key, fallback) {
  const val = await kv.get(key, { type: 'json' });
  return val === null ? fallback : val;
}

// ---------- GET: Themenliste oder einzelnes Thema mit Beiträgen ----------
export async function onRequestGet(context) {
  const { request, env } = context;
  const kv = env.FORUM_KV;
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'thread') {
    const id = url.searchParams.get('id');
    const thread = await getJSON(kv, 'thread:' + id, null);
    if (!thread) return json({ error: 'Thema nicht gefunden.' }, 404);
    return json(thread);
  }

  const threads = await getJSON(kv, THREADS_KEY, []);
  threads.sort((a, b) => b.lastActivity - a.lastActivity);
  return json({ threads });
}

// ---------- POST: neues Thema oder neue Antwort erstellen ----------
export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FORUM_KV;

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'Ungültige Anfrage.' }, 400);
  }

  if (body.password !== MEMBER_PASSWORD) {
    return json({ error: 'Falsches Passwort.' }, 401);
  }

  const author = sanitize(body.author, 60) || 'Anonym';

  if (body.action === 'newThread') {
    const title = sanitize(body.title, 150);
    const category = sanitize(body.category, 40) || 'Allgemein';
    const message = sanitize(body.message, 4000);
    if (!title || !message) return json({ error: 'Titel und Nachricht dürfen nicht leer sein.' }, 400);

    const id = makeId();
    const now = Date.now();
    const firstPost = { id: makeId(), author, message, createdAt: now };

    const threadDoc = {
      id, title, category,
      createdAt: now,
      lastActivity: now,
      posts: [firstPost]
    };

    await kv.put('thread:' + id, JSON.stringify(threadDoc));

    const threads = await getJSON(kv, THREADS_KEY, []);
    threads.push({ id, title, category, author, createdAt: now, lastActivity: now, replyCount: 0 });
    await kv.put(THREADS_KEY, JSON.stringify(threads));

    return json(threadDoc);
  }

  if (body.action === 'reply') {
    const threadId = sanitize(body.threadId, 100);
    const message = sanitize(body.message, 4000);
    if (!threadId || !message) return json({ error: 'Nachricht darf nicht leer sein.' }, 400);

    const threadDoc = await getJSON(kv, 'thread:' + threadId, null);
    if (!threadDoc) return json({ error: 'Thema nicht gefunden.' }, 404);

    const now = Date.now();
    threadDoc.posts.push({ id: makeId(), author, message, createdAt: now });
    threadDoc.lastActivity = now;
    await kv.put('thread:' + threadId, JSON.stringify(threadDoc));

    const threads = await getJSON(kv, THREADS_KEY, []);
    const idx = threads.findIndex(t => t.id === threadId);
    if (idx !== -1) {
      threads[idx].lastActivity = now;
      threads[idx].replyCount = threadDoc.posts.length - 1;
      await kv.put(THREADS_KEY, JSON.stringify(threads));
    }

    return json(threadDoc);
  }

  return json({ error: 'Unbekannte Aktion.' }, 400);
}
