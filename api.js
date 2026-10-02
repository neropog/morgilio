/* ==========================================================
   api.js — conversa com o servidor e prepara os arquivos.
   Fica em window.MG.api e window.MG.media (usado pelo script.js)
   ========================================================== */
(function () {
    'use strict';
    const MG = (window.MG = window.MG || {});
    const KEY = 'mg_admin_key';

    /* ---------- senha de administrador (só se o servidor pedir) ---------- */
    const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
    const setKey = (k) => { try { localStorage.setItem(KEY, k); } catch (e) { /* ignora */ } };
    function askKey(wrong) {
        const k = prompt(wrong ? 'Senha incorreta. Digite de novo a senha de administrador:' : 'Digite a senha de administrador para continuar:');
        if (k === null || k === '') return null;
        setKey(k);
        return k;
    }

    /* ---------- requisições JSON ---------- */
    async function request(method, url, body, tried) {
        const headers = {};
        const key = getKey();
        if (key) headers['x-admin-key'] = key;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        let res;
        try {
            res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
        } catch (e) {
            throw new Error('Sem conexão com o servidor.');
        }
        if (res.status === 401 && !tried) {
            if (askKey(!!key)) return request(method, url, body, true);
            throw new Error('Senha não informada.');
        }
        let data = null;
        try { data = await res.json(); } catch (e) { /* sem corpo */ }
        if (!res.ok) throw new Error((data && data.error) || 'Erro ' + res.status);
        return data;
    }

    /* ---------- upload (PUT cru, com barra de progresso) ---------- */
    function upload(fileOrBlob, name, onProgress, tried) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', '/api/upload?name=' + encodeURIComponent(name || fileOrBlob.name || 'arquivo'));
            const key = getKey();
            if (key) xhr.setRequestHeader('x-admin-key', key);
            if (fileOrBlob.type) xhr.setRequestHeader('Content-Type', fileOrBlob.type);
            xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
            xhr.onerror = () => reject(new Error('A conexão caiu durante o envio.'));
            xhr.onabort = () => reject(new Error('Envio cancelado.'));
            xhr.onload = () => {
                let data = null;
                try { data = JSON.parse(xhr.responseText); } catch (e) { /* ignora */ }
                if (xhr.status === 401 && !tried) {
                    if (askKey(!!key)) return resolve(upload(fileOrBlob, name, onProgress, true));
                    return reject(new Error('Senha não informada.'));
                }
                if (xhr.status >= 200 && xhr.status < 300 && data && data.url) return resolve(data.url);
                reject(new Error((data && data.error) || 'Falha no envio (erro ' + xhr.status + ').'));
            };
            xhr.send(fileOrBlob);
        });
    }

    MG.api = {
        state: () => request('GET', '/api/state'),
        stats: () => request('GET', '/api/stats'),
        upload,
        createChannel: (b) => request('POST', '/api/channels', b),
        updateChannel: (id, b) => request('PUT', '/api/channels/' + id, b),
        deleteChannel: (id) => request('DELETE', '/api/channels/' + id),
        createVideo: (b) => request('POST', '/api/videos', b),
        updateVideo: (id, b) => request('PUT', '/api/videos/' + id, b),
        deleteVideo: (id) => request('DELETE', '/api/videos/' + id),
        view: (id) => request('POST', '/api/videos/' + id + '/view'),
        createComment: (b) => request('POST', '/api/comments', b),
        updateComment: (id, b) => request('PUT', '/api/comments/' + id, b),
        deleteComment: (id) => request('DELETE', '/api/comments/' + id),
        setCategories: (list) => request('PUT', '/api/categories', { list }),
        cleanup: () => request('POST', '/api/cleanup'),
        backupUrl: () => '/api/backup' + (getKey() ? '?key=' + encodeURIComponent(getKey()) : ''),
        async restore(file, onProgress, tried) {
            return new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open('POST', '/api/restore');
                const key = getKey();
                if (key) xhr.setRequestHeader('x-admin-key', key);
                xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
                xhr.onerror = () => reject(new Error('A conexão caiu durante a restauração.'));
                xhr.onload = () => {
                    let data = null;
                    try { data = JSON.parse(xhr.responseText); } catch (e) { /* ignora */ }
                    if (xhr.status === 401 && !tried) {
                        if (askKey(!!key)) return resolve(MG.api.restore(file, onProgress, true));
                        return reject(new Error('Senha não informada.'));
                    }
                    if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
                    reject(new Error((data && data.error) || 'Erro ' + xhr.status));
                };
                xhr.send(file);
            });
        }
    };

    /* ==========================================================
       PREPARO DE MÍDIA (tudo no navegador, antes de enviar)
       ========================================================== */
    const VIDEO_EXT = ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv'];
    const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp'];
    const extOf = (name) => (String(name).split('.').pop() || '').toLowerCase();

    // decide pela extensão, porque é ela que o servidor confere
    function kindOf(file) {
        const e = extOf(file.name);
        if (VIDEO_EXT.includes(e)) return 'video';
        if (IMAGE_EXT.includes(e)) return 'image';
        return null;
    }

    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => { img._url = url; resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('imagem ilegível')); };
            img.src = url;
        });
    }

    function toBlob(canvas, type, quality) {
        return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
    }

    // desenha "source" num canvas com largura máxima e devolve um Blob
    async function render(source, sw, sh, maxW, type, quality) {
        const scale = Math.min(1, maxW / sw);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(sw * scale));
        c.height = Math.max(1, Math.round(sh * scale));
        const ctx = c.getContext('2d');
        if (type === 'image/jpeg') { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height); }
        ctx.drawImage(source, 0, 0, c.width, c.height);
        return toBlob(c, type, quality);
    }

    // miniatura (640px, JPEG) a partir de uma foto
    async function imageThumb(file) {
        const img = await loadImage(file);
        try { return await render(img, img.naturalWidth, img.naturalHeight, 640, 'image/jpeg', 0.82); }
        finally { URL.revokeObjectURL(img._url); }
    }

    // reduz fotos grandes (máx. 1920px) — GIFs ficam como estão para não perder a animação
    async function optimizeImage(file) {
        if (extOf(file.name) === 'gif' || file.type === 'image/gif') return { blob: file, name: file.name };
        try {
            const img = await loadImage(file);
            const big = Math.max(img.naturalWidth, img.naturalHeight) > 1920;
            if (!big && file.size < 1.2 * 1024 * 1024) { URL.revokeObjectURL(img._url); return { blob: file, name: file.name }; }
            let blob = await render(img, img.naturalWidth, img.naturalHeight, 1920, 'image/webp', 0.88);
            URL.revokeObjectURL(img._url);
            let ext = 'webp';
            if (!blob || blob.type !== 'image/webp') { // navegador sem suporte a WebP no canvas
                const img2 = await loadImage(file);
                blob = await render(img2, img2.naturalWidth, img2.naturalHeight, 1920, 'image/jpeg', 0.88);
                URL.revokeObjectURL(img2._url);
                ext = 'jpg';
            }
            if (blob && blob.size < file.size) return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.' + ext };
        } catch (e) { /* mantém o original */ }
        return { blob: file, name: file.name };
    }

    // lê duração e captura um quadro de um vídeo para servir de miniatura
    function videoInfo(file) {
        return new Promise((resolve) => {
            const url = URL.createObjectURL(file);
            const v = document.createElement('video');
            v.muted = true; v.playsInline = true; v.preload = 'auto';
            let done = false;
            const finish = (r) => { if (done) return; done = true; clearTimeout(timer); URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); resolve(r); };
            const timer = setTimeout(() => finish({ ok: false, duration: 0, thumb: null }), 15000);
            v.onerror = () => finish({ ok: false, duration: 0, thumb: null });
            v.onloadedmetadata = () => {
                const d = isFinite(v.duration) ? v.duration : 0;
                v._d = d;
                v.currentTime = d > 2 ? Math.min(d * 0.1, 3) : 0.01;
            };
            v.onseeked = async () => {
                try {
                    const thumb = await render(v, v.videoWidth || 640, v.videoHeight || 360, 640, 'image/jpeg', 0.82);
                    finish({ ok: true, duration: Math.round(v._d || 0), thumb, width: v.videoWidth, height: v.videoHeight });
                } catch (e) { finish({ ok: false, duration: Math.round(v._d || 0), thumb: null }); }
            };
            v.src = url;
        });
    }

    MG.media = { kindOf, extOf, imageThumb, optimizeImage, videoInfo, loadImage };
})();