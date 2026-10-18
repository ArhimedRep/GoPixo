// Раздаёт собранный сайт (папка dist) и перенаправляет www на основной домен.
const APEX = 'gopixo.shop';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.hostname === `www.${APEX}`) {
      url.hostname = APEX;
      return Response.redirect(url.toString(), 301);
    }
    // Файлы подтверждения (yandex_*.html, google*.html) должны открываться по точному адресу без редиректа
    if (/^\/(yandex_|google)[\w-]+\.html$/.test(url.pathname)) {
      const res = await env.ASSETS.fetch(new Request(new URL(url.pathname.replace(/\.html$/, ''), url), req));
      return new Response(res.body, { status: res.status, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return env.ASSETS.fetch(req);
  },
};
