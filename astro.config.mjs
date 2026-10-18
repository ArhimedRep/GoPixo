import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
const isUserSite = repo?.toLowerCase() === `${owner?.toLowerCase()}.github.io`;

export default defineConfig({
  site: process.env.SITE_URL ?? (owner ? `https://${owner}.github.io` : 'http://localhost:4321'),
  base: process.env.SITE_BASE ?? (repo && !isUserSite ? `/${repo}` : '/'),
  trailingSlash: 'always',
  integrations: [
    sitemap({
      i18n: { defaultLocale: 'ru', locales: { ru: 'ru-RU', en: 'en-US' } },
    }),
  ],
});
