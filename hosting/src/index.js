// Раздаёт собранный сайт (папка dist) и перенаправляет www на основной домен.
const APEX = 'gopixo.shop';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.hostname === `www.${APEX}`) {
      url.hostname = APEX;
      return Response.redirect(url.toString(), 301);
    }
    return env.ASSETS.fetch(req);
  },
};
