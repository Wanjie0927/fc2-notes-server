/**
 * 云端备注后端服务（零依赖 Node HTTP 服务）
 * ------------------------------------------------------------
 * 用途：让「预测转单2」四个事业部的备注框真正跨用户共享。
 * 前端 dashboard.html 通过 NotesStore（NOTES_API_BASE）读写本服务，
 * 数据持久化到 notes_db.json（键 => { value, updatedAt }）。
 *
 * 接口：
 *   GET  /api/notes?key=<事业部名>         -> { value, updatedAt }
 *   GET  /api/notes                        -> { <key>: {value,updatedAt}, ... } （全部，便于管理）
 *   PUT  /api/notes    body: {key, value}  -> { ok:true, updatedAt }
 *   GET  /health                             -> { ok:true }
 *
 * 运行： node notes_server.js            （默认端口 3100，可用 PORT 环境变量覆盖）
 * 部署： 本文件 + notes_db.json 一起放到任意可公网访问的 Node 环境。
 *
 * 安全说明：备注为业务文本，非敏感。CORS 默认允许任意来源（OPTIONS 预检已处理）。
 *          若需限制来源，修改 ALLOW_ORIGIN 常量即可。
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3100;
const DB_FILE = path.join(__dirname, 'notes_db.json');
// 允许的来源：'*' 表示任意（含 CloudStudio 静态站点）。生产可改为具体域名。
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';

// ---------- 持久化层 ----------
function loadDb() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    return {};
  }
}
function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
}
let db = loadDb();

// ---------- 工具 ----------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function sanitizeKey(k) {
  // 仅允许中文/字母/数字/空格/下划线/连字符，避免路径穿越
  return String(k || '').replace(/[^\w\u4e00-\u9fa5 \-]/g, '').slice(0, 120);
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': ALLOW_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // 健康检查
  if (p === '/health' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, ts: Date.now() });
  }

  // 备注接口
  if (p === '/api/notes') {
    if (req.method === 'GET') {
      const key = url.searchParams.get('key');
      if (key) {
        const k = sanitizeKey(key);
        const rec = db[k] || { value: '', updatedAt: null };
        return sendJson(res, 200, rec);
      }
      // 无 key：返回全部（管理用）
      return sendJson(res, 200, db);
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      try {
        const body = await readBody(req);
        const parsed = body ? JSON.parse(body) : {};
        const k = sanitizeKey(parsed.key);
        if (!k) return sendJson(res, 400, { ok: false, error: 'missing key' });
        const value = String(parsed.value == null ? '' : parsed.value).slice(0, 20000);
        const updatedAt = Date.now();
        db[k] = { value, updatedAt };
        saveDb(db);
        return sendJson(res, 200, { ok: true, updatedAt });
      } catch (e) {
        return sendJson(res, 400, { ok: false, error: 'bad json' });
      }
    }
    return sendJson(res, 405, { ok: false, error: 'method not allowed' });
  }

  // 兜底
  sendJson(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[notes_server] listening on http://0.0.0.0:${PORT}`);
  console.log(`[notes_server] db file: ${DB_FILE}`);
  console.log(`[notes_server] ALLOW_ORIGIN: ${ALLOW_ORIGIN}`);
});
