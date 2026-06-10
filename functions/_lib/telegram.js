// Минимальный Telegram Bot API клиент для @Kiber_partner_bot.
// Используем sendMessage + setWebhook.

async function tgRequest(env, method, payload) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.warn('TELEGRAM_BOT_TOKEN не задан — пропускаем', method);
    return null;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json();
    if (!data.ok) {
      console.error('Telegram error', method, data);
    }
    return data;
  } catch (e) {
    console.error('Telegram fetch error', method, e);
    return null;
  }
}

async function sendMessage(env, chatId, text, opts = {}) {
  return tgRequest(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: opts.parse_mode || 'HTML',
    disable_web_page_preview: opts.disable_web_page_preview !== false,
    reply_markup: opts.reply_markup
  });
}

export { tgRequest, sendMessage };
