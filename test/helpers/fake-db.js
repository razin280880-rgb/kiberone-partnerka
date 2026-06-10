// Программируемый стаб env.DB (Cloudflare D1).
// В каждом тесте регистрируем ровно те SQL-паттерны, которые ожидает handler.
// Что не зарегистрировано — возвращает «пусто» (first()→null, all()→{results:[]}, run()→{meta}).
//
// Использование:
//   const db = makeFakeDb();
//   db.on(sql => sql.includes('FROM partners'), {
//     first: (args) => ({ slug: args[0], name: 'X', status: 'active' })
//   });
//   const result = await db.prepare('SELECT * FROM partners WHERE slug = ?').bind('a').first();

export function makeFakeDb() {
  const handlers = [];
  const calls = [];

  const db = {
    prepare(sql) {
      let bound = [];
      const match = handlers.find(h => h.match(sql));
      return {
        bind(...args) {
          bound = args;
          calls.push({ sql, bound });
          return this;
        },
        async first() {
          calls.push({ sql, bound, op: 'first' });
          if (!match) return null;
          return match.first ? (await match.first(bound, sql)) ?? null : null;
        },
        async all() {
          calls.push({ sql, bound, op: 'all' });
          if (!match) return { results: [], success: true, meta: {} };
          const r = match.all ? (await match.all(bound, sql)) ?? [] : [];
          return { results: r, success: true, meta: {} };
        },
        async run() {
          calls.push({ sql, bound, op: 'run' });
          if (!match) return { meta: { last_row_id: 0, changes: 0 } };
          const r = match.run ? await match.run(bound, sql) : null;
          return { meta: r ?? { last_row_id: 1, changes: 1 } };
        }
      };
    },
    // Регистрирует обработчик. matcher — функция или подстрока.
    on(matcher, impl) {
      const match = typeof matcher === 'function'
        ? matcher
        : (sql) => sql.includes(matcher);
      handlers.push({ match, ...impl });
    },
    calls,
    // Удобство для тестов: посмотреть, был ли запрос с подстрокой.
    wasCalled(substring) {
      return calls.some(c => c.sql.includes(substring));
    }
  };

  return db;
}
