#!/usr/bin/env node
/**
 * Broccoli Park — локальный сервер: раздаёт сайт и отправляет заявки на бронь в Telegram-бот.
 *
 * Запуск:   node server.js        → http://localhost:8080
 * Настройки: файл .env рядом с этим файлом (см. .env.example)
 *   TELEGRAM_BOT_TOKEN=...   токен от @BotFather (обязательно)
 *   TELEGRAM_CHAT_ID=...     куда слать заявки; если пусто — сервер найдёт сам
 *                            (напишите боту /start или добавьте его в группу и напишите там сообщение)
 *   PORT=8080
 *
 * Без внешних зависимостей, Node.js 14+.
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, '.env');

/* ---------- .env ---------- */
function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}
function saveEnvValue(key, value) {
  let text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const re = new RegExp('^' + key + '=.*$', 'm');
  text = re.test(text) ? text.replace(re, key + '=' + value) : text.replace(/\n?$/, '\n') + key + '=' + value + '\n';
  fs.writeFileSync(ENV_PATH, text);
}
loadEnv();

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
let CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const PORT = +process.env.PORT || 8080;
const API_BASE = process.env.TELEGRAM_API_BASE || 'https://api.telegram.org'; // для тестов

/* ---------- Telegram API ---------- */
function tg(method, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload || {});
    const url = new URL(API_BASE + '/bot' + TOKEN + '/' + method);
    const lib = url.protocol === 'http:' ? http : https;
    const req = lib.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 10000
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          json.ok ? resolve(json.result) : reject(new Error(json.description || 'Telegram error'));
        } catch (e) { reject(new Error('Bad response from Telegram')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Telegram timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

/** Ищем chat_id среди последних сообщений боту (группы в приоритете). */
async function discoverChatId() {
  const updates = await tg('getUpdates', { limit: 100 });
  const chats = [];
  updates.forEach((u) => {
    const m = u.message || u.channel_post || u.my_chat_member || u.edited_message;
    if (m && m.chat) chats.push(m.chat);
  });
  if (!chats.length) return null;
  const group = chats.slice().reverse().find((c) => c.type === 'group' || c.type === 'supergroup');
  return group || chats[chats.length - 1];
}

async function ensureChatId() {
  if (CHAT_ID) return CHAT_ID;
  const chat = await discoverChatId();
  if (!chat) return null;
  CHAT_ID = String(chat.id);
  saveEnvValue('TELEGRAM_CHAT_ID', CHAT_ID);
  console.log('✓ Чат найден и сохранён в .env: ' + (chat.title || chat.first_name || '') + ' (' + CHAT_ID + ')');
  return CHAT_ID;
}

/* ---------- Заявка ---------- */
const ZONES = { zone1: '1 этаж · бистро', zone2: '2 этаж · ресторан', zone3: 'Терраса' };
const LANG_NAMES = { ru: 'русский', en: 'английский', uz: 'узбекский' };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function validate(d) {
  const errors = [];
  const today = new Date(); today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  if (!d || typeof d !== 'object') return ['body'];
  if (typeof d.name !== 'string' || d.name.trim().length < 2 || d.name.length > 60) errors.push('name');
  if (!/^\+998 \d{2} \d{3} \d{2} \d{2}$/.test(d.phone || '')) errors.push('phone');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '') || d.date < today.toISOString().slice(0, 10)) errors.push('date');
  if (!/^\d{2}:\d{2}$/.test(d.time || '') || d.time < '08:00' || d.time > '22:00') errors.push('time');
  const g = +d.guests; if (!(g >= 1 && g <= 50 && Math.floor(g) === g)) errors.push('guests');
  if (!ZONES[d.zone]) errors.push('zone');
  if (d.comment && String(d.comment).length > 500) errors.push('comment');
  return errors;
}

function buildMessage(d) {
  const dateStr = d.date.split('-').reverse().join('.');
  const lines = [
    '🥦 <b>Новая бронь — Broccoli Park</b>',
    '',
    '👤 <b>' + esc(d.name.trim()) + '</b>',
    '📞 ' + esc(d.phone),
    '📅 ' + dateStr + ', <b>' + esc(d.time) + '</b>',
    '👥 Гостей: <b>' + (+d.guests) + '</b>',
    '📍 ' + ZONES[d.zone]
  ];
  if (d.comment && d.comment.trim()) lines.push('💬 ' + esc(d.comment.trim()));
  lines.push('', '<i>Язык сайта: ' + (LANG_NAMES[d.lang] || 'русский') + '</i>');
  return lines.join('\n');
}

/* Ограничение частоты: не больше 5 заявок за 10 минут с одного IP */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter((t) => now - t < win);
  list.push(now); hits.set(ip, list);
  return list.length > 5;
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function handleBooking(req, res) {
  let raw = '';
  req.on('data', (c) => {
    raw += c;
    if (raw.length > 10000) { req.destroy(); }
  });
  req.on('end', async () => {
    let data;
    try { data = JSON.parse(raw); } catch (e) { return sendJson(res, 400, { ok: false, error: 'bad_json' }); }

    // Ловушка для спам-ботов: скрытое поле должно быть пустым
    if (data.website) return sendJson(res, 200, { ok: true });

    const ip = req.socket.remoteAddress || 'local';
    if (rateLimited(ip)) return sendJson(res, 429, { ok: false, error: 'rate_limit' });

    const errors = validate(data);
    if (errors.length) return sendJson(res, 422, { ok: false, error: 'validation', fields: errors });

    try {
      const chatId = await ensureChatId();
      if (!chatId) {
        console.warn('✗ Не знаю, куда отправлять: напишите боту /start и повторите.');
        return sendJson(res, 503, { ok: false, error: 'no_chat' });
      }
      await tg('sendMessage', { chat_id: chatId, text: buildMessage(data), parse_mode: 'HTML', disable_web_page_preview: true });
      console.log('✓ Заявка отправлена: ' + data.name + ', ' + data.date + ' ' + data.time);
      sendJson(res, 200, { ok: true });
    } catch (e) {
      console.error('✗ Ошибка отправки в Telegram:', e.message);
      sendJson(res, 502, { ok: false, error: 'telegram' });
    }
  });
}

/* ---------- Статика ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.md': 'text/plain; charset=utf-8'
};
const BLOCKED = new Set(['server.js', 'README.md']);

function serveStatic(req, res) {
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const rel = path.normalize(urlPath).replace(/^([/\\])+/, '');
  const file = path.join(ROOT, rel);
  // Не отдаём файлы вне папки сайта, скрытые файлы (.env!) и служебные
  if (!file.startsWith(ROOT + path.sep) || rel.split(/[/\\]/).some((p) => p.startsWith('.')) || BLOCKED.has(rel) || rel.startsWith('tools')) {
    res.writeHead(404); return res.end('Not found');
  }
  fs.stat(file, (err, st) => {
    // /broccoli_links → /broccoli_links/ (папка со своим index.html)
    if (!err && st.isDirectory()) { res.writeHead(301, { Location: urlPath + '/' }); return res.end(); }
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------- Сервер ---------- */
const server = http.createServer((req, res) => {
  if (req.url.split('?')[0] === '/api/booking') {
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
    return handleBooking(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res);
});

if (require.main === module) {
  if (!TOKEN) {
    console.error('✗ Нет TELEGRAM_BOT_TOKEN. Создайте файл .env по образцу .env.example.');
    process.exit(1);
  }
  server.listen(PORT, async () => {
    console.log('\nBroccoli Park → http://localhost:' + PORT + '\n');
    try {
      const me = await tg('getMe');
      console.log('✓ Бот подключён: @' + me.username);
      const id = await ensureChatId();
      if (id) console.log('✓ Заявки будут приходить в чат ' + id);
      else console.log('! Чат ещё не найден. Откройте @' + me.username + ' в Telegram и нажмите «Старт» —\n  сервер найдёт чат при первой заявке (или перезапустите сервер).');
    } catch (e) {
      console.error('✗ Telegram недоступен или неверный токен: ' + e.message);
    }
  });
}

module.exports = { server, buildMessage, validate };
