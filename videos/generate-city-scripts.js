// Node.js скрипт для генерации 21 финального видео-сценария из 3 шаблонов + city-references
// Использование: node videos/generate-city-scripts.js
//
// На входе: template-mladshaya-5-7.md, template-srednyaya-8-11.md, template-starshaya-12-14.md, city-references.md
// На выходе: 21 файл вида chln-mladshaya-5-7.md, chln-srednyaya-8-11.md, ...
//
// Преимущество подхода: при обновлении эталона запускаем скрипт — 21 файл синхронно обновляется.
// Без скрипта — поддержка 21 копии руками невозможна.

const fs = require('fs');
const path = require('path');

const CITIES = {
  chln:  { name: 'Челны', tutor: 'Анна', refs: {
    mladshaya: 'прямо как Тулпар-Аро, твой любимый герой',
    srednyaya: 'как ребята из IT-парка КАМАЗ — они тоже начинали с такого же',
    starshaya: 'в Иннополисе через 30 минут от нас уже работают AI-разработчики, и они выпускники таких школ'
  }},
  nkmsk: { name: 'Нижнекамск', tutor: 'Елена', refs: {
    mladshaya: 'как маленькие изобретатели на Нефтехимиков',
    srednyaya: 'следующая олимпиада по программированию в Татарстане — почему бы тебе не выиграть?',
    starshaya: 'нефтехимия + ИИ = твоё будущее, и оно начинается здесь'
  }},
  kzn: { name: 'Казань', tutor: 'Дилюза', refs: {
    mladshaya: 'как герои в IT-парке Татарстана',
    srednyaya: 'ребята из нашей школы уже выступали на хакатоне в IT-парке',
    starshaya: 'Иннополис, Гран-при школы — реальные ступени, через которые проходят наши выпускники'
  }},
  elb: { name: 'Елабуга', tutor: 'Алина', refs: {
    mladshaya: 'в городе Шишкина, а ты будешь кодером — звучит круто, правда?',
    srednyaya: 'здесь, в Елабуге, можно начать программировать как ребята из больших городов',
    starshaya: 'Алабуга-Политех, ОЭЗ — будущие работодатели уже ищут таких как ты'
  }},
  krd: { name: 'Краснодар', tutor: 'Виктория', refs: {
    mladshaya: 'как маленькие чемпионы на стадионе Краснодар',
    srednyaya: 'в Парке Галицкого — твой первый проект может стать частью города',
    starshaya: 'Krasava IT, IT-кластер Краснодара — путь до них начинается здесь'
  }},
  srg: { name: 'Сургут', tutor: 'Мария', refs: {
    mladshaya: 'как герои севера, только с ноутбуком вместо рации',
    srednyaya: 'Сургутнефтегаз уже использует ИИ, и людей таких они ищут заранее',
    starshaya: 'Сургутский технопарк ждёт твои проекты — серьёзно, реально ждёт'
  }},
  prm: { name: 'Пермь', tutor: 'Анастасия', refs: {
    mladshaya: 'как маленькие исследователи Кунгурской пещеры, только в цифре',
    srednyaya: 'PROK, Пермский фестиваль робототехники — ты там можешь выступить уже в этом году',
    starshaya: 'Промсвязьбанк, Mindbox, ИТ-парк Морион — местные IT-компании ищут именно таких ребят'
  }}
};

const AGE_GROUPS = [
  { slug: 'mladshaya-5-7', refKey: 'mladshaya', template: 'template-mladshaya-5-7.md' },
  { slug: 'srednyaya-8-11', refKey: 'srednyaya', template: 'template-srednyaya-8-11.md' },
  { slug: 'starshaya-12-14', refKey: 'starshaya', template: 'template-starshaya-12-14.md' }
];

const videosDir = __dirname;

function generate() {
  for (const [citySlug, city] of Object.entries(CITIES)) {
    for (const age of AGE_GROUPS) {
      const templatePath = path.join(videosDir, age.template);
      const template = fs.readFileSync(templatePath, 'utf-8');

      const filled = template
        .replace(/\[ИМЯ_ТЬЮТОРА\]/g, `**${city.tutor}**`)
        .replace(/\[ГОРОД\]/g, `**${city.name}**`)
        .replace(/\[ГОРОДСКОЙ_РЕФЕРЕНС, см\. таблицу\]/g, city.refs[age.refKey]);

      const outName = `${citySlug}-${age.slug}.md`;
      const outPath = path.join(videosDir, outName);

      const header = [
        `# Видео-приветствие: ${city.name} × ${age.slug}`,
        '',
        `**Тьютор:** ${city.tutor}`,
        `**Город:** ${city.name}`,
        `**Возрастная группа:** ${age.slug}`,
        '',
        `> ⚠️ Этот файл сгенерирован из \`${age.template}\` и \`city-references.md\`.`,
        '> Чтобы изменить — правьте шаблон или city-references, потом запустите `node generate-city-scripts.js`.',
        '',
        '---',
        '',
        ''
      ].join('\n');

      fs.writeFileSync(outPath, header + filled, 'utf-8');
      console.log('✓', outName);
    }
  }
  console.log('Done — 21 file regenerated');
}

generate();
