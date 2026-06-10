// POST /api/submit — приём анкеты
// Body: { partner_slug, session_id, child_name, child_age, parent_whatsapp, hero_config }
//
// Делает:
//  1. Сохранение лида в D1
//  2. Запись лида в AlphaCRM с тегом партнёра
//  3. Отправка WhatsApp через Wazzup24
//  4. Возврат данных награды (PDF, видео, слоты)

// legal_entity — по schema.sql: ip_razin / ip_karina / ooo_lab.
// Эти строки идут в note AlphaCRM (numeric branch ID для AlphaCRM мы пока не задаём — ставится менеджером вручную).
const TUTOR_BY_CITY = {
  chln:  { name: 'Анна',      city: 'Челны',      cityLocative: 'Челнах',      legal_entity: 'ip_razin'  },
  nkmsk: { name: 'Елена',     city: 'Нижнекамск', cityLocative: 'Нижнекамске', legal_entity: 'ip_karina' },
  kzn:   { name: 'Дилюза',    city: 'Казань',     cityLocative: 'Казани',      legal_entity: 'ip_karina' },
  elb:   { name: 'Алина',     city: 'Елабуга',    cityLocative: 'Елабуге',     legal_entity: 'ip_karina' },
  krd:   { name: 'Виктория',  city: 'Краснодар',  cityLocative: 'Краснодаре',  legal_entity: 'ooo_lab'   },
  srg:   { name: 'Мария',     city: 'Сургут',     cityLocative: 'Сургуте',     legal_entity: 'ooo_lab'   },
  prm:   { name: 'Анастасия', city: 'Пермь',      cityLocative: 'Перми',       legal_entity: 'ooo_lab'   }
};

function ageGroupSlug(age) {
  if (age <= 7) return 'mladshaya-5-7';
  if (age <= 11) return 'srednyaya-8-11';
  return 'starshaya-12-14';
}

function parseCity(slug) {
  const parts = (slug || '').split('_');
  return parts[1] || 'chln';
}

async function saveToD1(env, lead) {
  if (!env.DB) return null;
  const res = await env.DB.prepare(
    `INSERT INTO leads (partner_slug, session_id, child_name, child_age, parent_whatsapp, city, status, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, 'new', ?)`
  ).bind(
    lead.partner_slug,
    lead.session_id,
    lead.child_name,
    lead.child_age,
    lead.parent_whatsapp,
    lead.city,
    Math.floor(Date.now() / 1000)
  ).run();
  return res.meta.last_row_id;
}

async function sendToAlphaCRM(env, lead, tutorCity) {
  if (!env.ALPHACRM_API_KEY) return null;
  try {
    const r = await fetch(`https://${env.ALPHACRM_HOSTNAME || 'kiberonenabchln.s20.online'}/v2api/_/lead/`, {
      method: 'POST',
      headers: {
        'X-API-KEY': env.ALPHACRM_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: lead.child_name,
        phone: lead.parent_whatsapp,
        note: `Партнёрский лид от ${lead.partner_slug}. Возраст ${lead.child_age}. Юр.лицо: ${tutorCity.legal_entity}.`,
        custom_partner_slug: lead.partner_slug,
        custom_source: 'partner-qr',
        custom_age: lead.child_age,
        custom_legal_entity: tutorCity.legal_entity
      })
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data.id;
  } catch (e) {
    console.error('AlphaCRM error', e);
    return null;
  }
}

async function sendWhatsApp(env, lead, tutorCity) {
  if (!env.WAZZUP_API_KEY || !env.WAZZUP_CHANNEL_ID) return null;
  const text =
    `Здравствуйте! 👋 Это KIBERone — школа программирования в ${tutorCity.cityLocative}.\n\n` +
    `Готовим персональный план развития для ${lead.child_name}. Через минуту вернёмся со ссылкой на пробный урок.\n\n` +
    `Если что-то неудобно — напишите сюда, ответим лично.`;
  try {
    await fetch('https://api.wazzup24.com/v3/message', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.WAZZUP_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        channelId: env.WAZZUP_CHANNEL_ID,
        chatId: lead.parent_whatsapp + '@c.us',
        chatType: 'whatsapp',
        text
      })
    });
  } catch (e) {
    console.error('Wazzup error', e);
  }
}

function buildSlots() {
  // Простая логика: 4 ближайших слота (Сб 10, Сб 11:30, Вс 10, Вс 16)
  const now = new Date();
  const slots = [];
  const dayMs = 24 * 60 * 60 * 1000;
  for (let i = 0; i < 14 && slots.length < 6; i++) {
    const d = new Date(now.getTime() + i * dayMs);
    const dow = d.getDay();
    if (dow !== 6 && dow !== 0) continue;
    const times = dow === 6 ? ['10:00', '11:30'] : ['10:00', '16:00'];
    for (const t of times) {
      const [hh, mm] = t.split(':');
      const slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), parseInt(hh), parseInt(mm));
      slots.push({
        iso: slot.toISOString(),
        label: ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][slot.getDay()] + ', ' + slot.getDate() + ' ' + ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'][slot.getMonth()] + ' в ' + t
      });
      if (slots.length >= 6) break;
    }
  }
  return slots;
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const { partner_slug, session_id, child_name, child_age, parent_whatsapp } = body;

    if (!partner_slug || !child_name || !child_age || !parent_whatsapp) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    const cityKey = parseCity(partner_slug);
    const tutor = TUTOR_BY_CITY[cityKey] || TUTOR_BY_CITY.chln;
    const ageGroup = ageGroupSlug(child_age);

    const lead = {
      partner_slug, session_id, child_name,
      child_age: parseInt(child_age, 10),
      parent_whatsapp, city: tutor.city
    };

    const localId = await saveToD1(env, lead);
    const alphaId = await sendToAlphaCRM(env, lead, tutor);
    await sendWhatsApp(env, lead, tutor);

    // Возвращаем награду
    return new Response(JSON.stringify({
      ok: true,
      leadId: localId,
      alphaLeadId: alphaId,
      roadmapUrl: `/roadmaps/${ageGroup}.html`,
      videoUrl: `/videos/${cityKey}-${ageGroup}.mp4`,
      tutor: { name: tutor.name, city: tutor.cityLocative },
      slots: buildSlots()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
