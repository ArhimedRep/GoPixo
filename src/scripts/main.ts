import { animate, inView, scroll, stagger } from 'motion';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = [0.2, 0.8, 0.2, 1] as const;

// Scroll progress in the header
const bar = document.querySelector<HTMLElement>('.progress');
if (bar) scroll((p: number) => (bar.style.transform = `scaleX(${p})`));

// Reveal animations
if (!reduced) {
  const words = document.querySelectorAll<HTMLElement>('[data-split] .w > span');
  if (words.length) {
    animate(words, { transform: ['translateY(115%)', 'translateY(0%)'] }, { duration: 0.9, delay: stagger(0.07, { startDelay: 0.1 }), ease });
  }

  const heroItems = document.querySelectorAll<HTMLElement>('.hero [data-reveal]');
  heroItems.forEach((el, i) => {
    animate(el, { opacity: [0, 1], transform: ['translateY(28px)', 'translateY(0px)'] }, { duration: 0.8, delay: 0.35 + i * 0.1, ease });
  });

  document.querySelectorAll<HTMLElement>('[data-reveal]').forEach((el) => {
    if (el.closest('.hero')) return;
    inView(
      el,
      () => {
        animate(el, { opacity: [0, 1], transform: ['translateY(28px)', 'translateY(0px)'] }, { duration: 0.8, ease });
      },
      { amount: 0.15 },
    );
  });
}

// Process line fill + active steps
const steps = document.querySelector<HTMLElement>('[data-steps]');
if (steps) {
  const items = Array.from(steps.querySelectorAll<HTMLElement>('.step'));
  scroll(
    (p: number) => {
      steps.style.setProperty('--p', String(p));
      const y = p * steps.offsetHeight;
      items.forEach((it) => it.classList.toggle('is-active', it.offsetTop <= y + 8));
    },
    { target: steps, offset: ['start 65%', 'end 65%'] },
  );
}

// Mobile menu
const burger = document.querySelector<HTMLButtonElement>('.burger');
const menu = document.querySelector<HTMLElement>('#menu');
if (burger && menu) {
  const setOpen = (open: boolean) => {
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', (open ? burger.dataset.closeLabel : burger.dataset.openLabel) ?? '');
    menu.dataset.open = String(open);
    document.body.style.overflow = open ? 'hidden' : '';
  };
  burger.addEventListener('click', () => setOpen(burger.getAttribute('aria-expanded') !== 'true'));
  menu.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.dataset.open === 'true') {
      setOpen(false);
      burger.focus();
    }
  });
  window.matchMedia('(min-width: 62rem)').addEventListener('change', (e) => e.matches && setOpen(false));
}

// Active nav link
const navLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.nav a[data-nav]'));
if (navLinks.length && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        navLinks.forEach((a) => {
          if (a.dataset.nav === e.target.id) a.setAttribute('aria-current', 'true');
          else a.removeAttribute('aria-current');
        });
      });
    },
    { rootMargin: '-45% 0px -50% 0px' },
  );
  navLinks.forEach((a) => {
    const section = document.getElementById(a.dataset.nav ?? '');
    if (section) io.observe(section);
  });
}

// Contact form: builds a mailto draft, no backend required
const form = document.querySelector<HTMLFormElement>('form[data-config]');
if (form) {
  const cfg = JSON.parse(form.dataset.config ?? '{}') as {
    email: string;
    subject: string;
    labels: { name: string; contact: string; type: string; message: string };
    copy: string;
    copied: string;
  };
  const errRequired = form.dataset.required ?? '';
  const errContact = form.dataset.invalidContact ?? '';
  const ok = form.querySelector<HTMLElement>('.form__ok');
  const copyBtn = form.querySelector<HTMLButtonElement>('[data-copy]');
  let draft = '';

  const contactRe = /^(?:[^\s@]+@[^\s@]+\.[^\s@]{2,}|@?[A-Za-z0-9_]{4,32}|\+?[\d\s()-]{7,20})$/;

  const setError = (name: string, msg: string) => {
    const input = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
    const field = input.closest<HTMLElement>('.field');
    const out = form.querySelector<HTMLElement>(`#e-${name}`);
    if (field) field.dataset.invalid = String(Boolean(msg));
    input.setAttribute('aria-invalid', String(Boolean(msg)));
    if (out) out.textContent = msg;
  };

  const validate = (): boolean => {
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const contact = String(data.get('contact') ?? '').trim();
    const message = String(data.get('message') ?? '').trim();
    setError('name', name ? '' : errRequired);
    setError('contact', !contact ? errRequired : contactRe.test(contact) ? '' : errContact);
    setError('message', message ? '' : errRequired);
    return Boolean(name && contact && contactRe.test(contact) && message);
  };

  ['name', 'contact', 'message'].forEach((n) => {
    form.elements.namedItem(n)?.addEventListener('input', () => {
      if ((form.elements.namedItem(n) as HTMLInputElement).getAttribute('aria-invalid') === 'true') validate();
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validate()) {
      form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    const d = new FormData(form);
    const l = cfg.labels;
    draft = [
      `${l.name}: ${String(d.get('name')).trim()}`,
      `${l.contact}: ${String(d.get('contact')).trim()}`,
      `${l.type}: ${String(d.get('type'))}`,
      '',
      `${l.message}:`,
      String(d.get('message')).trim(),
    ].join('\n');
    window.location.href = `mailto:${cfg.email}?subject=${encodeURIComponent(cfg.subject)}&body=${encodeURIComponent(draft)}`;
    if (ok) {
      ok.hidden = false;
      ok.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    }
  });

  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(`${cfg.email}\n\n${draft}`);
      copyBtn.textContent = cfg.copied;
      setTimeout(() => (copyBtn.textContent = cfg.copy), 2000);
    } catch {
      copyBtn.textContent = cfg.copy;
    }
  });
}

(window as unknown as { __ready: boolean }).__ready = true;
