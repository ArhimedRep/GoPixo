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
  };

  let sid = store.get('gp_sid');
  if (!sid || !/^[a-z0-9-]{16,64}$/.test(sid)) {
    sid = crypto.randomUUID();
    store.set('gp_sid', sid);
  }
  let after = Number(store.get('gp_after') ?? 0);
  let timer: number | undefined;

  const add = (who: 'me' | 'them', body: string) => {
    const p = document.createElement('p');
    p.className = `chat__msg chat__msg--${who}`;
    p.textContent = body;
    log.append(p);
    log.scrollTop = log.scrollHeight;
  };

  const poll = async () => {
    try {
      const r = await fetch(`${api}/poll?sid=${sid}&after=${after}`);
      if (!r.ok) return;
      const d = (await r.json()) as { msgs: { id: number; text: string }[] };
      for (const m of d.msgs) {
        add('them', m.text);
        after = Math.max(after, m.id);
      }
      if (d.msgs.length) store.set('gp_after', String(after));
    } catch {
      /* сеть пропала: попробуем на следующем тике */
    }
  };

  const startPolling = () => {
    window.clearInterval(timer);
    poll();
    timer = window.setInterval(() => !document.hidden && poll(), 4000);
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
        body: JSON.stringify({ sid, text: body, name: nameEl.value.trim(), consent: true }),
      });
      if (!r.ok) throw new Error(String(r.status));
      add('me', body);
      text.value = '';
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
