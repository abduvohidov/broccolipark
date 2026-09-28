#!/usr/bin/env node
/**
 * Собирает i18n/bundle.js из i18n/*.json.
 * Нужен только для открытия сайта двойным кликом (file://), где браузер не даёт fetch() читать JSON.
 * Запуск после правки словарей:  node tools/build-i18n.js
 */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'i18n');
const langs = fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
const bundle = {};
langs.forEach(l => { bundle[l] = JSON.parse(fs.readFileSync(path.join(dir, l + '.json'), 'utf8')); });
fs.writeFileSync(path.join(dir, 'bundle.js'),
  '/* Автоматически собрано из i18n/*.json — не редактируйте вручную. См. tools/build-i18n.js */\n' +
  'window.I18N_BUNDLE = ' + JSON.stringify(bundle) + ';\n');
console.log('i18n/bundle.js: ' + langs.join(', '));
