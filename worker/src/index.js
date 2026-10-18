// Чат GoPixo: сайт <-> Telegram-бот.
// Посетитель пишет на сайте -> сообщение приходит админу в Telegram.
// Админ отвечает реплаем на сообщение -> ответ появляется в окне чата на сайте.
// Секреты (не в репозитории): BOT_TOKEN, ADMIN_ID, WEBHOOK_SECRET.

const TTL = 60 * 60 * 24 * 30; // хранить переписку 30 дней
const MAX_TEXT = 1000;
const MAX_MSGS = 200;
const RATE_PER_HOUR = 30;
const SID_RE = /^[a-z0-9-]{16,64}$/;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });

const corsFor = (req, env) => {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim());
  const h = { Vary: 'Origin' };
  if (allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'content-type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return { h, ok: allowed.includes(origin) };
};

const tg = (env, method, body) =>
  fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const loadChat = async (env, sid) => (await env.CHAT.get(`c:${sid}`, 'json')) ?? { next: 1, msgs: [] };
const saveChat = (env, sid, chat) => {
  if (chat.msgs.length > MAX_MSGS) chat.msgs = chat.msgs.slice(-MAX_MSGS);
  return env.CHAT.put(`c:${sid}`, JSON.stringify(chat), { expirationTtl: TTL });
};
const addMsg = (chat, from, text) => {
  chat.msgs.push({ id: chat.next++, from, text, ts: Date.now() });
};

async function handleSend(req, env) {
  let b;
  try {
    b = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const sid = String(b.sid ?? '');
  const text = String(b.text ?? '').trim();
  const name = String(b.name ?? '').trim().slice(0, 60);
  if (!SID_RE.test(sid)) return json({ error: 'bad_sid' }, 400);
  if (!text || text.length > MAX_TEXT) return json({ error: 'bad_text' }, 400);
  if (b.consent !== true) return json({ error: 'consent_required' }, 400);

  const hour = Math.floor(Date.now() / 3.6e6);
  const rk = `r:${sid}:${hour}`;
  const n = Number((await env.CHAT.get(rk)) ?? 0);
  if (n >= RATE_PER_HOUR) return json({ error: 'rate_limited' }, 429);
  await env.CHAT.put(rk, String(n + 1), { expirationTtl: 3700 });

  const chat = await loadChat(env, sid);
  const first = chat.msgs.length === 0;
  addMsg(chat, 'user', text);
  if (name) chat.name = name;
  await saveChat(env, sid, chat);

  const tag = sid.slice(0, 6);
  const head = `${first ? '💬 Новый чат' : '💬 Чат'} #${tag}${chat.name ? ` · ${chat.name}` : ''}`;
  const res = await tg(env, 'sendMessage', {
    chat_id: env.ADMIN_ID,
    text: `${head}\n\n${text}\n\n— ответьте на это сообщение «ответом» (reply), чтобы написать посетителю`,
  });
  if (res.ok) await env.CHAT.put(`t:${res.result.message_id}`, sid, { expirationTtl: TTL });
  return json({ ok: true, id: chat.msgs[chat.msgs.length - 1].id, delivered: Boolean(res.ok) });
}

async function handleLead(req, env) {
  let b;
  try {
    b = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const f = (k, n) => String(b[k] ?? '').trim().slice(0, n);
  const name = f('name', 80);
  const contact = f('contact', 120);
  const type = f('type', 80);
  const message = f('message', 1500);
  if (!name || !contact || !message) return json({ error: 'bad_fields' }, 400);
  if (b.consent !== true) return json({ error: 'consent_required' }, 400);

  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  const rk = `l:${ip}:${Math.floor(Date.now() / 3.6e6)}`;
  const n = Number((await env.CHAT.get(rk)) ?? 0);
  if (n >= 8) return json({ error: 'rate_limited' }, 429);
  await env.CHAT.put(rk, String(n + 1), { expirationTtl: 3700 });

  const when = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  const res = await tg(env, 'sendMessage', {
    chat_id: env.ADMIN_ID,
    text: `📩 Заявка с сайта\n\nИмя: ${name}\nКонтакт: ${contact}\nТип проекта: ${type}\n\n${message}\n\nСогласие на обработку ПДн: дано (${when} МСК)`,
  });
  return res.ok ? json({ ok: true }) : json({ error: 'delivery_failed' }, 502);
}

async function handlePoll(url, env) {
  const sid = url.searchParams.get('sid') ?? '';
  const after = Number(url.searchParams.get('after') ?? 0);
  if (!SID_RE.test(sid)) return json({ error: 'bad_sid' }, 400);
  const chat = await loadChat(env, sid);
  return json({ msgs: chat.msgs.filter((m) => m.id > after && m.from === 'admin') });
}

async function handleTelegram(req, env) {
  if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('forbidden', { status: 403 });
  const u = await req.json();
  const m = u.message;
  if (!m || String(m.from?.id) !== String(env.ADMIN_ID)) return new Response('ok');
  const say = (text) => tg(env, 'sendMessage', { chat_id: env.ADMIN_ID, text });

  if (m.text === '/start') {
    await say('Бот чата GoPixo подключён. Сообщения с сайта будут приходить сюда. Чтобы ответить посетителю, отвечайте реплаем на его сообщение.');
    return new Response('ok');
  }
  const target = m.reply_to_message?.message_id;
  if (!target) {
    await say('Чтобы ответить посетителю, ответьте реплаем на его сообщение.');
    return new Response('ok');
  }
  const sid = await env.CHAT.get(`t:${target}`);
  if (!sid) {
    await say('Не нашёл этот диалог: возможно, он старше 30 дней.');
    return new Response('ok');
  }
  const text = String(m.text ?? '').trim().slice(0, 2000);
  if (!text) {
    await say('Пока поддерживается только текст.');
    return new Response('ok');
  }
  const chat = await loadChat(env, sid);
  addMsg(chat, 'admin', text);
  await saveChat(env, sid, chat);
  return new Response('ok');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/tg') return handleTelegram(req, env);

    const { h, ok } = corsFor(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: ok ? 204 : 403, headers: h });
    if (!ok) return json({ error: 'forbidden_origin' }, 403, h);

    let res;
    if (url.pathname === '/send' && req.method === 'POST') res = await handleSend(req, env);
    else if (url.pathname === '/lead' && req.method === 'POST') res = await handleLead(req, env);
    else if (url.pathname === '/poll' && req.method === 'GET') res = await handlePoll(url, env);
    else res = json({ error: 'not_found' }, 404);
    for (const [k, v] of Object.entries(h)) res.headers.set(k, v);
    return res;
  },
};
