// POST /api/telegram/webhook — приём апдейтов от @Kiber_partner_bot.
// Регистрируется один раз:
//   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://partner.it-kiber.ru/api/telegram/webhook&secret_token=<SECRET>"
//
// Команды:
//   /start <partner_slug> — привязать Telegram-аккаунт к партнёру (записывает в telegram_bindings)
//   /start (без аргумента) — справка с инструкцией
//   /help — то же
//   /stats — короткая сводка по последней неделе (если привязан партнёр)

import { jsonResponse, nowSec } from '../../_lib/auth.js';
import { sendMessage } from '../../_lib/telegram.js';

const HELP_TEXT =
  '<b>Партнёрский бот KIBERone</b>\n\n' +
  'Чтобы привязать этот Telegram к вашему партнёрскому аккаунту, отправьте:\n' +
  '<code>/start ваш_slug</code>\n\n' +
  'Slug вам выдал менеджер развития KIBERone (например, <code>stomat_chln_01</code>).\n\n' +
  'После привязки сюда будут приходить:\n' +
  '• Коды для входа в кабинет\n' +
  '• Еженедельные сводки\n' +
  '• Уведомления о новых анкетах\n\n' +
  'Команды:\n' +
  '/start <i>slug</i> — привязать партнёра\n' +
  '/stats — сводка за неделю\n' +
  '/help — эта справка';

async function handleStart(env, msg, args) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || null;

  if (!args || !args[0]) {
    await sendMessage(env, chatId, HELP_TEXT);
    return;
  }

  const slug = args[0].trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!slug) {
    await sendMessage(env, chatId, '❌ Slug содержит недопустимые символы.\n\n' + HELP_TEXT);
    return;
  }

  if (!env.DB) {
    await sendMessage(env, chatId, '⚠️ База данных временно недоступна, попробуйте через минуту.');
    return;
  }

  const partner = await env.DB.prepare(
    "SELECT slug, name, city FROM partners WHERE slug = ? AND status = 'active'"
  ).bind(slug).first();

  if (!partner) {
    await sendMessage(env, chatId,
      `❌ Партнёр <code>${slug}</code> не найден или не активирован.\n\n` +
      `Свяжитесь с менеджером развития KIBERone, чтобы уточнить slug.`);
    return;
  }

  await env.DB.prepare(
    `INSERT INTO telegram_bindings (partner_slug, telegram_user_id, telegram_username, bound_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(partner_slug) DO UPDATE SET
       telegram_user_id = excluded.telegram_user_id,
       telegram_username = excluded.telegram_username,
       bound_at = excluded.bound_at`
  ).bind(slug, userId, username, nowSec()).run();

  await sendMessage(env, chatId,
    `✅ Telegram привязан к партнёру <b>${partner.name}</b> (${partner.city}).\n\n` +
    `Теперь можно войти в кабинет:\n` +
    `https://partner.it-kiber.ru/login.html\n\n` +
    `На странице введите ваш slug — пришлю сюда 6-значный код.`);
}

async function handleStats(env, msg) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!env.DB) {
    await sendMessage(env, chatId, '⚠️ База данных временно недоступна.');
    return;
  }

  const binding = await env.DB.prepare(
    'SELECT partner_slug FROM telegram_bindings WHERE telegram_user_id = ?'
  ).bind(userId).first();

  if (!binding) {
    await sendMessage(env, chatId,
      '❌ Сначала привяжите партнёра командой /start <i>slug</i>');
    return;
  }

  const slug = binding.partner_slug;
  const weekAgo = nowSec() - 7 * 24 * 3600;
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS leads,
            SUM(CASE WHEN status IN ('trial_came','paid') THEN 1 ELSE 0 END) AS trials,
            SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid,
            COALESCE(SUM(reward_anketa+COALESCE(reward_trial,0)+COALESCE(reward_paid,0)),0) AS amount
       FROM leads WHERE partner_slug = ? AND submitted_at >= ?`
  ).bind(slug, weekAgo).first();

  const scans = await env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM scans WHERE partner_slug = ? AND scanned_at >= ?'
  ).bind(slug, weekAgo).first();

  const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n || 0);

  await sendMessage(env, chatId,
    `<b>📊 Ваша сводка за 7 дней</b>\n\n` +
    `Сканов QR: <b>${scans?.cnt || 0}</b>\n` +
    `Анкет: <b>${row?.leads || 0}</b>\n` +
    `Пробных состоялось: <b>${row?.trials || 0}</b>\n` +
    `Оплат годовых: <b>${row?.paid || 0}</b>\n\n` +
    `Начислено: <b>${fmt(row?.amount)} ₽</b>\n\n` +
    `Подробнее → https://partner.it-kiber.ru/cabinet.html`);
}

export async function onRequestPost({ request, env }) {
  // Защита webhook'а: Telegram должен прислать secret_token в заголовке.
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (env.TELEGRAM_WEBHOOK_SECRET && secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  let update;
  try { update = await request.json(); }
  catch { return jsonResponse({ ok: false }, { status: 400 }); }

  const msg = update.message;
  if (!msg || !msg.text) return jsonResponse({ ok: true });

  const text = msg.text.trim();
  const parts = text.split(/\s+/);
  const cmd = parts[0].split('@')[0].toLowerCase();
  const args = parts.slice(1);

  try {
    if (cmd === '/start') {
      await handleStart(env, msg, args);
    } else if (cmd === '/help') {
      await sendMessage(env, msg.chat.id, HELP_TEXT);
    } else if (cmd === '/stats') {
      await handleStats(env, msg);
    } else {
      await sendMessage(env, msg.chat.id, 'Не понял команду. /help — справка');
    }
  } catch (e) {
    console.error('webhook error', e);
  }

  // Telegram ожидает быстрый 200, поэтому всегда отвечаем ok.
  return jsonResponse({ ok: true });
}
