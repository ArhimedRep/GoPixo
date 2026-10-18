import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const CUSTOM_DOMAIN = 'gopixo.shop';

export default defineConfig({
  site: process.env.SITE_URL ?? `https://${CUSTOM_DOMAIN}`,
  base: process.env.SITE_BASE ?? '/',
  trailingSlash: 'always',
  integrations: [
    sitemap({
      i18n: { defaultLocale: 'ru', locales: { ru: 'ru-RU', en: 'en-US' } },
    }),
  ],
});
