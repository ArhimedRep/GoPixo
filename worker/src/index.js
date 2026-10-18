// Чат GoPixo: сайт <-> Telegram-бот.
// Посетитель пишет на сайте -> сообщение приходит админу в Telegram.
// Админ отвечает реплаем на сообщение -> ответ появляется в окне чата на сайте.
// Секреты (не в репозитории): BOT_TOKEN, ADMIN_ID, WEBHOOK_SECRET.
import { DurableObject } from 'cloudflare:workers';

const TTL = 60 * 60 * 24 * 30; // хранить переписку 30 дней (секунды)
const MAX_TEXT = 1000;
const MAX_MSGS = 200;
const RATE_PER_HOUR = 30;
const SID_RE = /^[a-z0-9-]{16,64}$/;

// Данные о посетителе для сообщения админу: IP, примерное место, устройство, страница и источник
const visitorInfo = (req, b) => {
  const cf = req.cf ?? {};
  const ua = req.headers.get('User-Agent') ?? '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /YaBrowser/.test(ua) ? 'Яндекс Браузер' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'неизвестный браузер';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '?';
  const device = /Mobi|Android|iPhone/.test(ua) ? 'телефон' : 'компьютер';
  const clip = (v, n) => String(v ?? '').slice(0, n).replace(/[\r\n]+/g, ' ');
  const where = [cf.country, cf.region, cf.city].filter(Boolean).join(', ') || 'не определено';
  return [
    `IP: ${req.headers.get('CF-Connecting-IP') ?? 'не определён'}`,
    `Откуда: ${where}${cf.timezone ? ` (${cf.timezone})` : ''}`,
    `Устройство: ${device}, ${os}, ${browser}`,
    b.page ? `Страница: ${clip(b.page, 80)}${b.lang ? ` (${clip(b.lang, 10)})` : ''}` : '',
    `Пришёл с: ${clip(b.ref, 120) || 'напрямую'}`,
  ]
    .filter(Boolean)
    .join('\n');
};

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
  fetch(`${env.TG_API ?? 'https://api.telegram.org'}/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const hub = (env, name) => env.HUB.get(env.HUB.idFromName(name));

// Одна запись Durable Object = одна переписка (имя = sid).
// Объекты "index" и "limits" хранят связь сообщений Telegram с диалогами и счётчики запросов.
export class Hub extends DurableObject {
  async append(from, text, name, info) {
    const chat = (await this.ctx.storage.get('chat')) ?? { next: 1, msgs: [] };
    const first = chat.msgs.length === 0;
    const msg = { id: chat.next++, from, text, ts: Date.now() };
    chat.msgs.push(msg);
    if (chat.msgs.length > MAX_MSGS) chat.msgs = chat.msgs.slice(-MAX_MSGS);
    if (name) chat.name = name;
    if (info && !chat.info) {
      chat.info = info;
      chat.started = msg.ts;
    }
    await this.ctx.storage.put('chat', chat);
    await this.ctx.storage.setAlarm(Date.now() + TTL * 1000);
    return { id: msg.id, first, name: chat.name };
  }
  async poll(after) {
    const chat = await this.ctx.storage.get('chat');
    return (chat?.msgs ?? []).filter((m) => m.id > after);
  }
  async getInfo() {
    const chat = await this.ctx.storage.get('chat');
    return chat ? { name: chat.name, info: chat.info, started: chat.started, count: chat.msgs.length } : null;
  }
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
  async wipe() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
  async register(sid) {
    await this.ctx.storage.put(`s:${sid}`, 1);
  }
  async findByTag(tag) {
    const m = await this.ctx.storage.list({ prefix: `s:${tag}` });
    return [...m.keys()].map((k) => k.slice(2));
  }
  async allSids() {
    const m = await this.ctx.storage.list({ prefix: 's:' });
    return [...m.keys()].map((k) => k.slice(2));
  }
  async forget(sid) {
    await this.ctx.storage.delete(`s:${sid}`);
    const t = await this.ctx.storage.list({ prefix: 't:' });
    const del = [...t].filter(([, v]) => v === sid).map(([k]) => k);
    if (del.length) await this.ctx.storage.delete(del);
  }
  async forgetAll() {
    await this.ctx.storage.deleteAll();
  }
  async setMap(id, sid) {
    await this.ctx.storage.put(`t:${id}`, sid);
  }
  async getMap(id) {
    return this.ctx.storage.get(`t:${id}`);
  }
  async hit(key, limit) {
    const k = `r:${key}:${Math.floor(Date.now() / 3.6e6)}`;
    const n = (await this.ctx.storage.get(k)) ?? 0;
    if (n >= limit) return false;
    await this.ctx.storage.put(k, n + 1);
    return true;
  }
}

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
  const prev = String(b.prev ?? '');
  if (!SID_RE.test(sid)) return json({ error: 'bad_sid' }, 400);
  if (!text || text.length > MAX_TEXT) return json({ error: 'bad_text' }, 400);
  if (b.consent !== true) return json({ error: 'consent_required' }, 400);

  const chatHub = hub(env, sid);
  if (!(await hub(env, 'limits').hit(`s:${sid}`, RATE_PER_HOUR))) return json({ error: 'rate_limited' }, 429);

  const saved = await chatHub.append('user', text, name, visitorInfo(req, b));
  if (saved.first) await hub(env, 'index').register(sid);
  const tag = sid.slice(0, 6);
  const was = saved.first && SID_RE.test(prev) && prev !== sid ? ` (прошлый: #${prev.slice(0, 6)})` : '';
  const head = `${saved.first ? '💬 Новый чат' : '💬 Чат'} #${tag}${was}${saved.name ? ` · ${saved.name}` : ''}`;
  const res = await tg(env, 'sendMessage', {
    chat_id: env.ADMIN_ID,
    text: `${head}\n\n${text}${saved.first ? `\n\n${visitorInfo(req, b)}` : ''}\n\n— ответьте на это сообщение «ответом» (reply), чтобы написать посетителю`,
  });
  if (res.ok) await hub(env, 'index').setMap(res.result.message_id, sid);
  return json({ ok: true, id: saved.id, delivered: Boolean(res.ok) });
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
  if (!(await hub(env, 'limits').hit(`l:${ip}`, 8))) return json({ error: 'rate_limited' }, 429);

  const when = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
  const res = await tg(env, 'sendMessage', {
    chat_id: env.ADMIN_ID,
    text: `📩 Заявка с сайта\n\nИмя: ${name}\nКонтакт: ${contact}\nТип проекта: ${type}\n\n${message}\n\n${visitorInfo(req, b)}\n\nСогласие на обработку ПДн: дано (${when} МСК)`,
  });
  return res.ok ? json({ ok: true }) : json({ error: 'delivery_failed' }, 502);
}

async function handlePoll(url, env) {
  const sid = url.searchParams.get('sid') ?? '';
  const after = Number(url.searchParams.get('after') ?? 0);
  if (!SID_RE.test(sid)) return json({ error: 'bad_sid' }, 400);
  return json({ msgs: await hub(env, sid).poll(after) });
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
  const clear = /^\/clear(?:@\w+)?\s*(.*)$/i.exec(m.text ?? '');
  if (clear) {
    const arg = clear[1].trim().replace(/^#/, '').toLowerCase();
    const index = hub(env, 'index');
    if (arg === 'all') {
      const sids = await index.allSids();
      for (const sid of sids) await hub(env, sid).wipe();
      await index.forgetAll();
      await say(`Удалено диалогов: ${sids.length}.`);
    } else if (/^[a-z0-9]{4,}$/.test(arg)) {
      const sids = await index.findByTag(arg);
      if (sids.length !== 1) {
        await say(sids.length ? 'Метке соответствует несколько диалогов, укажите её длиннее.' : `Диалог #${arg} не найден.`);
      } else {
        await hub(env, sids[0]).wipe();
        await index.forget(sids[0]);
        await say(`Диалог #${arg} удалён с сервера.`);
      }
    } else {
      await say('Команды: /clear #метка — удалить один диалог, /clear all — удалить все диалоги, /info #метка — данные о посетителе.');
    }
    return new Response('ok');
  }

  const info = /^\/info(?:@\w+)?\s*(.*)$/i.exec(m.text ?? '');
  if (info) {
    const arg = info[1].trim().replace(/^#/, '').toLowerCase();
    if (!/^[a-z0-9]{4,}$/.test(arg)) {
      await say('Напишите так: /info #метка (метка стоит в заголовке сообщения диалога).');
      return new Response('ok');
    }
    const sids = await hub(env, 'index').findByTag(arg);
    if (sids.length !== 1) {
      await say(sids.length ? 'Метке соответствует несколько диалогов, укажите её длиннее.' : `Диалог #${arg} не найден.`);
      return new Response('ok');
    }
    const d = await hub(env, sids[0]).getInfo();
    if (!d) {
      await say(`Диалог #${arg} не найден.`);
    } else if (!d.info) {
      await say(`Диалог #${arg}${d.name ? ` · ${d.name}` : ''}\nДанных о посетителе нет: диалог начат до включения сбора.`);
    } else {
      const when = new Date(d.started).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
      await say(`Диалог #${arg}${d.name ? ` · ${d.name}` : ''}\nНачат: ${when} МСК, сообщений: ${d.count}\n\n${d.info}`);
    }
    return new Response('ok');
  }

  const target = m.reply_to_message?.message_id;
  if (!target) {
    await say('Чтобы ответить посетителю, ответьте реплаем на его сообщение.');
    return new Response('ok');
  }
  const sid = await hub(env, 'index').getMap(target);
  if (!sid) {
    await say('Не нашёл этот диалог: возможно, он старше 30 дней.');
    return new Response('ok');
  }
  const text = String(m.text ?? '').trim().slice(0, 2000);
  if (!text) {
    await say('Пока поддерживается только текст.');
    return new Response('ok');
  }
  await hub(env, sid).append('admin', text);
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
