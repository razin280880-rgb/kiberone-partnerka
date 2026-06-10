// Заготовка для env Pages Functions.
import { makeFakeDb } from './fake-db.js';

export function makeEnv(overrides = {}) {
  return {
    DB: makeFakeDb(),
    TELEGRAM_BOT_TOKEN: 'TEST_TG_TOKEN',
    ALFACRM_API_KEY: '',
    ALFACRM_HOSTNAME: 'test.alfa.local',
    KRASNODAR_API_KEY: '',
    WAZZUP_API_KEY: '',
    WAZZUP_CHANNEL_ID: '',
    CRON_SECRET: 'CRON_TEST_SECRET',
    TELEGRAM_WEBHOOK_SECRET: 'WHK_TEST_SECRET',
    TURNSTILE_SITE_KEY: '',
    TURNSTILE_SECRET_KEY: '',
    ...overrides
  };
}
