type Msg = { id: number; from: 'user' | 'admin'; text: string };

const root = document.querySelector<HTMLElement>('[data-chat]');

if (root) {
  const api = (root.dataset.api ?? '').replace(/\/$/, '');
  const panel = root.querySelector<HTMLElement>('.chat__panel')!;
  const fab = root.querySelector<HTMLButtonElement>('.chat__fab')!;
  const log = root.querySelector<HTMLElement>('[data-chat-log]')!;
  const form = root.querySelector<HTMLFormElement>('[data-chat-form]')!;
  const err = root.querySelector<HTMLElement>('[data-chat-err]')!;
  const text = form.elements.namedItem('text') as HTMLTextAreaElement;
  const consent = form.elements.namedItem('consent') as HTMLInputElement;
  const nameEl = form.elements.namedItem('name') as HTMLInputElement;

  const store = {
    get: (k: string) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k: string, v: string) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* приватный режим: чат работает до закрытия вкладки */
      }
    },
    del: (k: string) => {
      try {
        localStorage.removeItem(k);
      } catch {
        /* то же */
      }
    },
  };

  // randomUUID доступен только по HTTPS, поэтому собираем идентификатор сами
  const newSid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

  let sid = store.get('gp_sid');
  if (!sid || !/^[a-z0-9-]{16,64}$/.test(sid)) {
    sid = newSid();
    store.set('gp_sid', sid);
  }
  const rendered = new Set<number>();
  let after = 0;
  let timer: number | undefined;

  const add = (who: 'me' | 'them', body: string) => {
    const p = document.createElement('p');
    p.className = `chat__msg chat__msg--${who}`;
    p.textContent = body;
    log.append(p);
    log.scrollTop = log.scrollHeight;
  };

  // История и новые ответы приходят с сервера, поэтому после обновления страницы переписка на месте
  const poll = async () => {
    const mine = sid;
    try {
      const r = await fetch(`${api}/poll?sid=${mine}&after=${after}`);
      if (!r.ok || mine !== sid) return;
      const d = (await r.json()) as { msgs: Msg[] };
      if (d.msgs.length) store.set('gp_used', '1');
      for (const m of d.msgs) {
        after = Math.max(after, m.id);
        if (rendered.has(m.id)) continue;
        rendered.add(m.id);
        add(m.from === 'user' ? 'me' : 'them', m.text);
      }
    } catch {
      /* сеть пропала: попробуем на следующем тике */
    }
  };

  const startPolling = () => {
    window.clearInterval(timer);
    poll();
    timer = window.setInterval(() => !document.hidden && poll(), 3000);
  };

  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    fab.setAttribute('aria-expanded', String(open));
    fab.hidden = open;
    if (open) {
      startPolling();
      (consent.checked ? text : nameEl).focus();
    } else {
      window.clearInterval(timer);
      fab.focus();
    }
  };

  root.querySelectorAll('[data-chat-toggle]').forEach((b) => b.addEventListener('click', () => setOpen(panel.hidden)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) setOpen(false);
  });

  // Новый чат: новый код диалога; в Telegram первое сообщение придёт с пометкой о прошлом коде
  root.querySelector('[data-chat-new]')!.addEventListener('click', () => {
    if (store.get('gp_used') === '1') store.set('gp_prev', sid!);
    sid = newSid();
    store.set('gp_sid', sid);
    store.del('gp_used');
    rendered.clear();
    after = 0;
    log.querySelectorAll('.chat__msg:not([data-chat-intro])').forEach((n) => n.remove());
    err.textContent = '';
    text.value = '';
    text.focus();
  });

  if (store.get('gp_consent') === '1') consent.checked = true;
  if (store.get('gp_name')) nameEl.value = store.get('gp_name') ?? '';

  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    const body = text.value.trim();
    if (!body) return text.focus();
    if (!consent.checked) {
      err.textContent = root.dataset.errConsent ?? '';
      return consent.focus();
    }
    text.disabled = true;
    try {
      const r = await fetch(`${api}/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sid, text: body, name: nameEl.value.trim(), consent: true, prev: store.get('gp_prev') ?? undefined }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as { id: number };
      rendered.add(d.id);
      add('me', body);
      text.value = '';
      store.set('gp_used', '1');
      store.del('gp_prev');
      store.set('gp_consent', '1');
      store.set('gp_name', nameEl.value.trim());
    } catch (x) {
      err.textContent = (x as Error).message === '429' ? (root.dataset.errRate ?? '') : (root.dataset.errSend ?? '');
    } finally {
      text.disabled = false;
      text.focus();
    }
  });
}
