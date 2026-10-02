/* ==========================================================
   server.js — servidor do falso YouTube (Node 18+, SEM dependências)

   • Serve o site (pasta /public)
   • Guarda fotos e vídeos enviados em DATA_DIR/uploads
   • Guarda canais, vídeos, shorts e comentários em DATA_DIR/db.json
   • Suporta "Range" (necessário para avançar/voltar em vídeos)

   Variáveis de ambiente (todas opcionais):
     PORT            porta (o Render define sozinho)         padrão 3000
     DATA_DIR        onde guardar tudo                       padrão ./data
     ADMIN_PASSWORD  se definida, exige senha para escrever  padrão sem senha
     MAX_UPLOAD_MB   tamanho máximo por arquivo              padrão 300
   ========================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline, Transform } = require('stream');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_UPLOAD = (Number(process.env.MAX_UPLOAD_MB) || 300) * 1024 * 1024;
const MAX_RESTORE = 4 * 1024 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) console.warn('Aviso: pasta public não encontrada. Coloque index.html, api.js, script.js e styles.css dentro dela.');

/* ---------- tipos de arquivo ---------- */
const MIME = {
    html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'application/javascript; charset=utf-8',
    json: 'application/json; charset=utf-8', ico: 'image/x-icon', svg: 'image/svg+xml', txt: 'text/plain; charset=utf-8',
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp',
    mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', ogv: 'video/ogg', mkv: 'video/x-matroska'
};
// extensões aceitas no upload (SVG fica de fora de propósito: pode carregar scripts)
const UPLOAD_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv']);

/* ==========================================================
   BANCO DE DADOS (um arquivo JSON, simples e suficiente)
   ========================================================== */
let db = null;

function seedDb() {
    let seed = { categories: [], channels: [], videos: [], comments: [] };
    const seedFile = path.join(ROOT, 'seed.json');
    if (fs.existsSync(seedFile)) {
        try { seed = JSON.parse(fs.readFileSync(seedFile, 'utf8')); }
        catch (e) { console.warn('seed.json inválido; começando com banco vazio'); }
    }
    const now = Date.now();
    const DAY = 86400000;
    const at = (o) => { const c = { ...o, createdAt: now - (o.agoDays || 0) * DAY }; delete c.agoDays; return c; };
    return {
        version: 1,
        categories: seed.categories || [],
        channels: (seed.channels || []).map((c) => ({ ...c, createdAt: now })),
        videos: (seed.videos || []).map(at),
        comments: (seed.comments || []).map(at)
    };
}

function normalizeDb(d) {
    d = d && typeof d === 'object' ? d : {};
    for (const k of ['categories', 'channels', 'videos', 'comments']) if (!Array.isArray(d[k])) d[k] = [];
    d.version = 1;
    return d;
}

function loadDb() {
    try { db = normalizeDb(JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))); }
    catch (e) {
        if (fs.existsSync(DB_FILE)) {
            const bak = DB_FILE + '.corrompido-' + Date.now();
            fs.copyFileSync(DB_FILE, bak);
            console.warn('db.json ilegível; cópia guardada em', bak);
        }
        db = seedDb();
        saveDb();
        console.log(fs.existsSync(path.join(ROOT, 'seed.json')) ? 'Banco criado com os dados iniciais (seed.json).' : 'Banco criado vazio; crie canais e publicações pelo Studio.');
    }
}

function saveDb() {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);
}

/* ---------- utilidades ---------- */
const uid = (n = 5) => crypto.randomBytes(n).toString('hex');
const str = (v, max = 500) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);
const int = (v, d = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : d; };
const URL_RE = /^\/(uploads\/[A-Za-z0-9_-]+\.[a-z0-9]+|morgilio\.png)$/;
const urlOrNull = (v) => (typeof v === 'string' && URL_RE.test(v) ? v : null);
const slug = (t) => str(t, 40).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24);
const validTime = (v, fallback) => { const n = Number(v); return Number.isFinite(n) && n > 0 && n <= Date.now() + 60000 ? Math.round(n) : fallback; };

function send(res, code, obj, headers = {}) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': MIME.json, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...headers });
    res.end(body);
}
const fail = (res, code, msg) => send(res, code, { error: msg });

function readJson(req, limit = 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) { reject(Object.assign(new Error('Corpo da requisição grande demais'), { status: 413 })); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => {
            try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
            catch (e) { reject(Object.assign(new Error('JSON inválido'), { status: 400 })); }
        });
        req.on('error', reject);
    });
}

/* Apaga do disco os arquivos que não são mais usados por ninguém */
function removeUnusedFiles(urls) {
    const dump = JSON.stringify(db);
    for (const u of new Set(urls.filter(Boolean))) {
        if (!u.startsWith('/uploads/') || dump.includes(u)) continue;
        fs.unlink(path.join(DATA_DIR, u), () => { });
    }
}
function filesOfVideo(v) { return [v.media, v.thumb]; }
function filesOfChannel(c) { return [c.avatar, c.banner]; }

/* ==========================================================
   VALIDAÇÃO DOS CAMPOS
   ========================================================== */
function cleanChannel(b, old = {}) {
    const name = str(b.name, 60) || old.name || 'Novo canal';
    let handle = str(b.handle, 40) || old.handle || '@' + (slug(name) || 'canal');
    if (!handle.startsWith('@')) handle = '@' + handle;
    return {
        name, handle,
        subs: str(b.subs, 60) !== '' ? str(b.subs, 60) : (old.subs || '0 inscritos'),
        about: b.about !== undefined ? str(b.about, 1000) : (old.about || ''),
        avatar: b.avatar !== undefined ? urlOrNull(b.avatar) : (old.avatar || null),
        banner: b.banner !== undefined ? urlOrNull(b.banner) : (old.banner || null)
    };
}

function cleanVideo(b, old = {}) {
    const has = (k) => b[k] !== undefined;
    const type = has('type') ? (b.type === 'video' ? 'video' : 'image') : (old.type || 'image');
    const chOk = (id) => db.channels.some((c) => c.id === id);
    const ch = has('ch') && chOk(b.ch) ? b.ch : (old.ch && chOk(old.ch) ? old.ch : (db.channels[0] && db.channels[0].id) || '');
    const likes = has('likes') ? (b.likes === null || b.likes === '' ? null : int(b.likes, null)) : (old.likes === undefined ? null : old.likes);
    return {
        title: str(b.title, 120) || old.title || 'Sem título',
        desc: has('desc') ? str(b.desc, 5000) : (old.desc || ''),
        ch,
        cat: has('cat') ? str(b.cat, 40) : (old.cat || ''),
        type,
        media: has('media') ? urlOrNull(b.media) : (old.media || null),
        thumb: has('thumb') ? urlOrNull(b.thumb) : (old.thumb || null),
        duration: has('duration') ? int(b.duration, 0) : (old.duration || 0),
        views: has('views') ? int(b.views, 0) : (old.views || 0),
        likes,
        short: has('short') ? !!b.short : !!old.short,
        createdAt: has('createdAt') ? validTime(b.createdAt, old.createdAt || Date.now()) : (old.createdAt || Date.now())
    };
}

function cleanComment(b, old = {}) {
    const has = (k) => b[k] !== undefined;
    return {
        text: has('text') ? str(b.text, 3000) : old.text,
        likes: has('likes') ? int(b.likes, 0) : (old.likes || 0),
        name: has('name') ? (str(b.name, 40) || '@anonimo') : (old.name || '@anonimo'),
        avatar: has('avatar') ? urlOrNull(b.avatar) : (old.avatar || null)
    };
}

/* ==========================================================
   ROTAS DA API
   ========================================================== */
function isAuthorized(req, url) {
    if (!ADMIN_PASSWORD) return true;
    const key = req.headers['x-admin-key'] || url.searchParams.get('key') || '';
    const a = Buffer.from(String(key)), b = Buffer.from(ADMIN_PASSWORD);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function folderStats() {
    let files = 0, bytes = 0;
    for (const f of fs.readdirSync(UPLOAD_DIR)) {
        if (f.endsWith('.part')) continue;
        try { bytes += fs.statSync(path.join(UPLOAD_DIR, f)).size; files++; } catch (e) { /* ignora */ }
    }
    return { files, bytes };
}

async function api(req, res, url) {
    const method = req.method;
    const p = url.pathname.replace(/\/+$/, '');
    let m;

    if (method === 'GET' && p === '/api/state') {
        return send(res, 200, {
            categories: db.categories, channels: db.channels, videos: db.videos, comments: db.comments,
            authRequired: !!ADMIN_PASSWORD, maxUploadMB: Math.round(MAX_UPLOAD / 1048576)
        });
    }

    // contar visualização é público: quem só assiste nunca precisa da senha
    if (method === 'POST' && (m = /^\/api\/videos\/([\w-]+)\/view$/.exec(p))) {
        const v = db.videos.find((x) => x.id === m[1]);
        if (!v) return fail(res, 404, 'Vídeo não encontrado');
        v.views += 1;
        saveDb();
        return send(res, 200, { views: v.views });
    }

    // tudo abaixo escreve ou mexe em arquivos: exige senha, se houver
    if (!isAuthorized(req, url)) return fail(res, 401, 'Senha incorreta');

    if (method === 'GET' && p === '/api/stats') return send(res, 200, folderStats());
    if (method === 'PUT' && p === '/api/upload') return handleUpload(req, res, url);
    if (method === 'GET' && p === '/api/backup') return handleBackup(res);
    if (method === 'POST' && p === '/api/restore') return handleRestore(req, res);

    if (method === 'POST' && p === '/api/cleanup') {
        const dump = JSON.stringify(db);
        let removed = 0, bytes = 0;
        for (const f of fs.readdirSync(UPLOAD_DIR)) {
            const full = path.join(UPLOAD_DIR, f);
            const isPart = f.endsWith('.part');
            if (isPart ? Date.now() - fs.statSync(full).mtimeMs < 3600000 : dump.includes('/uploads/' + f)) continue;
            try { bytes += fs.statSync(full).size; fs.unlinkSync(full); removed++; } catch (e) { /* ignora */ }
        }
        return send(res, 200, { removed, bytes });
    }

    /* ----- categorias ----- */
    if (method === 'PUT' && p === '/api/categories') {
        const b = await readJson(req);
        const list = Array.isArray(b.list) ? b.list.map((c) => str(c, 40)).filter(Boolean) : [];
        db.categories = Array.from(new Set(list)).slice(0, 40);
        saveDb();
        return send(res, 200, { categories: db.categories });
    }

    /* ----- canais ----- */
    if (method === 'POST' && p === '/api/channels') {
        const b = await readJson(req);
        const base = slug(b.name) || 'canal';
        let id = base;
        while (db.channels.some((c) => c.id === id)) id = base + uid(2);
        const ch = { id, ...cleanChannel(b), createdAt: Date.now() };
        db.channels.push(ch);
        saveDb();
        return send(res, 201, ch);
    }
    if ((m = /^\/api\/channels\/([\w-]+)$/.exec(p))) {
        const ch = db.channels.find((c) => c.id === m[1]);
        if (!ch) return fail(res, 404, 'Canal não encontrado');
        if (method === 'PUT') {
            const b = await readJson(req);
            const before = filesOfChannel(ch);
            Object.assign(ch, cleanChannel(b, ch));
            saveDb();
            removeUnusedFiles(before);
            return send(res, 200, ch);
        }
        if (method === 'DELETE') {
            if (db.channels.length <= 1) return fail(res, 400, 'Não dá para apagar o único canal que existe.');
            const vids = db.videos.filter((v) => v.ch === ch.id);
            const ids = new Set(vids.map((v) => v.id));
            const files = [...filesOfChannel(ch), ...vids.flatMap(filesOfVideo)];
            db.videos = db.videos.filter((v) => v.ch !== ch.id);
            db.comments = db.comments.filter((c) => !ids.has(c.target));
            db.channels = db.channels.filter((c) => c.id !== ch.id);
            saveDb();
            removeUnusedFiles(files);
            return send(res, 200, { ok: true, removedVideos: [...ids] });
        }
    }

    /* ----- vídeos e shorts ----- */
    if (method === 'POST' && p === '/api/videos') {
        const b = await readJson(req);
        if (!db.channels.length) return fail(res, 400, 'Crie um canal antes de publicar.');
        const v = { id: (b.short ? 's' : 'v') + uid(4), ...cleanVideo(b) };
        if (v.cat && !db.categories.includes(v.cat)) db.categories.push(v.cat);
        db.videos.unshift(v);
        saveDb();
        return send(res, 201, v);
    }
    if ((m = /^\/api\/videos\/([\w-]+)$/.exec(p))) {
        const v = db.videos.find((x) => x.id === m[1]);
        if (!v) return fail(res, 404, 'Vídeo não encontrado');
        if (method === 'PUT') {
            const b = await readJson(req);
            const before = filesOfVideo(v);
            Object.assign(v, cleanVideo(b, v));
            if (v.cat && !db.categories.includes(v.cat)) db.categories.push(v.cat);
            saveDb();
            removeUnusedFiles(before);
            return send(res, 200, v);
        }
        if (method === 'DELETE') {
            db.videos = db.videos.filter((x) => x.id !== v.id);
            db.comments = db.comments.filter((c) => c.target !== v.id);
            saveDb();
            removeUnusedFiles(filesOfVideo(v));
            return send(res, 200, { ok: true });
        }
    }

    /* ----- comentários ----- */
    if (method === 'POST' && p === '/api/comments') {
        const b = await readJson(req);
        if (!db.videos.some((v) => v.id === b.target)) return fail(res, 404, 'Vídeo não encontrado');
        const parent = db.comments.find((c) => c.id === b.parent);
        const base = cleanComment(b);
        if (!base.text) return fail(res, 400, 'Comentário vazio');
        const c = {
            id: 'c' + uid(5), target: b.target, parent: parent ? (parent.parent || parent.id) : null,
            ...base, createdAt: validTime(b.createdAt, Date.now())
        };
        db.comments.push(c);
        saveDb();
        return send(res, 201, c);
    }
    if ((m = /^\/api\/comments\/([\w-]+)$/.exec(p))) {
        const c = db.comments.find((x) => x.id === m[1]);
        if (!c) return fail(res, 404, 'Comentário não encontrado');
        if (method === 'PUT') {
            const b = await readJson(req);
            const before = [c.avatar];
            Object.assign(c, cleanComment(b, c));
            if (!c.text) return fail(res, 400, 'Comentário vazio');
            saveDb();
            removeUnusedFiles(before);
            return send(res, 200, c);
        }
        if (method === 'DELETE') {
            const gone = db.comments.filter((x) => x.id === c.id || x.parent === c.id);
            const ids = new Set(gone.map((x) => x.id));
            db.comments = db.comments.filter((x) => !ids.has(x.id));
            saveDb();
            removeUnusedFiles(gone.map((x) => x.avatar));
            return send(res, 200, { ok: true, removed: [...ids] });
        }
    }

    return fail(res, 404, 'Rota não encontrada');
}

/* ==========================================================
   UPLOAD — o arquivo chega "cru" no corpo (PUT) e vai direto
   para o disco, então vídeos grandes não enchem a memória.
   ========================================================== */
function handleUpload(req, res, url) {
    const original = str(url.searchParams.get('name') || 'arquivo', 200);
    const ext = path.extname(original).slice(1).toLowerCase();
    if (!UPLOAD_EXT.has(ext)) return fail(res, 400, 'Formato não suportado: .' + (ext || '?') + ' (use JPG, PNG, WEBP, GIF, MP4, WEBM ou MOV)');

    const declared = Number(req.headers['content-length'] || 0);
    if (declared > MAX_UPLOAD) {
        res.setHeader('Connection', 'close');
        return fail(res, 413, 'Arquivo grande demais (máximo ' + Math.round(MAX_UPLOAD / 1048576) + ' MB)');
    }

    const name = uid(8) + '.' + ext;
    const finalPath = path.join(UPLOAD_DIR, name);
    const tmpPath = finalPath + '.part';
    let size = 0;
    const counter = new Transform({
        transform(chunk, enc, cb) {
            size += chunk.length;
            if (size > MAX_UPLOAD) return cb(Object.assign(new Error('Arquivo grande demais'), { status: 413 }));
            cb(null, chunk);
        }
    });

    pipeline(req, counter, fs.createWriteStream(tmpPath), (err) => {
        if (err) {
            fs.unlink(tmpPath, () => { });
            if (!res.headersSent && !res.destroyed) fail(res, err.status || 500, err.message || 'Falha no upload');
            return;
        }
        if (size === 0) { fs.unlink(tmpPath, () => { }); return fail(res, 400, 'Arquivo vazio'); }
        fs.rename(tmpPath, finalPath, (e) => {
            if (e) return fail(res, 500, 'Não foi possível salvar o arquivo');
            send(res, 201, { url: '/uploads/' + name, size });
        });
    });
}

/* ==========================================================
   BACKUP / RESTAURAR (arquivo .tar escrito à mão, sem libs)
   ========================================================== */
function tarHeader(name, size, mtime) {
    const b = Buffer.alloc(512);
    b.write(name, 0, 100, 'utf8');
    b.write('0000644\0', 100);
    b.write('0000000\0', 108);
    b.write('0000000\0', 116);
    b.write(size.toString(8).padStart(11, '0') + '\0', 124);
    b.write(Math.floor(mtime / 1000).toString(8).padStart(11, '0') + '\0', 136);
    b.write('        ', 148);
    b.write('0', 156);
    b.write('ustar\0', 257);
    b.write('00', 263);
    let sum = 0;
    for (const x of b) sum += x;
    b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    return b;
}

function writeChunk(res, chunk) {
    return new Promise((resolve, reject) => {
        if (res.destroyed) return reject(new Error('conexão fechada'));
        if (res.write(chunk)) return resolve();
        const onDrain = () => { res.off('close', onClose); resolve(); };
        const onClose = () => { res.off('drain', onDrain); reject(new Error('conexão fechada')); };
        res.once('drain', onDrain);
        res.once('close', onClose);
    });
}

async function handleBackup(res) {
    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
        'Content-Type': 'application/x-tar',
        'Content-Disposition': `attachment; filename="morgilio-backup-${stamp}.tar"`,
        'Cache-Control': 'no-store'
    });
    try {
        const add = async (name, file) => {
            const st = fs.statSync(file);
            await writeChunk(res, tarHeader(name, st.size, st.mtimeMs));
            for await (const chunk of fs.createReadStream(file)) await writeChunk(res, chunk);
            const pad = (512 - (st.size % 512)) % 512;
            if (pad) await writeChunk(res, Buffer.alloc(pad));
        };
        saveDb();
        await add('db.json', DB_FILE);
        for (const f of fs.readdirSync(UPLOAD_DIR)) {
            if (f.endsWith('.part')) continue;
            await add('uploads/' + f, path.join(UPLOAD_DIR, f));
        }
        await writeChunk(res, Buffer.alloc(1024));
        res.end();
    } catch (e) {
        res.destroy();
    }
}

function handleRestore(req, res) {
    const tmp = path.join(DATA_DIR, 'restore-' + uid(4) + '.tar');
    let size = 0;
    const counter = new Transform({
        transform(chunk, enc, cb) {
            size += chunk.length;
            if (size > MAX_RESTORE) return cb(Object.assign(new Error('Backup grande demais'), { status: 413 }));
            cb(null, chunk);
        }
    });
    pipeline(req, counter, fs.createWriteStream(tmp), (err) => {
        if (err) { fs.unlink(tmp, () => { }); if (!res.headersSent) fail(res, err.status || 500, err.message); return; }
        try {
            const result = extractTar(tmp);
            fs.unlinkSync(tmp);
            send(res, 200, result);
        } catch (e) {
            fs.unlink(tmp, () => { });
            fail(res, 400, 'Backup inválido: ' + e.message);
        }
    });
}

function extractTar(tarFile) {
    const stage = path.join(DATA_DIR, 'restore-stage-' + uid(4));
    fs.mkdirSync(path.join(stage, 'uploads'), { recursive: true });
    const fd = fs.openSync(tarFile, 'r');
    let pos = 0, files = 0, dbText = null;
    const total = fs.fstatSync(fd).size;
    try {
        const head = Buffer.alloc(512);
        while (pos + 512 <= total) {
            fs.readSync(fd, head, 0, 512, pos);
            pos += 512;
            if (head.every((x) => x === 0)) break;
            const name = head.toString('utf8', 0, 100).replace(/\0.*$/, '');
            const size = parseInt(head.toString('ascii', 124, 135).replace(/\0.*$/, '').trim() || '0', 8);
            const type = String.fromCharCode(head[156] || 48);
            if (!Number.isFinite(size) || size < 0 || pos + size > total) throw new Error('arquivo .tar truncado');
            const isFile = type === '0';
            const okName = name === 'db.json' || /^uploads\/[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(name);
            if (isFile && okName) {
                const dest = name === 'db.json' ? path.join(stage, 'db.json') : path.join(stage, name);
                const out = fs.openSync(dest, 'w');
                const buf = Buffer.alloc(1024 * 1024);
                let left = size, at = pos;
                while (left > 0) {
                    const n = fs.readSync(fd, buf, 0, Math.min(buf.length, left), at);
                    if (n <= 0) throw new Error('leitura falhou');
                    fs.writeSync(out, buf, 0, n);
                    left -= n; at += n;
                }
                fs.closeSync(out);
                if (name === 'db.json') dbText = fs.readFileSync(dest, 'utf8');
                else files++;
            }
            pos += Math.ceil(size / 512) * 512;
        }
    } finally { fs.closeSync(fd); }

    if (!dbText) throw new Error('db.json não encontrado dentro do arquivo');
    const parsed = normalizeDb(JSON.parse(dbText));
    for (const f of fs.readdirSync(path.join(stage, 'uploads'))) fs.renameSync(path.join(stage, 'uploads', f), path.join(UPLOAD_DIR, f));
    db = parsed;
    saveDb();
    fs.rmSync(stage, { recursive: true, force: true });
    return { ok: true, files, videos: db.videos.length, channels: db.channels.length };
}

/* ==========================================================
   ARQUIVOS ESTÁTICOS (com suporte a Range para vídeos)
   ========================================================== */
function serveFile(req, res, file, immutable) {
    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': MIME.txt }); return res.end('Não encontrado'); }
        const ext = path.extname(file).slice(1).toLowerCase();
        const headers = {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Accept-Ranges': 'bytes',
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
        };
        let start = 0, end = st.size - 1, status = 200;
        const range = req.headers.range;
        if (range) {
            const m = /^bytes=(\d*)-(\d*)$/.exec(range);
            if (m && (m[1] !== '' || m[2] !== '')) {
                if (m[1] === '') start = Math.max(0, st.size - parseInt(m[2], 10));
                else { start = parseInt(m[1], 10); if (m[2] !== '') end = Math.min(end, parseInt(m[2], 10)); }
                if (start > end || start >= st.size) {
                    res.writeHead(416, { 'Content-Range': 'bytes */' + st.size });
                    return res.end();
                }
                status = 206;
                headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
            }
        }
        headers['Content-Length'] = end - start + 1;
        res.writeHead(status, headers);
        if (req.method === 'HEAD' || st.size === 0) return res.end();
        const stream = fs.createReadStream(file, { start, end });
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        stream.pipe(res);
    });
}

function safeJoin(base, rel) {
    const full = path.normalize(path.join(base, rel));
    return full === base || full.startsWith(base + path.sep) ? full : null;
}

/* ==========================================================
   SERVIDOR
   ========================================================== */
const server = http.createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        let pathname;
        try { pathname = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }

        if (pathname.startsWith('/api/')) {
            try { return await api(req, res, url); }
            catch (e) {
                console.error(e);
                if (!res.headersSent) return fail(res, e.status || 500, e.status ? e.message : 'Erro interno do servidor');
                return res.destroy();
            }
        }

        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

        if (pathname.startsWith('/uploads/')) {
            const name = pathname.slice('/uploads/'.length);
            if (!/^[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(name)) { res.writeHead(404); return res.end(); }
            return serveFile(req, res, path.join(UPLOAD_DIR, name), true);
        }

        if (pathname === '/') pathname = '/index.html';
        const file = safeJoin(PUBLIC_DIR, pathname);
        if (!file) { res.writeHead(403); return res.end(); }
        return serveFile(req, res, file, false);
    } catch (e) {
        console.error(e);
        if (!res.headersSent) { res.writeHead(500); res.end('Erro'); } else res.destroy();
    }
});

server.requestTimeout = 0;        // uploads de vídeo podem demorar
server.headersTimeout = 65000;
server.keepAliveTimeout = 65000;

loadDb();
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor no ar: http://localhost:${PORT}`);
    console.log(`Dados em: ${DATA_DIR}`);
    console.log(ADMIN_PASSWORD ? 'Senha de administrador: ATIVA' : 'Senha de administrador: desativada (qualquer pessoa com o link pode enviar arquivos)');
});

process.on('uncaughtException', (e) => console.error('Erro não tratado:', e));
process.on('unhandledRejection', (e) => console.error('Promessa rejeitada:', e));