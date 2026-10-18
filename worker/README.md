# Чат GoPixo: Cloudflare Worker

Связывает окно чата на сайте с Telegram-ботом.
Посетитель пишет на сайте, сообщение приходит в Telegram. Ответ нужно отправить реплаем, он появится в окне на сайте.

Секреты (`BOT_TOKEN`, `ADMIN_ID`, `WEBHOOK_SECRET`) задаются через `wrangler secret put` и в репозиторий не попадают.
Переписка хранится в KV 30 дней.

Деплой: `cd worker && npx wrangler deploy`
