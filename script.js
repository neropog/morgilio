/* ==========================================================
   script.js — navegação (rotas por #), páginas e interações.
   Páginas: #/ (início) · #/shorts[/ID] · #/subscriptions · #/history
            #/watchlater · #/liked · #/watch/ID · #/results/TEXTO
            #/channel/ID · #/trending · #/explore/CATEGORIA · #/studio

   Os dados (canais, vídeos, comentários) vêm do servidor.
   Histórico, curtidas e inscrições ficam só no seu navegador.
   ========================================================== */
(function () {
    'use strict';

    const { api, media } = window.MG;
    const FALLBACK = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgwIiBoZWlnaHQ9IjcyMCIgdmlld0JveD0iMCAwIDEyODAgNzIwIj4KPHJlY3Qgd2lkdGg9IjEyODAiIGhlaWdodD0iNzIwIiBmaWxsPSIjMjcyNzI3Ii8+CjxjaXJjbGUgY3g9IjY0MCIgY3k9IjI5MiIgcj0iMTE4IiBmaWxsPSIjNjA2MDYwIi8+CjxwYXRoIGQ9Ik0zOTUgNjUwYzI1LTE0NSAxMjEtMjE4IDI0NS0yMThzMjIwIDczIDI0NSAyMTgiIGZpbGw9IiM2MDYwNjAiLz4KPHRleHQgeD0iNjQwIiB5PSI2OTAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiNhYWEiIGZvbnQtZmFtaWx5PSJBcmlhbCxzYW5zLXNlcmlmIiBmb250LXNpemU9IjM0Ij5hZGljaW9uZSBzdWEgZm90byBubyBTdHVkaW88L3RleHQ+Cjwvc3ZnPg==';

    /* ---------- dados vindos do servidor ---------- */
    const db = { channels: [], videos: [], comments: [], categories: [] };
    let serverInfo = { authRequired: false, maxUploadMB: 300 };

    /* ---------- utilidades ---------- */
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const body = document.body;
    const app = $('#app');

    const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const norm = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    const store = {
        get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null || v === undefined ? d : v; } catch (e) { return d; } },
        set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } }
    };

    const state = {
        mini: store.get('mg_mini', false),
        theme: store.get('mg_theme', 'dark'),
        history: store.get('mg_history', []),
        later: store.get('mg_later', []),
        liked: store.get('mg_liked', []),
        disliked: store.get('mg_disliked', []),
        subs: store.get('mg_subs', null),
        clikes: store.get('mg_clikes', []),
        searches: store.get('mg_searches', []),
        me: store.get('mg_me', '@voce'),
        as: store.get('mg_as', 'me'),
        seen: store.get('mg_seen', 0),
        vol: store.get('mg_vol', { v: 1, m: false }),
        shortsMuted: true,
        homeCat: 'Tudo'
    };
    const save = (k) => store.set('mg_' + k, state[k]);

    /* ---------- acesso aos dados ---------- */
    const longVideos = () => db.videos.filter((v) => !v.short);
    const shortVideos = () => db.videos.filter((v) => v.short);
    const byId = (id) => db.videos.find((v) => v.id === id);
    const chan = (id) => db.channels.find((c) => c.id === id) || db.channels[0] || { id: '', name: 'Canal', handle: '@canal', subs: '', about: '', avatar: null, banner: null };
    const thumbSrc = (v) => v.thumb || (v.type === 'image' && v.media) || FALLBACK;
    const imgErr = `onerror="this.onerror=null;this.src='${FALLBACK}'"`;
    const hasChannels = () => db.channels.length > 0;

    /* ---------- formatação ---------- */
    function fmtViews(n) {
        if (n === 1) return '1 visualização';
        if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',').replace(',0', '') + ' mi de visualizações';
        if (n >= 1e3) return Math.round(n / 1e3) + ' mil visualizações';
        return n + ' visualizações';
    }
    function fmtCount(n) {
        if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',').replace(',0', '') + ' mi';
        if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.', ',').replace(',0', '') + ' mil';
        return String(n);
    }
    function fmtTime(s) {
        s = Math.max(0, Math.floor(s || 0));
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
        const ss = String(sec).padStart(2, '0');
        return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
    }
    function fmtBytes(n) {
        if (n >= 1073741824) return (n / 1073741824).toFixed(2).replace('.', ',') + ' GB';
        if (n >= 1048576) return (n / 1048576).toFixed(1).replace('.', ',') + ' MB';
        return Math.max(1, Math.round(n / 1024)) + ' KB';
    }
    function rel(ts) {
        const s = Math.max(0, (Date.now() - ts) / 1000);
        const units = [[31536000, 'ano', 'anos'], [2592000, 'mês', 'meses'], [604800, 'semana', 'semanas'], [86400, 'dia', 'dias'], [3600, 'hora', 'horas'], [60, 'minuto', 'minutos']];
        for (const [sec, one, many] of units) {
            if (s >= sec) { const n = Math.floor(s / sec); return `há ${n} ${n === 1 ? one : many}`; }
        }
        return 'agora mesmo';
    }
    const age = (v) => { const r = rel(v.createdAt); return (v.cat === 'Ao vivo' && r !== 'agora mesmo' ? 'Transmitido ' : '') + r; };

    // aceita "1500000", "1,2 mi", "340 mil", "2 milhões"… (vazio = null, inválido = NaN)
    function parseCount(t) {
        t = String(t == null ? '' : t).toLowerCase().trim();
        if (!t) return null;
        const m = /^([\d.,]+)\s*(mil|k|mi|milh[ãa]o|milh[õo]es|m)?/.exec(t);
        if (!m) return NaN;
        const n = m[2] ? parseFloat(m[1].replace(',', '.')) : parseFloat(m[1].replace(/[.,]/g, ''));
        const mult = { mil: 1e3, k: 1e3, mi: 1e6, m: 1e6, 'milhão': 1e6, milhao: 1e6, 'milhões': 1e6, milhoes: 1e6 }[m[2]] || 1;
        return Number.isFinite(n) ? Math.round(n * mult) : NaN;
    }
    // "3:21" ou "1:02:03" ou "201" (segundos)
    function parseDuration(t) {
        t = String(t || '').trim();
        if (!t) return null;
        if (!/^\d+(:\d{1,2}){0,2}$/.test(t)) return NaN;
        return t.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
    }

    const AGE_UNITS = [['minutos', 60], ['horas', 3600], ['dias', 86400], ['semanas', 604800], ['meses', 2592000], ['anos', 31536000]];
    function ageFieldsHTML(id, ts) {
        let n = '', u = 'dias';
        if (ts) {
            const s = (Date.now() - ts) / 1000;
            n = 0; u = 'minutos';
            for (let i = AGE_UNITS.length - 1; i >= 0; i--) if (s >= AGE_UNITS[i][1]) { n = Math.floor(s / AGE_UNITS[i][1]); u = AGE_UNITS[i][0]; break; }
        }
        return `<div class="age-row"><input type="number" min="0" id="${id}N" value="${n}" placeholder="0">
            <select id="${id}U">${AGE_UNITS.map(([k]) => `<option ${k === u ? 'selected' : ''}>${k}</option>`).join('')}</select><span class="age-hint">atrás</span></div>`;
    }
    function bindAge(id) {
        ['N', 'U'].forEach((s) => { const el = $('#' + id + s); if (el) ['input', 'change'].forEach((ev) => el.addEventListener(ev, () => { el.dataset.d = '1'; })); });
    }
    // devolve o timestamp escolhido ou undefined (= não mexer)
    function readAge(id, onlyIfChanged) {
        const nEl = $('#' + id + 'N'), uEl = $('#' + id + 'U');
        if (!nEl) return undefined;
        const n = parseFloat(nEl.value);
        if (!isFinite(n) || n < 0) return undefined;
        if (onlyIfChanged && !(nEl.dataset.d || uEl.dataset.d)) return undefined;
        if (!onlyIfChanged && n === 0) return undefined;
        const unit = (AGE_UNITS.find((x) => x[0] === uEl.value) || AGE_UNITS[2])[1];
        return Math.round(Date.now() - n * unit * 1000);
    }

    function toast(msg) {
        const t = document.createElement('div');
        t.className = 'toast';
        t.textContent = msg;
        $('#toasts').appendChild(t);
        requestAnimationFrame(() => t.classList.add('show'));
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
    }

    function copyLink(v) {
        const url = location.origin + location.pathname + (v.short ? '#/shorts/' : '#/watch/') + v.id;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(() => toast('Link copiado para a área de transferência'), () => toast('Link: ' + url));
        } else {
            toast('Link: ' + url);
        }
    }

    function toggleIn(list, id) {
        const i = list.indexOf(id);
        if (i >= 0) { list.splice(i, 1); return false; }
        list.unshift(id);
        return true;
    }
    // muda de página; se já está nela, apenas redesenha
    const go = (hash) => { if (location.hash === hash) router(); else location.hash = hash; };
    const openVideo = (id) => { const v = byId(id); location.hash = (v && v.short ? '#/shorts/' : '#/watch/') + id; };
    const initial = (t) => (String(t).replace(/[^\p{L}\p{N}]/gu, '')[0] || '?').toUpperCase();
    const hue = (t) => { let h = 0; for (const c of String(t)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };

    /* ---------- templates ---------- */
    const avatarSrc = (c) => (c && c.avatar) || FALLBACK;
    const avatar = (c, cls = '') => `<img class="avatar ${cls}" src="${avatarSrc(c)}" ${imgErr} alt="" loading="lazy">`;
    // avatar de comentário: foto se tiver; senão bolinha colorida com a inicial
    const personAvatar = (src, name, cls = '') => src
        ? `<img class="avatar ${cls}" src="${src}" ${imgErr} alt="" loading="lazy">`
        : `<span class="avatar ph ${cls}" style="background:hsl(${hue(name)} 45% 42%)">${esc(initial(name))}</span>`;
    const meta = (v) => `${fmtViews(v.views)} • ${age(v)}`;
    const thumb = (v) => `<div class="thumb-wrap"><img class="thumbnail" src="${thumbSrc(v)}" ${imgErr} alt="Miniatura: ${esc(v.title)}" loading="lazy">${v.short ? '<span class="duration">SHORTS</span>' : (v.duration ? `<span class="duration">${fmtTime(v.duration)}</span>` : '')}<span class="preview-bar"></span></div>`;
    const kebab = (id) => `<button class="kebab" data-kebab="${id}" aria-label="Mais ações"><i class="fas fa-ellipsis-vertical"></i></button>`;

    function card(v) {
        const c = chan(v.ch);
        return `<article class="video-card" data-id="${v.id}" tabindex="0">
            ${thumb(v)}
            <div class="video-info">
                <a href="#/channel/${c.id}" class="avatar-link" aria-label="${esc(c.name)}">${avatar(c)}</a>
                <div class="video-text">
                    <h3 class="video-title">${esc(v.title)}</h3>
                    <a class="channel-name" href="#/channel/${c.id}">${esc(c.name)}</a>
                    <p class="meta">${meta(v)}</p>
                </div>
                ${kebab(v.id)}
            </div>
        </article>`;
    }
    function hcard(v, rank) {
        const c = chan(v.ch);
        return `<article class="video-card hcard" data-id="${v.id}" tabindex="0">
            ${rank ? `<span class="rank">${rank}</span>` : ''}
            ${thumb(v)}
            <div class="hc-body">
                <h3 class="video-title">${esc(v.title)}</h3>
                <p class="meta">${meta(v)}</p>
                <a class="hc-channel channel-name" href="#/channel/${c.id}">${avatar(c)}<span>${esc(c.name)}</span></a>
                <p class="hc-desc">${esc(v.desc || '')}</p>
                ${kebab(v.id)}
            </div>
        </article>`;
    }
    function ccard(v) {
        const c = chan(v.ch);
        return `<article class="video-card ccard" data-id="${v.id}" tabindex="0">
            ${thumb(v)}
            <div class="cc-body">
                <h3 class="video-title">${esc(v.title)}</h3>
                <a class="channel-name" href="#/channel/${c.id}">${esc(c.name)}</a>
                <p class="meta">${meta(v)}</p>
                ${kebab(v.id)}
            </div>
        </article>`;
    }
    const skeleton = (n = 12) => `<div class="video-grid">${Array.from({ length: n }, () => `
        <div class="sk-card"><div class="sk sk-thumb"></div><div class="sk-row"><div class="sk sk-av"></div>
        <div class="sk-lines"><div class="sk sk-line"></div><div class="sk sk-line short"></div></div></div></div>`).join('')}</div>`;
    const empty = (icon, title, text, btn = '') => `<div class="empty"><i class="${icon}"></i><h2>${title}</h2><p>${text}</p>${btn}</div>`;
    const homeBtn = '<a class="pill primary" href="#/">Ir para o início</a>';
    const uploadBtn = '<button class="pill primary" data-open="upload"><i class="fas fa-upload"></i>Enviar vídeo ou foto</button>';

    /* ---------- layout (menu lateral) ---------- */
    let route = { name: 'home', arg: '' };
    const drawerMode = () => window.innerWidth <= 1000 || route.name === 'watch';

    function applyLayout() {
        const d = drawerMode();
        body.classList.toggle('drawer-mode', d);
        body.classList.toggle('mini', !d && state.mini);
        if (!d) body.classList.remove('drawer-open');
    }
    $('#menuBtn').addEventListener('click', () => {
        if (drawerMode()) body.classList.toggle('drawer-open');
        else { state.mini = !state.mini; save('mini'); applyLayout(); }
    });
    $('#drawerClose').addEventListener('click', () => body.classList.remove('drawer-open'));
    $('#backdrop').addEventListener('click', () => body.classList.remove('drawer-open'));
    $('#sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) body.classList.remove('drawer-open'); });
    window.addEventListener('resize', applyLayout);

    const CAT_ICONS = { 'Música': 'fa-music', 'Jogos': 'fa-gamepad', 'Ao vivo': 'fa-tower-broadcast', 'Culinária': 'fa-utensils', 'Comédia': 'fa-face-grin-tears', 'Mixes': 'fa-compact-disc' };
    function renderSide() {
        $('#sideChannels').innerHTML = db.channels.map((c) =>
            `<a class="nav-item" data-key="channel/${c.id}" href="#/channel/${c.id}">${avatar(c)}<span>${esc(c.name)}</span></a>`).join('');
        $('#sideCats').innerHTML = db.categories.map((c) =>
            `<a class="nav-item" data-key="explore/${esc(c)}" href="#/explore/${encodeURIComponent(c)}"><i class="fas ${CAT_ICONS[c] || 'fa-tag'}"></i><span>${esc(c)}</span></a>`).join('');
        setActiveNav();
    }
    function setActiveNav() {
        let key = route.name;
        if (route.name === 'home') key = '';
        else if (route.name === 'explore') key = 'explore/' + route.arg;
        else if (route.name === 'channel') key = 'channel/' + route.arg;
        $$('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.key === key));
    }

    /* ---------- tema e perfil ---------- */
    function applyTheme() {
        document.documentElement.dataset.theme = state.theme;
        $('#themeLabel').textContent = 'Aparência: tema ' + (state.theme === 'dark' ? 'escuro' : 'claro');
        $('#themeIcon').className = 'fas ' + (state.theme === 'dark' ? 'fa-moon' : 'fa-sun');
    }
    function renderMe() {
        $('#meBtn').textContent = initial(state.me);
        $('#meBig').textContent = initial(state.me);
        $('#meHandle').textContent = state.me;
    }

    /* ---------- notificações ---------- */
    function renderNotifs() {
        const list = longVideos().slice(0, 5);
        $('#notifList').innerHTML = list.length ? list.map((v) => `
            <a class="notif" href="#/watch/${v.id}">
                ${avatar(chan(v.ch))}
                <div><b>${esc(chan(v.ch).name)}</b> postou: ${esc(v.title)}<small>${age(v)}</small></div>
                <img class="notif-thumb" src="${thumbSrc(v)}" ${imgErr} alt="">
            </a>`).join('') : '<p class="notif-empty">Nada de novo por aqui.</p>';
        const unseen = list.filter((v) => v.createdAt > state.seen).length;
        const b = $('#notifBadge');
        b.textContent = unseen;
        b.style.display = unseen ? '' : 'none';
    }

    /* ---------- popup genérico (três pontinhos) ---------- */
    let popupEl = null;
    const closePopup = () => { if (popupEl) { popupEl.remove(); popupEl = null; } };

    function openPopup(btn, items) {
        closePopup();
        const r = btn.getBoundingClientRect();
        const el = document.createElement('div');
        el.className = 'popup';
        el.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}"><i class="fas ${it.icon}"></i>${esc(it.label)}</button>`).join('');
        document.body.appendChild(el);
        const w = 260, h = el.offsetHeight;
        el.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
        el.style.top = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
        popupEl = el;
        el.addEventListener('click', (ev) => {
            const b = ev.target.closest('button');
            if (!b) return;
            ev.stopPropagation();
            const it = items[Number(b.dataset.i)];
            closePopup();
            if (it && it.fn) it.fn();
        });
    }

    function videoMenu(v, btn) {
        const later = state.later.includes(v.id);
        const items = [
            {
                icon: 'fa-clock', label: later ? 'Remover de Assistir mais tarde' : 'Salvar em Assistir mais tarde', fn() {
                    const on = toggleIn(state.later, v.id);
                    save('later');
                    toast(on ? 'Salvo em Assistir mais tarde' : 'Removido de Assistir mais tarde');
                    if (route.name === 'watchlater' && !on) router();
                    const wl = $('#wLater'); if (wl) { wl.classList.toggle('on', on); $('span', wl).textContent = on ? 'Salvo' : 'Salvar'; }
                }
            },
            { icon: 'fa-share', label: 'Compartilhar', fn: () => copyLink(v) }
        ];
        const card = btn && btn.closest('.video-card');
        if (card) items.push({
            icon: 'fa-ban', label: 'Não tenho interesse', fn() {
                card.classList.add('removing'); setTimeout(() => card.remove(), 300);
                toast('Ok, vamos mostrar menos vídeos assim');
            }
        });
        items.push('-');
        if (v.media) items.push({ icon: 'fa-download', label: 'Baixar arquivo', fn: () => downloadMedia(v) });
        items.push({ icon: 'fa-pen', label: 'Editar', fn: () => openEditVideo(v) });
        items.push({ icon: 'fa-trash', label: 'Excluir', fn: () => deleteVideo(v) });
        return items;
    }

    function downloadMedia(v) {
        const ext = (v.media.split('.').pop() || 'bin');
        const a = document.createElement('a');
        a.href = v.media;
        a.download = v.title.replace(/[\\/:*?"<>|]+/g, '').slice(0, 80) + '.' + ext;
        document.body.appendChild(a); a.click(); a.remove();
    }

    async function deleteVideo(v) {
        if (!confirm(`Excluir "${v.title}"?\nO arquivo e os comentários também serão apagados do servidor.`)) return;
        try { await api.deleteVideo(v.id); } catch (e) { toast('Erro: ' + e.message); return; }
        db.videos = db.videos.filter((x) => x.id !== v.id);
        db.comments = db.comments.filter((c) => c.target !== v.id);
        ['history', 'later', 'liked', 'disliked'].forEach((k) => { state[k] = state[k].filter((x) => x !== v.id); save(k); });
        toast('Excluído');
        renderNotifs();
        if (route.name === 'watch' || (route.name === 'shorts' && route.arg === v.id)) go('#/');
        else router();
    }

    /* ---------- menus do cabeçalho e ações globais ---------- */
    function closeMenus() { $$('.menu.open').forEach((m) => m.classList.remove('open')); }

    const actions = {
        theme() { state.theme = state.theme === 'dark' ? 'light' : 'dark'; save('theme'); applyTheme(); },
        upload() { openUpload(); },
        'upload-short'() { openUpload({ short: true }); },
        'new-channel'() { openChannelModal(); },
        live() { toast('Transmissões ao vivo chegam em breve'); },
        rename() {
            const n = prompt('Seu nome nos comentários (ex.: @fulano):', state.me);
            if (n && n.trim()) { state.me = n.trim().slice(0, 40); save('me'); renderMe(); toast('Nome alterado'); }
        },
        reset() {
            if (confirm('Apagar histórico, curtidas, inscrições e preferências DESTE navegador?\n(Os vídeos e comentários do servidor não são afetados.)')) {
                Object.keys(localStorage).filter((k) => k.indexOf('mg_') === 0 && k !== 'mg_admin_key').forEach((k) => localStorage.removeItem(k));
                location.reload();
            }
        }
    };

    document.addEventListener('click', (e) => {
        if (popupEl && !e.target.closest('.popup')) closePopup();
        const kb = e.target.closest('[data-kebab]');
        if (kb) { e.preventDefault(); e.stopPropagation(); const v = byId(kb.dataset.kebab); if (v) openPopup(kb, videoMenu(v, kb)); return; }

        const mb = e.target.closest('[data-menu]');
        $$('.menu.open').forEach((m) => { if (!mb || m.id !== mb.dataset.menu) m.classList.remove('open'); });
        if (mb) {
            const m = $('#' + mb.dataset.menu);
            m.classList.toggle('open');
            if (mb.dataset.menu === 'menuNotif' && m.classList.contains('open')) { state.seen = Date.now(); save('seen'); renderNotifs(); }
            return;
        }
        const act = e.target.closest('.menu [data-action]');
        if (act) { actions[act.dataset.action](); closeMenus(); return; }
        if (e.target.closest('.menu a')) closeMenus();

        if (!e.target.closest('.search-wrap')) $('#suggest').classList.remove('open');

        const op = e.target.closest('[data-open]');
        if (op) { if (op.dataset.open === 'upload') openUpload({ ch: op.dataset.ch }); else if (op.dataset.open === 'channel') openChannelModal(); return; }

        const chip = e.target.closest('.chip[data-cat]');
        if (chip && route.name === 'home') {
            state.homeCat = chip.dataset.cat;
            $$('#chips .chip').forEach((c) => c.classList.toggle('active', c === chip));
            fillFeed(false);
            return;
        }

        const c = e.target.closest('.video-card');
        if (c && !e.target.closest('a, button')) openVideo(c.dataset.id);
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('video-card')) openVideo(e.target.dataset.id);
        if (e.key === 'Escape') {
            closeMenus(); closePopup(); closeVoice(); closeModal();
            $('#suggest').classList.remove('open');
            body.classList.remove('drawer-open');
        }
    });
    window.addEventListener('scroll', closePopup, { passive: true });

    /* ---------- busca ---------- */
    const input = $('#searchInput');
    const sug = $('#suggest');

    function renderSuggest() {
        const raw = input.value.trim();
        const q = norm(raw);
        let items;
        if (!q) {
            items = state.searches.slice(0, 6).map((t) => ({ t, h: true }));
        } else {
            const pool = Array.from(new Set([...db.videos.map((v) => v.title), ...db.channels.map((c) => c.name)]));
            items = pool.filter((t) => norm(t).indexOf(q) >= 0).slice(0, 8).map((t) => ({ t, h: false }));
            if (!items.length) items = [{ t: raw, h: false }];
        }
        sug.innerHTML = items.map((i) => `<li data-q="${esc(i.t)}"><i class="fas ${i.h ? 'fa-clock-rotate-left' : 'fa-magnifying-glass'}"></i><span>${esc(i.t)}</span></li>`).join('');
        sug.classList.toggle('open', items.length > 0);
    }
    function doSearch() {
        const q = input.value.trim();
        if (!q) return;
        sug.classList.remove('open');
        input.blur();
        location.hash = '#/results/' + encodeURIComponent(q);
    }
    input.addEventListener('focus', renderSuggest);
    input.addEventListener('input', renderSuggest);
    sug.addEventListener('mousedown', (e) => {
        const li = e.target.closest('li');
        if (!li) return;
        e.preventDefault();
        input.value = li.dataset.q;
        doSearch();
    });
    $('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); doSearch(); });

    /* ---------- busca por voz (de brincadeira) ---------- */
    const voice = $('#voice');
    let voiceTimer = null;
    function closeVoice() { clearTimeout(voiceTimer); voice.classList.remove('open'); }
    $('#micBtn').addEventListener('click', () => {
        const phrase = (db.videos[0] && db.videos[0].title.toLowerCase().split(' ').slice(0, 2).join(' ')) || 'olá';
        voice.classList.add('open');
        $('#voiceText').textContent = 'Ouvindo…';
        voiceTimer = setTimeout(() => {
            $('#voiceText').textContent = '“' + phrase + '”';
            voiceTimer = setTimeout(() => { closeVoice(); input.value = phrase; doSearch(); }, 900);
        }, 2200);
    });
    voice.addEventListener('click', closeVoice);

    /* ==========================================================
       MODAIS (base comum)
       ========================================================== */
    let modalLock = false;
    // os modais se empilham (ex.: editar um comentário por cima da lista de comentários dos Shorts)
    function openModal(html, opts = {}) {
        const back = document.createElement('div');
        back.className = 'modal-back';
        back.innerHTML = `<div class="modal ${opts.cls || ''}" role="dialog" aria-modal="true">${html}</div>`;
        back.addEventListener('mousedown', (e) => { if (e.target === back) closeModal(); });
        $('#modalRoot').appendChild(back);
        return back.firstElementChild;
    }
    function closeModal(force) {
        if (modalLock && force !== true) return;
        modalLock = false;
        const last = $('#modalRoot').lastElementChild;
        if (last) last.remove();
    }
    const lockModal = (on) => { modalLock = on; };

    // select de categorias com a opção "Nova categoria…"
    const catOptions = (sel) => `<option value="">Sem categoria</option>${db.categories.map((c) => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__new">➕ Nova categoria…</option>`;
    function bindCatSelect(sel) {
        let prev = sel.value;
        sel.addEventListener('change', () => {
            if (sel.value !== '__new') { prev = sel.value; return; }
            const name = (prompt('Nome da nova categoria:') || '').trim().slice(0, 40);
            if (!name) { sel.value = prev; return; }
            if (!db.categories.includes(name)) {
                const o = document.createElement('option');
                o.textContent = name;
                sel.insertBefore(o, sel.querySelector('[value="__new"]'));
            }
            sel.value = name; prev = name;
        });
    }
    const chOptions = (sel) => db.channels.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)} (${esc(c.handle)})</option>`).join('');

    // pré-visualização de imagem escolhida em um <input type=file>
    function bindImagePick(inputEl, previewEl, setter) {
        inputEl.addEventListener('change', () => {
            const f = inputEl.files[0];
            if (!f) return;
            if (media.kindOf(f) !== 'image') { toast('Escolha uma imagem (JPG, PNG, WEBP ou GIF)'); inputEl.value = ''; return; }
            const url = URL.createObjectURL(f);
            setter(f);
            if (previewEl.tagName === 'IMG') previewEl.src = url; else previewEl.style.backgroundImage = `url("${url}")`;
        });
    }

    /* ==========================================================
       CANAL: criar / personalizar
       ========================================================== */
    function openChannelModal(ch) {
        const isNew = !ch;
        const c = ch || { name: '', handle: '', subs: '', about: '', avatar: null, banner: null };
        let avatarFile = null, bannerFile = null;
        openModal(`
            <h2>${isNew ? 'Criar canal' : 'Personalizar canal'}</h2>
            <p class="hint">${isNew ? 'Cada canal pode ter foto e banner próprios.' : 'Mude nome, fotos e descrição quando quiser.'}</p>
            <div class="ch-banner-prev" id="cmBanner" style="background-image:url('${c.banner || c.avatar || FALLBACK}')"></div>
            <div class="ch-pick">
                <img class="avatar xl" id="cmAvatar" src="${avatarSrc(c)}" ${imgErr} alt="">
                <div>
                    <button class="pill" id="cmAvBtn" type="button"><i class="fas fa-image"></i>Foto do canal</button>
                    <button class="pill" id="cmBnBtn" type="button"><i class="fas fa-panorama"></i>Banner</button>
                    <input type="file" id="cmAvFile" accept="image/*" hidden><input type="file" id="cmBnFile" accept="image/*" hidden>
                </div>
            </div>
            <label for="cmName">Nome do canal</label>
            <input id="cmName" maxlength="60" value="${esc(c.name)}" placeholder="Ex.: Canal do Fulano">
            <div class="row2">
                <div><label for="cmHandle">Identificador</label><input id="cmHandle" maxlength="40" value="${esc(c.handle)}" placeholder="@fulano"></div>
                <div><label for="cmSubs">Inscritos (texto livre)</label><input id="cmSubs" maxlength="60" value="${esc(c.subs)}" placeholder="1,2 mi de inscritos"></div>
            </div>
            <label for="cmAbout">Descrição</label>
            <textarea id="cmAbout" rows="3" maxlength="1000" placeholder="Sobre o canal…">${esc(c.about)}</textarea>
            <div class="modal-actions">
                ${isNew ? '' : '<button class="pill danger" id="cmDel" type="button"><i class="fas fa-trash"></i>Excluir canal</button><span class="spacer"></span>'}
                <button class="pill" id="cmCancel" type="button">Cancelar</button>
                <button class="pill primary" id="cmSave" type="button">${isNew ? 'Criar' : 'Salvar'}</button>
            </div>`);
        $('#cmName').focus();
        $('#cmCancel').onclick = () => closeModal();
        $('#cmAvBtn').onclick = () => $('#cmAvFile').click();
        $('#cmBnBtn').onclick = () => $('#cmBnFile').click();
        bindImagePick($('#cmAvFile'), $('#cmAvatar'), (f) => { avatarFile = f; });
        bindImagePick($('#cmBnFile'), $('#cmBanner'), (f) => { bannerFile = f; });

        if (!isNew) {
            $('#cmDel').onclick = async () => {
                const n = db.videos.filter((v) => v.ch === c.id).length;
                if (!confirm(`Excluir o canal "${c.name}"?\n${n} vídeo(s)/short(s) do canal e seus comentários serão apagados.`)) return;
                try { await api.deleteChannel(c.id); } catch (e) { toast('Erro: ' + e.message); return; }
                const gone = new Set(db.videos.filter((v) => v.ch === c.id).map((v) => v.id));
                db.videos = db.videos.filter((v) => v.ch !== c.id);
                db.comments = db.comments.filter((x) => !gone.has(x.target));
                db.channels = db.channels.filter((x) => x.id !== c.id);
                state.subs = (state.subs || []).filter((x) => x !== c.id); save('subs');
                closeModal(true); renderSide(); renderNotifs();
                toast('Canal excluído');
                go('#/');
            };
        }

        $('#cmSave').onclick = async () => {
            const name = $('#cmName').value.trim();
            if (!name) { toast('Dê um nome ao canal'); $('#cmName').focus(); return; }
            const btn = $('#cmSave');
            btn.disabled = true; btn.textContent = 'Salvando…'; lockModal(true);
            try {
                let avatarUrl = c.avatar, bannerUrl = c.banner;
                if (avatarFile) { const o = await media.optimizeImage(avatarFile); avatarUrl = await api.upload(o.blob, o.name); }
                if (bannerFile) { const o = await media.optimizeImage(bannerFile); bannerUrl = await api.upload(o.blob, o.name); }
                const payload = { name, handle: $('#cmHandle').value.trim(), subs: $('#cmSubs').value.trim(), about: $('#cmAbout').value.trim(), avatar: avatarUrl, banner: bannerUrl };
                let saved;
                if (isNew) { saved = await api.createChannel(payload); db.channels.push(saved); }
                else { saved = await api.updateChannel(c.id, payload); Object.assign(c, saved); }
                lockModal(false); closeModal(true);
                renderSide(); renderNotifs();
                toast(isNew ? 'Canal criado!' : 'Canal atualizado');
                if (isNew) go('#/channel/' + saved.id); else router();
            } catch (e) {
                lockModal(false);
                btn.disabled = false; btn.textContent = isNew ? 'Criar' : 'Salvar';
                toast('Erro: ' + e.message);
            }
        };
    }

    /* ==========================================================
       UPLOAD de vídeos, fotos e shorts
       ========================================================== */
    const prettyName = (n) => {
        const t = n.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
        return t ? t[0].toUpperCase() + t.slice(1) : 'Sem título';
    };

    function openUpload(opts = {}) {
        if (!hasChannels()) { toast('Crie um canal antes de publicar'); openChannelModal(); return; }
        const items = [];
        let queue = Promise.resolve();
        let seq = 0;
        const selCh = opts.ch && db.channels.some((c) => c.id === opts.ch) ? opts.ch
            : (route.name === 'channel' && db.channels.some((c) => c.id === route.arg) ? route.arg : db.channels[0].id);
        let customThumb = null;

        openModal(`
            <h2>Enviar vídeo ou foto</h2>
            <p class="hint">Aceita vídeos (MP4, WEBM, MOV) e fotos (JPG, PNG, WEBP, GIF). Pode escolher vários de uma vez — máx. ${serverInfo.maxUploadMB} MB cada.</p>
            <div class="dropzone" id="upDrop" tabindex="0"><i class="fas fa-cloud-arrow-up"></i><b>Arraste arquivos aqui</b><span>ou clique para escolher</span>
                <input type="file" id="upFile" multiple accept="video/*,image/*,.mkv,.mov,.webp,.avif" hidden></div>
            <div class="up-items" id="upItems"></div>
            <div id="upForm" style="display:none">
                <div class="row2">
                    <div><label for="upCh">Canal</label><select id="upCh">${chOptions(selCh)}</select></div>
                    <div><label for="upCat">Categoria</label><select id="upCat">${catOptions('')}</select></div>
                </div>
                <label for="upDesc">Descrição</label>
                <textarea id="upDesc" rows="2" maxlength="5000" placeholder="Conte sobre o vídeo…"></textarea>
                <label class="check"><input type="checkbox" id="upShort" ${opts.short ? 'checked' : ''}> Publicar como <b>Short</b> (formato vertical)</label>
                <details class="adv"><summary>Opções avançadas (números falsos, miniatura…)</summary>
                    <div class="row2">
                        <div><label for="upViews">Visualizações</label><input id="upViews" placeholder="0  ·  ex.: 1,2 mi  ·  340 mil"></div>
                        <div><label for="upLikes">Curtidas</label><input id="upLikes" placeholder="automático"></div>
                    </div>
                    <div class="row2">
                        <div><label>Publicado há</label>${ageFieldsHTML('upAge')}</div>
                        <div id="upDurWrap"><label for="upDur">Duração (só para fotos)</label><input id="upDur" placeholder="aleatória · ex.: 3:21"></div>
                    </div>
                    <div id="upThumbWrap"><label>Miniatura personalizada (só quando for um arquivo)</label>
                        <button class="pill" id="upThumbBtn" type="button"><i class="fas fa-image"></i><span id="upThumbName">Escolher imagem</span></button>
                        <input type="file" id="upThumbFile" accept="image/*" hidden></div>
                    <label class="check"><input type="checkbox" id="upOpt" checked> Otimizar fotos grandes (reduz o espaço usado no servidor)</label>
                </details>
            </div>
            <div class="upload-bar" id="upBar"><span></span></div>
            <p class="up-status" id="upStatus"></p>
            <div class="modal-actions">
                <button class="pill" id="upCancel" type="button">Cancelar</button>
                <button class="pill primary" id="upPublish" type="button" disabled>Publicar</button>
            </div>`, { cls: 'wide' });

        bindAge('upAge');
        bindCatSelect($('#upCat'));
        const fileIn = $('#upFile'), drop = $('#upDrop');

        const refresh = () => {
            $('#upForm').style.display = items.length ? '' : 'none';
            $('#upThumbWrap').style.display = items.length === 1 ? '' : 'none';
            $('#upDurWrap').style.display = items.some((i) => i.kind === 'image') ? '' : 'none';
            $('#upPublish').disabled = !items.length;
            $('#upPublish').textContent = items.length > 1 ? `Publicar ${items.length}` : 'Publicar';
        };
        const renderItems = () => {
            $('#upItems').innerHTML = items.map((it) => `
                <div class="up-item" data-id="${it.id}">
                    <div class="up-thumb">${it.thumbUrl ? `<img src="${it.thumbUrl}" alt="">` : '<i class="fas fa-spinner fa-spin"></i>'}</div>
                    <div class="up-main">
                        <input class="up-title" maxlength="120" value="${esc(it.title)}" aria-label="Título">
                        <small>${it.kind === 'video' ? 'Vídeo' + (it.duration ? ' • ' + fmtTime(it.duration) : '') : 'Foto'} • ${fmtBytes(it.file.size)}</small>
                    </div>
                    <button class="icon-btn up-rm" type="button" aria-label="Remover"><i class="fas fa-xmark"></i></button>
                </div>`).join('');
            refresh();
        };

        async function prepare(it) {
            try {
                if (it.kind === 'video') {
                    const info = await media.videoInfo(it.file);
                    it.duration = info.duration; it.thumb = info.thumb;
                    if (!info.ok) toast(`"${it.file.name}": o navegador não conseguiu ler este vídeo. Ele pode não tocar — prefira MP4 (H.264).`);
                } else {
                    it.thumb = await media.imageThumb(it.file);
                }
            } catch (e) { it.thumb = null; }
            if (it.thumb) it.thumbUrl = URL.createObjectURL(it.thumb);
            else it.thumbUrl = FALLBACK;
            if (items.includes(it)) renderItems();
        }

        function addFiles(list) {
            Array.from(list).forEach((f) => {
                const kind = media.kindOf(f);
                if (!kind) {
                    const e = media.extOf(f.name);
                    toast(e === 'heic' || e === 'heif' ? `"${f.name}": fotos HEIC não funcionam na web. Converta para JPG.` : `"${f.name}" não é uma foto ou vídeo aceito.`);
                    return;
                }
                if (f.size > serverInfo.maxUploadMB * 1048576) { toast(`"${f.name}" passa de ${serverInfo.maxUploadMB} MB. Comprima antes de enviar.`); return; }
                const it = { id: ++seq, file: f, kind, title: prettyName(f.name), thumb: null, thumbUrl: '', duration: 0 };
                items.push(it);
                queue = queue.then(() => prepare(it));
            });
            renderItems();
        }

        drop.addEventListener('click', () => fileIn.click());
        drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
        fileIn.addEventListener('change', () => { addFiles(fileIn.files); fileIn.value = ''; });
        ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
        ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
        drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

        $('#upItems').addEventListener('input', (e) => {
            const row = e.target.closest('.up-item');
            const it = row && items.find((x) => x.id === Number(row.dataset.id));
            if (it && e.target.classList.contains('up-title')) it.title = e.target.value;
        });
        $('#upItems').addEventListener('click', (e) => {
            const rm = e.target.closest('.up-rm');
            if (!rm) return;
            const i = items.findIndex((x) => x.id === Number(rm.closest('.up-item').dataset.id));
            if (i >= 0) items.splice(i, 1);
            renderItems();
        });
        $('#upThumbBtn').onclick = () => $('#upThumbFile').click();
        $('#upThumbFile').addEventListener('change', (e) => {
            const f = e.target.files[0];
            if (!f) return;
            if (media.kindOf(f) !== 'image') { toast('A miniatura precisa ser uma imagem'); e.target.value = ''; return; }
            customThumb = f; $('#upThumbName').textContent = f.name;
        });
        $('#upCancel').onclick = () => closeModal();

        $('#upPublish').onclick = async () => {
            if (!items.length) return;
            const views = parseCount($('#upViews').value), likes = parseCount($('#upLikes').value), durOver = parseDuration($('#upDur').value);
            if (Number.isNaN(views)) { toast('Visualizações inválidas. Use algo como 1500, 1,2 mi ou 340 mil'); return; }
            if (Number.isNaN(likes)) { toast('Curtidas inválidas. Use algo como 800 ou 12 mil'); return; }
            if (Number.isNaN(durOver)) { toast('Duração inválida. Use o formato 3:21'); return; }
            const common = {
                ch: $('#upCh').value, cat: $('#upCat').value === '__new' ? '' : $('#upCat').value, desc: $('#upDesc').value.trim(),
                short: $('#upShort').checked, views: views || 0, likes, createdAt: readAge('upAge', false)
            };
            const optimize = $('#upOpt').checked;
            const total = items.length;
            let done = 0;
            const created = [];

            lockModal(true);
            $$('#modalRoot button, #modalRoot input, #modalRoot select, #modalRoot textarea').forEach((el) => { el.disabled = true; });
            $('#upBar').style.display = 'block';
            const bar = (p) => { $('#upBar span').style.width = Math.min(100, p * 100) + '%'; };
            const status = (t) => { $('#upStatus').textContent = t; };

            try {
                for (const it of items.slice()) {
                    status(`Enviando ${done + 1} de ${total}: ${it.title || it.file.name}`);
                    const base = done / total, span = 1 / total;
                    let file = it.file, name = it.file.name;
                    if (it.kind === 'image' && optimize) { status(`Otimizando ${done + 1} de ${total}…`); const o = await media.optimizeImage(it.file); file = o.blob; name = o.name; status(`Enviando ${done + 1} de ${total}: ${it.title || it.file.name}`); }
                    const mediaUrl = await api.upload(file, name, (p) => bar(base + p * span * 0.95));

                    let thumbUrl = null;
                    if (total === 1 && customThumb) {
                        const tb = await media.imageThumb(customThumb);
                        if (tb) thumbUrl = await api.upload(tb, 'miniatura.jpg');
                    } else if (it.thumb) {
                        thumbUrl = await api.upload(it.thumb, 'miniatura.jpg');
                    }

                    const duration = it.kind === 'video' ? it.duration : (common.short ? 15 : (durOver != null ? durOver : 60 + Math.floor(Math.random() * 660)));
                    const v = await api.createVideo({
                        title: (it.title || '').trim() || prettyName(it.file.name), desc: common.desc, ch: common.ch, cat: common.cat,
                        type: it.kind, media: mediaUrl, thumb: thumbUrl, duration, views: common.views, likes: common.likes,
                        short: common.short, createdAt: common.createdAt
                    });
                    db.videos.unshift(v);
                    if (v.cat && !db.categories.includes(v.cat)) db.categories.push(v.cat);
                    created.push(v);
                    items.splice(items.indexOf(it), 1);
                    done++;
                    bar(done / total);
                }
            } catch (e) {
                lockModal(false);
                $$('#modalRoot button, #modalRoot input, #modalRoot select, #modalRoot textarea').forEach((el) => { el.disabled = false; });
                renderItems();
                status(done ? `${done} publicado(s). Falhou no próximo: ${e.message}` : 'Falhou: ' + e.message);
                toast('Erro no envio: ' + e.message);
                if (created.length) { renderSide(); renderNotifs(); }
                return;
            }
            lockModal(false);
            closeModal(true);
            renderSide(); renderNotifs();
            toast(created.length > 1 ? `${created.length} itens publicados!` : 'Publicado!');
            state.homeCat = 'Tudo';
            if (created.length === 1) go((created[0].short ? '#/shorts/' : '#/watch/') + created[0].id);
            else if (created.every((v) => v.short)) go('#/shorts/' + created[0].id);
            else go('#/channel/' + created[0].ch);
        };

        refresh();
    }

    /* ==========================================================
       EDITAR vídeo / short
       ========================================================== */
    function openEditVideo(v) {
        let newMedia = null, newThumb = null;
        const isImg = v.type === 'image';
        openModal(`
            <h2>Editar ${v.short ? 'Short' : (isImg ? 'foto' : 'vídeo')}</h2>
            <div class="preview"><img id="evPrev" src="${thumbSrc(v)}" ${imgErr} alt=""></div>
            <label for="evTitle">Título</label>
            <input id="evTitle" maxlength="120" value="${esc(v.title)}">
            <label for="evDesc">Descrição</label>
            <textarea id="evDesc" rows="3" maxlength="5000">${esc(v.desc || '')}</textarea>
            <div class="row2">
                <div><label for="evCh">Canal</label><select id="evCh">${chOptions(v.ch)}</select></div>
                <div><label for="evCat">Categoria</label><select id="evCat">${catOptions(v.cat)}</select></div>
            </div>
            <div class="row2">
                <div><label for="evViews">Visualizações</label><input id="evViews" value="${v.views}"></div>
                <div><label for="evLikes">Curtidas (vazio = automático)</label><input id="evLikes" value="${v.likes == null ? '' : v.likes}"></div>
            </div>
            <div class="row2">
                <div><label>Publicado há</label>${ageFieldsHTML('evAge', v.createdAt)}</div>
                ${isImg && !v.short ? `<div><label for="evDur">Duração do "vídeo"</label><input id="evDur" value="${fmtTime(v.duration)}"></div>` : '<div></div>'}
            </div>
            <label class="check"><input type="checkbox" id="evShort" ${v.short ? 'checked' : ''}> É um Short (vertical)</label>
            <div class="ev-files">
                <button class="pill" id="evThumbBtn" type="button"><i class="fas fa-image"></i><span id="evThumbName">Trocar miniatura</span></button>
                ${isImg ? '<button class="pill" id="evMediaBtn" type="button"><i class="fas fa-camera"></i><span id="evMediaName">Trocar foto</span></button>' : ''}
                <input type="file" id="evThumbFile" accept="image/*" hidden><input type="file" id="evMediaFile" accept="image/*" hidden>
            </div>
            <div class="modal-actions">
                <button class="pill" id="evCancel" type="button">Cancelar</button>
                <button class="pill primary" id="evSave" type="button">Salvar</button>
            </div>`);
        bindAge('evAge');
        bindCatSelect($('#evCat'));
        $('#evCancel').onclick = () => closeModal();
        $('#evThumbBtn').onclick = () => $('#evThumbFile').click();
        bindImagePick($('#evThumbFile'), $('#evPrev'), (f) => { newThumb = f; $('#evThumbName').textContent = f.name; });
        if (isImg) {
            $('#evMediaBtn').onclick = () => $('#evMediaFile').click();
            bindImagePick($('#evMediaFile'), $('#evPrev'), (f) => { newMedia = f; $('#evMediaName').textContent = f.name; });
        }

        $('#evSave').onclick = async () => {
            const title = $('#evTitle').value.trim();
            if (!title) { toast('O título não pode ficar vazio'); return; }
            const views = parseCount($('#evViews').value), likes = parseCount($('#evLikes').value);
            if (views === null || Number.isNaN(views)) { toast('Visualizações inválidas'); return; }
            if (Number.isNaN(likes)) { toast('Curtidas inválidas'); return; }
            const dur = $('#evDur') ? parseDuration($('#evDur').value) : null;
            if (Number.isNaN(dur)) { toast('Duração inválida. Use o formato 3:21'); return; }
            const btn = $('#evSave');
            btn.disabled = true; btn.textContent = 'Salvando…'; lockModal(true);
            try {
                const patch = {
                    title, desc: $('#evDesc').value.trim(), ch: $('#evCh').value, cat: $('#evCat').value === '__new' ? '' : $('#evCat').value,
                    views, likes, short: $('#evShort').checked
                };
                const at = readAge('evAge', true);
                if (at !== undefined) patch.createdAt = at;
                if (dur != null) patch.duration = dur;
                if (newMedia) {
                    const o = await media.optimizeImage(newMedia);
                    patch.media = await api.upload(o.blob, o.name);
                    if (!newThumb) { const tb = await media.imageThumb(newMedia); if (tb) patch.thumb = await api.upload(tb, 'miniatura.jpg'); }
                }
                if (newThumb) { const tb = await media.imageThumb(newThumb); if (tb) patch.thumb = await api.upload(tb, 'miniatura.jpg'); }
                const saved = await api.updateVideo(v.id, patch);
                Object.assign(v, saved);
                lockModal(false); closeModal(true);
                renderSide(); renderNotifs();
                toast('Alterações salvas');
                router();
            } catch (e) {
                lockModal(false);
                btn.disabled = false; btn.textContent = 'Salvar';
                toast('Erro: ' + e.message);
            }
        };
    }

    /* ==========================================================
       COMENTÁRIOS (usado na página do vídeo e nos Shorts)
       ========================================================== */
    function mountComments(box, target, onChange) {
        let sort = 'top';
        const openReplies = new Set();
        let replyingTo = null;
        let customAvatar = null;

        const all = () => db.comments.filter((c) => c.target === target);
        const topLevel = () => {
            const l = all().filter((c) => !c.parent);
            return sort === 'new' ? l.sort((a, b) => b.createdAt - a.createdAt) : l.sort((a, b) => (b.likes - a.likes) || (b.createdAt - a.createdAt));
        };
        const repliesOf = (id) => all().filter((c) => c.parent === id).sort((a, b) => a.createdAt - b.createdAt);

        const identity = () => {
            if (state.as.startsWith('ch:')) {
                const c = db.channels.find((x) => x.id === state.as.slice(3));
                if (c) return { name: c.handle, avatar: c.avatar };
                state.as = 'me';
            }
            if (state.as === 'custom') return null;
            return { name: state.me, avatar: null };
        };
        const asOptions = () => `<option value="me" ${state.as === 'me' ? 'selected' : ''}>Eu (${esc(state.me)})</option>
            ${db.channels.map((c) => `<option value="ch:${c.id}" ${state.as === 'ch:' + c.id ? 'selected' : ''}>${esc(c.name)} (${esc(c.handle)})</option>`).join('')}
            <option value="custom" ${state.as === 'custom' ? 'selected' : ''}>✏️ Outra pessoa…</option>`;

        const commentHTML = (c, isReply) => {
            const liked = state.clikes.includes(c.id);
            const n = c.likes + (liked ? 1 : 0);
            const reps = isReply ? [] : repliesOf(c.id);
            const open = openReplies.has(c.id);
            return `<div class="comment ${isReply ? 'reply' : ''}" data-id="${c.id}">
                ${personAvatar(c.avatar, c.name)}
                <div class="c-body">
                    <div class="c-head"><b>${esc(c.name)}</b><small>${rel(c.createdAt)}</small></div>
                    <div class="c-text">${esc(c.text)}</div>
                    <div class="comment-actions">
                        <button data-cl class="${liked ? 'on' : ''}" aria-label="Gostei"><i class="${liked ? 'fas' : 'fa-regular'} fa-thumbs-up"></i><span>${n ? fmtCount(n) : ''}</span></button>
                        <button data-cd aria-label="Não gostei"><i class="fa-regular fa-thumbs-down"></i></button>
                        <button class="txt" data-reply>Responder</button>
                        <button data-ckebab class="c-kebab" aria-label="Mais"><i class="fas fa-ellipsis-vertical"></i></button>
                    </div>
                    <div class="reply-slot"></div>
                    ${reps.length ? `<button class="show-replies" data-toggle><i class="fas fa-chevron-${open ? 'up' : 'down'}"></i>${reps.length} ${reps.length === 1 ? 'resposta' : 'respostas'}</button>
                    <div class="replies ${open ? '' : 'hide'}">${reps.map((r) => commentHTML(r, true)).join('')}</div>` : ''}
                </div>
            </div>`;
        };

        function render(keepForm) {
            const n = all().length;
            const prevText = keepForm && $('#cInput', box) ? $('#cInput', box).value : '';
            const wasFocus = keepForm && $('#cForm', box) && $('#cForm', box).classList.contains('focus');
            const idn = identity();
            box.innerHTML = `
                <div class="comments-head"><h2>${n} ${n === 1 ? 'comentário' : 'comentários'}</h2>
                    <select class="sort-select" id="cSort" aria-label="Ordenar"><option value="top" ${sort === 'top' ? 'selected' : ''}>Principais</option><option value="new" ${sort === 'new' ? 'selected' : ''}>Mais recentes</option></select></div>
                <div class="comment-form ${wasFocus ? 'focus' : ''}" id="cForm">
                    ${personAvatar(idn ? idn.avatar : null, idn ? idn.name : '?', 'me-av')}
                    <div class="cf-body">
                        <input id="cInput" placeholder="Adicione um comentário..." autocomplete="off" value="${esc(prevText)}">
                        <div class="cf-extra">
                            <label>Comentar como <select id="cAs">${asOptions()}</select></label>
                            <div class="cf-custom" ${state.as === 'custom' ? '' : 'hidden'}>
                                <input id="cName" maxlength="40" placeholder="@nome_da_pessoa">
                                <button class="pill" id="cPhotoBtn" type="button"><i class="fas fa-image"></i><span id="cPhotoName">Foto</span></button>
                                <input type="file" id="cPhotoFile" accept="image/*" hidden>
                            </div>
                            <div class="cf-adv"><label>Curtidas <input id="cLikes" placeholder="0" size="6"></label>
                                <label>Há ${ageFieldsHTML('cAge')}</label></div>
                        </div>
                        <div class="cf-buttons"><button class="pill" id="cCancel" type="button">Cancelar</button><button class="pill primary" id="cSend" type="button">Comentar</button></div>
                    </div>
                </div>
                <div id="cList">${n ? topLevel().map((c) => commentHTML(c, false)).join('') : '<p class="meta no-comments">Ainda não há comentários. Seja o primeiro!</p>'}</div>`;
            bindAge('cAge');
            if (onChange) onChange(n);
        }

        async function send(text, parent, btn) {
            text = text.trim();
            if (!text) return;
            let idn = identity();
            let likes = 0, createdAt;
            if (!parent) {
                likes = parseCount(($('#cLikes', box) || {}).value) || 0;
                createdAt = readAge('cAge', false);
            }
            if (btn) { btn.disabled = true; }
            try {
                if (!idn) {
                    const name = (($('#cName', box) || {}).value || '').trim() || '@anonimo';
                    let avatarUrl = null;
                    if (customAvatar) { const o = await media.optimizeImage(customAvatar); avatarUrl = await api.upload(o.blob, o.name); }
                    idn = { name, avatar: avatarUrl };
                }
                const c = await api.createComment({ target, parent: parent || null, name: idn.name, avatar: idn.avatar, text, likes, createdAt });
                db.comments.push(c);
                if (c.parent) openReplies.add(c.parent);
                customAvatar = null;
                replyingTo = null;
                render(false);
            } catch (e) {
                toast('Erro: ' + e.message);
                if (btn) btn.disabled = false;
            }
        }

        function editComment(c) {
            openModal(`<h2>Editar comentário</h2>
                <label for="ecName">Nome</label><input id="ecName" maxlength="40" value="${esc(c.name)}">
                <label for="ecText">Texto</label><textarea id="ecText" rows="4" maxlength="3000">${esc(c.text)}</textarea>
                <label for="ecLikes">Curtidas</label><input id="ecLikes" value="${c.likes}">
                <div class="modal-actions"><button class="pill" id="ecCancel" type="button">Cancelar</button><button class="pill primary" id="ecSave" type="button">Salvar</button></div>`);
            $('#ecCancel').onclick = () => closeModal();
            $('#ecSave').onclick = async () => {
                const text = $('#ecText').value.trim();
                const likes = parseCount($('#ecLikes').value);
                if (!text) { toast('O comentário não pode ficar vazio'); return; }
                if (likes === null || Number.isNaN(likes)) { toast('Curtidas inválidas'); return; }
                try {
                    Object.assign(c, await api.updateComment(c.id, { text, name: $('#ecName').value.trim(), likes }));
                    closeModal(true); render(true); toast('Comentário atualizado');
                } catch (e) { toast('Erro: ' + e.message); }
            };
        }

        box.addEventListener('focusin', (e) => { if (e.target.id === 'cInput') $('#cForm', box).classList.add('focus'); });
        box.addEventListener('change', (e) => {
            if (e.target.id === 'cSort') { sort = e.target.value; render(true); }
            else if (e.target.id === 'cAs') { state.as = e.target.value; save('as'); render(true); $('#cForm', box).classList.add('focus'); }
            else if (e.target.id === 'cPhotoFile') {
                const f = e.target.files[0];
                if (!f) return;
                if (media.kindOf(f) !== 'image') { toast('Escolha uma imagem'); e.target.value = ''; return; }
                customAvatar = f; $('#cPhotoName', box).textContent = f.name.slice(0, 18);
            }
        });
        box.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.shiftKey) return;
            if (e.target.id === 'cInput') { e.preventDefault(); send(e.target.value, null, $('#cSend', box)); }
            else if (e.target.classList.contains('reply-input')) { e.preventDefault(); send(e.target.value, replyingTo, null); }
        });
        box.addEventListener('click', (e) => {
            const t = e.target;
            if (t.closest('#cCancel')) { $('#cInput', box).value = ''; $('#cForm', box).classList.remove('focus'); return; }
            if (t.closest('#cSend')) { send($('#cInput', box).value, null, t.closest('#cSend')); return; }
            if (t.closest('#cPhotoBtn')) { $('#cPhotoFile', box).click(); return; }
            const row = t.closest('.comment');
            if (!row) return;
            const c = db.comments.find((x) => x.id === row.dataset.id);
            if (!c) return;
            const top = c.parent || c.id;

            if (t.closest('[data-cl]')) {
                const on = toggleIn(state.clikes, c.id); save('clikes');
                const b = t.closest('[data-cl]');
                b.classList.toggle('on', on);
                $('i', b).className = (on ? 'fas' : 'fa-regular') + ' fa-thumbs-up pop';
                const n = c.likes + (on ? 1 : 0);
                $('span', b).textContent = n ? fmtCount(n) : '';
            } else if (t.closest('[data-cd]')) {
                const i = $('i', t.closest('[data-cd]'));
                const on = i.classList.toggle('fas'); i.classList.toggle('fa-regular', !on);
            } else if (t.closest('[data-toggle]')) {
                if (openReplies.has(c.id)) openReplies.delete(c.id); else openReplies.add(c.id);
                render(true);
            } else if (t.closest('[data-reply]')) {
                $$('.reply-slot', box).forEach((s) => { s.innerHTML = ''; });
                replyingTo = top;
                const slot = $('.reply-slot', row);
                slot.innerHTML = `<div class="reply-form"><input class="reply-input" placeholder="Adicione uma resposta como ${esc((identity() || { name: 'outra pessoa' }).name)}..." autocomplete="off">
                    <div class="cf-buttons show"><button class="pill" data-rcancel type="button">Cancelar</button><button class="pill primary" data-rsend type="button">Responder</button></div></div>`;
                $('.reply-input', slot).focus();
                if (c.parent) $('.reply-input', slot).value = c.name + ' ';
            } else if (t.closest('[data-rcancel]')) {
                $('.reply-slot', row).innerHTML = ''; replyingTo = null;
            } else if (t.closest('[data-rsend]')) {
                send($('.reply-input', row).value, top, t.closest('[data-rsend]'));
            } else if (t.closest('[data-ckebab]')) {
                openPopup(t.closest('[data-ckebab]'), [
                    { icon: 'fa-pen', label: 'Editar', fn: () => editComment(c) },
                    {
                        icon: 'fa-trash', label: 'Excluir', async fn() {
                            if (!confirm('Excluir este comentário' + (c.parent ? '?' : ' e as respostas dele?'))) return;
                            try {
                                const r = await api.deleteComment(c.id);
                                const gone = new Set(r.removed);
                                db.comments = db.comments.filter((x) => !gone.has(x.id));
                                render(true);
                            } catch (er) { toast('Erro: ' + er.message); }
                        }
                    }
                ]);
            }
        });

        render(false);
        return { render };
    }

    function openCommentsSheet(id, onChange) {
        const v = byId(id);
        openModal(`<div class="sheet-head"><h2>Comentários</h2><button class="icon-btn" id="shClose" aria-label="Fechar"><i class="fas fa-xmark"></i></button></div><p class="sheet-sub">${esc(v ? v.title : '')}</p><div id="sheetComments"></div>`, { cls: 'sheet' });
        $('#shClose').onclick = () => closeModal();
        mountComments($('#sheetComments'), id, onChange);
    }

    /* ==========================================================
       ROTEADOR
       ========================================================== */
    let cleanup = null;
    let renderToken = 0;

    function parseHash() {
        const h = location.hash.replace(/^#\/?/, '');
        const parts = h.split('/');
        let arg = parts.slice(1).join('/');
        try { arg = decodeURIComponent(arg); } catch (e) { /* mantém */ }
        return { name: parts[0] || 'home', arg };
    }

    function router() {
        if (cleanup) { cleanup(); cleanup = null; }
        closePopup();
        renderToken++;
        route = parseHash();
        applyLayout();
        body.classList.remove('drawer-open');
        app.classList.toggle('shorts-mode', route.name === 'shorts');
        window.scrollTo(0, 0);
        const pages = {
            home: pageHome, shorts: pageShorts, subscriptions: pageSubs, history: pageHistory,
            watchlater: pageLater, liked: pageLiked, watch: pageWatch, results: pageResults,
            channel: pageChannel, trending: pageTrending, explore: pageExplore, studio: pageStudio
        };
        (pages[route.name] || pageNotFound)(route.arg);
        setActiveNav();
        app.classList.remove('page-enter');
        void app.offsetWidth;
        app.classList.add('page-enter');
    }
    window.addEventListener('hashchange', router);

    /* ---------- página: início ---------- */
    function pageHome() {
        document.title = 'YouTube';
        if (state.homeCat !== 'Tudo' && !db.categories.includes(state.homeCat)) state.homeCat = 'Tudo';
        app.innerHTML = `<div class="chips" id="chips">${['Tudo', ...db.categories].map((c) =>
            `<button class="chip ${c === state.homeCat ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div><div id="feed"></div>`;
        fillFeed(true);
    }
    function fillFeed(first) {
        const feed = $('#feed');
        if (!feed) return;
        const tok = renderToken;
        feed.innerHTML = skeleton();
        setTimeout(() => {
            if (tok !== renderToken) return;
            const list = longVideos().filter((v) => state.homeCat === 'Tudo' || v.cat === state.homeCat);
            feed.innerHTML = list.length
                ? `<div class="video-grid">${list.map(card).join('')}</div>`
                : (longVideos().length
                    ? empty('fas fa-film', 'Nada por aqui ainda', 'Nenhum vídeo nesta categoria.')
                    : empty('fas fa-film', 'Ainda não há vídeos', 'Envie o primeiro vídeo ou foto para começar a brincadeira.', uploadBtn));
        }, first ? 650 : 350);
    }

    /* ---------- páginas de listas ---------- */
    function listPage(title, list, extra = '', rankOn = false) {
        return `<div class="list-page"><div class="list-head"><h1>${title}</h1>${extra}</div>${list.map((v, i) => hcard(v, rankOn ? i + 1 : 0)).join('')}</div>`;
    }

    function pageHistory() {
        document.title = 'Histórico - YouTube';
        const list = state.history.map(byId).filter(Boolean);
        if (!list.length) { app.innerHTML = empty('fas fa-clock-rotate-left', 'Seu histórico está vazio', 'Os vídeos que você assistir aparecerão aqui.', homeBtn); return; }
        app.innerHTML = listPage('Histórico de exibição', list, '<button class="pill" id="clearHistory"><i class="fas fa-trash"></i>Limpar histórico</button>');
        $('#clearHistory').onclick = () => { state.history = []; save('history'); toast('Histórico apagado'); router(); };
    }
    function pageLater() {
        document.title = 'Assistir mais tarde - YouTube';
        const list = state.later.map(byId).filter(Boolean);
        app.innerHTML = list.length
            ? listPage('Assistir mais tarde', list)
            : empty('fas fa-clock', 'Nada para assistir depois', 'Use os três pontinhos de um vídeo e escolha "Salvar em Assistir mais tarde".', homeBtn);
    }
    function pageLiked() {
        document.title = 'Vídeos que gostei - YouTube';
        const list = state.liked.map(byId).filter(Boolean);
        app.innerHTML = list.length
            ? listPage('Vídeos que gostei', list)
            : empty('fas fa-thumbs-up', 'Nenhum vídeo curtido', 'Curta um vídeo e ele aparece aqui.', homeBtn);
    }
    function pageTrending() {
        document.title = 'Em alta - YouTube';
        const list = longVideos().slice().sort((a, b) => b.views - a.views);
        app.innerHTML = list.length ? listPage('Em alta', list, '', true) : empty('fas fa-fire', 'Nada em alta', 'Publique vídeos para ver o ranking.', uploadBtn);
    }
    function pageExplore(cat) {
        document.title = cat + ' - YouTube';
        const list = longVideos().filter((v) => v.cat === cat);
        app.innerHTML = list.length ? listPage(esc(cat), list) : empty('fas fa-film', 'Nada por aqui ainda', 'Nenhum vídeo nesta categoria.', homeBtn);
    }

    function pageSubs() {
        document.title = 'Inscrições - YouTube';
        const subs = (state.subs || []).map((id) => db.channels.find((c) => c.id === id)).filter(Boolean);
        if (!subs.length) { app.innerHTML = empty('fas fa-circle-play', 'Você não tem inscrições', 'Inscreva-se em canais para ver os vídeos mais recentes aqui.', homeBtn); return; }
        const list = longVideos().filter((v) => state.subs.includes(v.ch));
        app.innerHTML = `<div class="subs-strip">${subs.map((c) => `<a class="sub-chip" href="#/channel/${c.id}">${avatar(c, 'xl')}<span>${esc(c.name)}</span></a>`).join('')}</div>
            <h2 class="section-title">Mais recentes</h2>
            ${list.length ? `<div class="video-grid">${list.map(card).join('')}</div>` : '<p class="meta">Os canais em que você se inscreveu ainda não têm vídeos.</p>'}`;
    }

    function pageResults(q) {
        document.title = q + ' - YouTube';
        if (q) {
            state.searches = [q, ...state.searches.filter((s) => s !== q)].slice(0, 10);
            save('searches');
        }
        const words = norm(q).split(/\s+/).filter(Boolean);
        const list = db.videos.filter((v) => {
            const hay = norm(v.title + ' ' + (v.desc || '') + ' ' + chan(v.ch).name + ' ' + v.cat);
            return words.every((w) => hay.indexOf(w) >= 0);
        });
        const chans = db.channels.filter((c) => { const hay = norm(c.name + ' ' + c.handle); return words.every((w) => hay.indexOf(w) >= 0); });
        const chansHtml = chans.map((c) => `<a class="chan-result" href="#/channel/${c.id}">${avatar(c, 'xxl')}<div><h3>${esc(c.name)}</h3><p>${esc(c.handle)} • ${esc(c.subs)}</p><p>${esc(c.about)}</p></div></a>`).join('');
        app.innerHTML = (list.length || chans.length)
            ? `<div class="list-page"><p class="list-sub">${list.length} resultado${list.length === 1 ? '' : 's'} para “${esc(q)}”</p>${chansHtml}${list.map((v) => hcard(v)).join('')}</div>`
            : empty('fas fa-magnifying-glass', 'Nenhum resultado encontrado', `Não achamos nada para “${esc(q)}”.`, homeBtn);
    }

    function pageNotFound() {
        document.title = 'Página não encontrada - YouTube';
        app.innerHTML = empty('fas fa-compass', 'Esta página não existe', 'Volte para o início e continue assistindo.', homeBtn);
    }

    /* ---------- página: canal ---------- */
    function pageChannel(id) {
        const c = db.channels.find((x) => x.id === id);
        if (!c) { pageNotFound(); return; }
        document.title = c.name + ' - YouTube';
        const vids = longVideos().filter((v) => v.ch === c.id);
        const shorts = shortVideos().filter((v) => v.ch === c.id);
        const subbed = state.subs.includes(c.id);
        app.innerHTML = `<div class="channel-page">
            <div class="banner"><img src="${c.banner || c.avatar || FALLBACK}" ${imgErr} alt=""></div>
            <div class="channel-head">
                ${avatar(c, 'xxl')}
                <div>
                    <h1>${esc(c.name)}</h1>
                    <p>${esc(c.handle)} • ${esc(c.subs)} • ${vids.length + shorts.length} vídeo${vids.length + shorts.length === 1 ? '' : 's'}</p>
                    <p>${esc(c.about)}</p>
                    <button class="sub-btn ${subbed ? 'subscribed' : ''}" id="chSub">${subbed ? '<i class="fas fa-bell"></i>Inscrito' : 'Inscrever-se'}</button>
                    <button class="pill" id="chEdit"><i class="fas fa-pen"></i>Personalizar canal</button>
                </div>
            </div>
            <div class="tabs" role="tablist">
                <button class="tab active" data-tab="videos">Vídeos</button>
                <button class="tab" data-tab="shorts">Shorts</button>
                <button class="tab" data-tab="about">Sobre</button>
            </div>
            <div class="tab-panel show" data-panel="videos">${vids.length ? `<div class="video-grid">${vids.map(card).join('')}</div>` : empty('fas fa-film', 'Sem vídeos', 'Este canal ainda não publicou nada.', `<button class="pill primary" data-open="upload" data-ch="${c.id}"><i class="fas fa-upload"></i>Enviar para este canal</button>`)}</div>
            <div class="tab-panel" data-panel="shorts">${shorts.length ? `<div class="shorts-grid">${shorts.map((s) => `
                <a class="short-thumb" href="#/shorts/${s.id}"><div class="st-img"><img src="${thumbSrc(s)}" ${imgErr} alt="" loading="lazy"></div><b>${esc(s.title)}</b><small>${fmtCount(s.likes == null ? Math.round(s.views * 0.05) : s.likes)} curtidas</small></a>`).join('')}</div>` : empty('fas fa-bolt', 'Sem Shorts', 'Este canal ainda não publicou Shorts.')}</div>
            <div class="tab-panel" data-panel="about"><div class="about-box"><h3>Descrição</h3><p>${esc(c.about)}</p><h3>Detalhes</h3><p>${esc(c.handle)}<br>${esc(c.subs)}<br>Criado ${rel(c.createdAt || Date.now())}</p></div></div>
        </div>`;
        $$('.tab', app).forEach((t) => t.addEventListener('click', () => {
            $$('.tab', app).forEach((x) => x.classList.toggle('active', x === t));
            $$('.tab-panel', app).forEach((p) => p.classList.toggle('show', p.dataset.panel === t.dataset.tab));
        }));
        $('#chEdit').onclick = () => openChannelModal(c);
        $('#chSub').addEventListener('click', (e) => {
            const on = toggleIn(state.subs, c.id);
            save('subs');
            const b = e.currentTarget;
            b.classList.toggle('subscribed', on);
            b.innerHTML = on ? '<i class="fas fa-bell"></i>Inscrito' : 'Inscrever-se';
            toast(on ? 'Inscrição adicionada' : 'Inscrição removida');
        });
    }

    /* ---------- página: shorts ---------- */
    function pageShorts(startId) {
        document.title = 'Shorts - YouTube';
        const list = shortVideos();
        if (!list.length) {
            app.classList.remove('shorts-mode');
            app.innerHTML = empty('fas fa-bolt', 'Ainda não há Shorts', 'Publique um vídeo vertical ou uma foto marcando "Short".', `<button class="pill primary" data-open="upload"><i class="fas fa-upload"></i>Publicar um Short</button>`);
            return;
        }
        const commentCount = (id) => db.comments.filter((c) => c.target === id).length;
        const likesOf = (s) => (s.likes == null ? Math.round(s.views * 0.05) : s.likes);

        app.innerHTML = `<div class="shorts-wrap" id="shorts">${list.map((s, i) => {
            const c = chan(s.ch);
            const isVid = s.type === 'video' && s.media;
            const liked = state.liked.includes(s.id), dis = state.disliked.includes(s.id);
            return `<section class="short ${isVid ? 'is-video' : 'is-image'}" data-i="${i}" data-id="${s.id}">
                <div class="short-card">
                    ${isVid ? `<video class="short-media" src="${s.media}" poster="${thumbSrc(s)}" loop playsinline muted preload="metadata"></video>`
                    : `<img class="short-media" src="${s.media || thumbSrc(s)}" ${imgErr} alt="">`}
                    <div class="short-shade"></div>
                    <div class="short-progress"><span></span></div>
                    <div class="short-info">
                        <div class="short-ch"><a href="#/channel/${c.id}">${avatar(c)}</a><a href="#/channel/${c.id}"><b>${esc(c.handle)}</b></a><button class="sub-btn sm ${state.subs.includes(c.id) ? 'subscribed' : ''}" data-sub="${c.id}">${state.subs.includes(c.id) ? 'Inscrito' : 'Inscrever-se'}</button></div>
                        <p>${esc(s.title)}</p>
                    </div>
                    <div class="pause-icon"><i class="fas fa-pause"></i></div>
                </div>
                <div class="short-actions">
                    <button data-s="like" class="${liked ? 'on' : ''}"><i class="fas fa-thumbs-up"></i><span>${fmtCount(likesOf(s) + (liked ? 1 : 0))}</span></button>
                    <button data-s="dislike" class="${dis ? 'on' : ''}"><i class="fas fa-thumbs-down"></i><span>Não gostei</span></button>
                    <button data-s="comment"><i class="fas fa-comment"></i><span class="cc">${fmtCount(commentCount(s.id))}</span></button>
                    <button data-s="share"><i class="fas fa-share"></i><span>Compartilhar</span></button>
                    ${isVid ? `<button data-s="mute"><i class="fas ${state.shortsMuted ? 'fa-volume-xmark' : 'fa-volume-high'}"></i><span>Som</span></button>` : ''}
                    <button data-s="more"><i class="fas fa-ellipsis"></i><span>Mais</span></button>
                </div>
            </section>`;
        }).join('')}</div>
            <div class="shorts-nav"><button id="shUp" aria-label="Anterior"><i class="fas fa-chevron-up"></i></button><button id="shDown" aria-label="Próximo"><i class="fas fa-chevron-down"></i></button></div>`;

        const wrap = $('#shorts');
        const sections = $$('.short', wrap);
        const vidOf = (sec) => $('video.short-media', sec);

        const activate = (sec, on) => {
            sec.classList.toggle('active', on);
            const vd = vidOf(sec);
            if (!vd) return;
            if (on) {
                vd.muted = state.shortsMuted;
                if (!sec.querySelector('.short-card').classList.contains('paused')) { const p = vd.play(); if (p && p.catch) p.catch(() => { }); }
            } else { vd.pause(); vd.currentTime = 0; }
        };
        const io = new IntersectionObserver((entries) => {
            entries.forEach((en) => {
                activate(en.target, en.isIntersecting);
                if (en.isIntersecting) {
                    try { history.replaceState(null, '', '#/shorts/' + en.target.dataset.id); } catch (e) { /* ignora */ }
                    if (!en.target._viewed) { en.target._viewed = true; api.view(en.target.dataset.id).catch(() => { }); }
                }
            });
        }, { root: wrap, threshold: 0.6 });
        sections.forEach((s) => {
            io.observe(s);
            const vd = vidOf(s);
            if (vd) vd.addEventListener('timeupdate', () => { if (vd.duration) $('.short-progress span', s).style.width = (vd.currentTime / vd.duration * 100) + '%'; });
        });

        if (startId) {
            const idx = Math.max(0, list.findIndex((s) => s.id === startId));
            wrap.style.scrollBehavior = 'auto';
            wrap.scrollTop = idx * wrap.clientHeight;
            requestAnimationFrame(() => { wrap.style.scrollBehavior = ''; });
        }

        wrap.addEventListener('click', (e) => {
            const sec = e.target.closest('.short');
            const s = sec && byId(sec.dataset.id);
            const btn = e.target.closest('[data-s]');
            if (btn && s) {
                const k = btn.dataset.s;
                if (k === 'like' || k === 'dislike') {
                    const sameList = k === 'like' ? state.liked : state.disliked;
                    const otherList = k === 'like' ? state.disliked : state.liked;
                    const on = toggleIn(sameList, s.id);
                    if (on) { const i = otherList.indexOf(s.id); if (i >= 0) otherList.splice(i, 1); }
                    save('liked'); save('disliked');
                    const likeB = $('[data-s="like"]', sec), disB = $('[data-s="dislike"]', sec);
                    likeB.classList.toggle('on', state.liked.includes(s.id));
                    disB.classList.toggle('on', state.disliked.includes(s.id));
                    $('span', likeB).textContent = fmtCount(likesOf(s) + (state.liked.includes(s.id) ? 1 : 0));
                    const ic = $('i', btn); ic.classList.remove('pop'); void btn.offsetWidth; ic.classList.add('pop');
                } else if (k === 'comment') {
                    openCommentsSheet(s.id, (n) => { const el = $('.cc', sec); if (el) el.textContent = fmtCount(n); });
                } else if (k === 'share') copyLink(s);
                else if (k === 'mute') {
                    state.shortsMuted = !state.shortsMuted;
                    $$('video.short-media', wrap).forEach((vd) => { vd.muted = state.shortsMuted; });
                    $$('[data-s="mute"] i', wrap).forEach((i) => { i.className = 'fas ' + (state.shortsMuted ? 'fa-volume-xmark' : 'fa-volume-high'); });
                } else if (k === 'more') {
                    const items = [{ icon: 'fa-share', label: 'Compartilhar', fn: () => copyLink(s) }, '-'];
                    if (s.media) items.push({ icon: 'fa-download', label: 'Baixar arquivo', fn: () => downloadMedia(s) });
                    items.push({ icon: 'fa-pen', label: 'Editar', fn: () => openEditVideo(s) }, { icon: 'fa-trash', label: 'Excluir', fn: () => deleteVideo(s) });
                    e.stopPropagation();
                    openPopup(btn, items);
                }
                return;
            }
            const sub = e.target.closest('[data-sub]');
            if (sub) {
                const on = toggleIn(state.subs, sub.dataset.sub); save('subs');
                $$(`[data-sub="${sub.dataset.sub}"]`, wrap).forEach((b) => { b.classList.toggle('subscribed', on); b.textContent = on ? 'Inscrito' : 'Inscrever-se'; });
                return;
            }
            const cardEl = e.target.closest('.short-card');
            if (cardEl && !e.target.closest('a')) {
                const paused = cardEl.classList.toggle('paused');
                const vd = vidOf(sec);
                if (vd) { if (paused) vd.pause(); else { const p = vd.play(); if (p && p.catch) p.catch(() => { }); } }
                const ic = $('.pause-icon', cardEl);
                ic.innerHTML = `<i class="fas ${paused ? 'fa-pause' : 'fa-play'}"></i>`;
                ic.classList.remove('show'); void ic.offsetWidth; ic.classList.add('show');
            }
        });

        const step = (dir) => wrap.scrollBy({ top: dir * wrap.clientHeight, behavior: 'smooth' });
        $('#shUp').onclick = () => step(-1);
        $('#shDown').onclick = () => step(1);
        const onKey = (e) => {
            if (e.target.matches('input, textarea, select') || $('.modal-back')) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
            if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
        };
        document.addEventListener('keydown', onKey);
        cleanup = () => { io.disconnect(); $$('video', wrap).forEach((vd) => vd.pause()); document.removeEventListener('keydown', onKey); };
    }

    /* ---------- página: vídeo ---------- */
    const viewedNow = new Set();

    function pageWatch(id) {
        const v = byId(id);
        if (!v) { pageNotFound(); return; }
        if (v.short) { location.replace('#/shorts/' + id); return; }
        document.title = v.title + ' - YouTube';

        state.history = [id, ...state.history.filter((x) => x !== id)].slice(0, 100);
        save('history');

        const c = chan(v.ch);
        const isVideo = v.type === 'video' && !!v.media;
        const likesBase = () => (v.likes == null ? Math.round(v.views * 0.045) : v.likes);
        const subbed = state.subs.includes(c.id);
        const isLiked = state.liked.includes(id);
        const isDisliked = state.disliked.includes(id);
        const isLater = state.later.includes(id);

        const relatedList = (mode) => {
            let list = longVideos().filter((x) => x.id !== id);
            if (mode === 'channel') list = list.filter((x) => x.ch === v.ch);
            if (mode === 'related') list = list.filter((x) => x.cat === v.cat);
            return list.length ? list.map(ccard).join('') : '<p class="meta">Nenhum vídeo por aqui.</p>';
        };

        app.innerHTML = `<div class="watch">
            <div class="primary">
                <div class="player paused ${isVideo ? 'real' : ''}" id="player" tabindex="0" aria-label="Player de vídeo">
                    <img class="bg" src="${thumbSrc(v)}" ${imgErr} alt="">
                    ${isVideo ? `<video class="fg" id="vid" src="${v.media}" poster="${thumbSrc(v)}" playsinline preload="metadata"></video>`
                    : `<img class="fg" src="${v.media || thumbSrc(v)}" ${imgErr} alt="${esc(v.title)}">`}
                    <div class="flash" id="flash"><i class="fas fa-play"></i></div>
                    <div class="spinner"></div>
                    <div class="player-error" id="pError"><i class="fas fa-triangle-exclamation"></i><p>Não foi possível reproduzir este vídeo.<br><small>O formato pode não ser aceito pelo navegador. Tente enviar em MP4 (H.264).</small></p></div>
                    <button class="big-replay" id="replay" aria-label="Assistir novamente"><i class="fas fa-rotate-right"></i></button>
                    <div class="controls">
                        <div class="progress" id="progress"><div class="progress-buffer" id="pbuf"></div><div class="progress-fill" id="pfill"></div></div>
                        <div class="ctrl-row">
                            <button id="pPlay" aria-label="Reproduzir"><i class="fas fa-play"></i></button>
                            <div class="vol-wrap">
                                <button id="pMute" aria-label="Som"><i class="fas fa-volume-high"></i></button>
                                ${isVideo ? '<input type="range" id="pVol" class="vol" min="0" max="1" step="0.05" value="1" aria-label="Volume">' : ''}
                            </div>
                            <span class="time" id="ptime">0:00 / ${fmtTime(v.duration)}</span>
                            <span class="spacer"></span>
                            <button class="speed" id="pSpeed" aria-label="Velocidade">1x</button>
                            <button id="pFull" aria-label="Tela cheia"><i class="fas fa-expand"></i></button>
                        </div>
                    </div>
                </div>

                <h1 class="watch-title">${esc(v.title)}</h1>
                <div class="watch-row">
                    <div class="watch-channel">
                        <a href="#/channel/${c.id}">${avatar(c)}</a>
                        <div><a href="#/channel/${c.id}"><b>${esc(c.name)}</b></a><small>${esc(c.subs)}</small></div>
                        <button class="sub-btn ${subbed ? 'subscribed' : ''}" id="wSub">${subbed ? '<i class="fas fa-bell"></i>Inscrito' : 'Inscrever-se'}</button>
                    </div>
                    <div class="watch-actions">
                        <div class="pill-group">
                            <button class="pill ${isLiked ? 'on' : ''}" id="wLike"><i class="${isLiked ? 'fas' : 'fa-regular'} fa-thumbs-up"></i><span id="wLikeN">${fmtCount(likesBase() + (isLiked ? 1 : 0))}</span></button>
                            <span class="sep"></span>
                            <button class="pill ${isDisliked ? 'on' : ''}" id="wDislike" aria-label="Não gostei"><i class="${isDisliked ? 'fas' : 'fa-regular'} fa-thumbs-down"></i></button>
                        </div>
                        <button class="pill" id="wShare"><i class="fas fa-share"></i>Compartilhar</button>
                        <button class="pill ${isLater ? 'on' : ''}" id="wLater"><i class="fas fa-clock"></i><span>${isLater ? 'Salvo' : 'Salvar'}</span></button>
                        <button class="pill icon-only" id="wMore" aria-label="Mais"><i class="fas fa-ellipsis"></i></button>
                    </div>
                </div>

                <div class="desc-box" id="descBox">
                    <b id="descMeta">${fmtViews(v.views)} • ${age(v)}</b>
                    <div class="desc-text">${esc(v.desc || '')}${v.desc ? '\n' : ''}${v.cat ? 'Categoria: ' + esc(v.cat) + '\n' : ''}Deixe seu like e se inscreva no canal!</div>
                    <div class="desc-more" id="descMore">...mais</div>
                </div>

                <div id="comments"></div>
            </div>

            <aside class="secondary">
                <div class="chips" id="relChips">
                    <button class="chip active" data-rel="all">Tudo</button>
                    <button class="chip" data-rel="channel">Do canal</button>
                    <button class="chip" data-rel="related">Relacionados</button>
                </div>
                <div id="relList">${relatedList('all')}</div>
            </aside>
        </div>`;

        /* --- ações --- */
        const likeBtn = $('#wLike'), disBtn = $('#wDislike');
        const pop = (el) => { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); };
        const paintVotes = () => {
            const l = state.liked.includes(id), d = state.disliked.includes(id);
            likeBtn.classList.toggle('on', l); disBtn.classList.toggle('on', d);
            $('i', likeBtn).className = (l ? 'fas' : 'fa-regular') + ' fa-thumbs-up';
            $('i', disBtn).className = (d ? 'fas' : 'fa-regular') + ' fa-thumbs-down';
            $('#wLikeN').textContent = fmtCount(likesBase() + (l ? 1 : 0));
        };
        likeBtn.onclick = () => {
            const on = toggleIn(state.liked, id);
            if (on) state.disliked = state.disliked.filter((x) => x !== id);
            save('liked'); save('disliked'); paintVotes(); pop($('i', likeBtn));
            if (on) toast('Adicionado a Vídeos que gostei');
        };
        disBtn.onclick = () => {
            const on = toggleIn(state.disliked, id);
            if (on) state.liked = state.liked.filter((x) => x !== id);
            save('liked'); save('disliked'); paintVotes(); pop($('i', disBtn));
        };
        $('#wShare').onclick = () => copyLink(v);
        $('#wMore').onclick = (e) => { e.stopPropagation(); openPopup(e.currentTarget, videoMenu(v, null)); };
        $('#wLater').onclick = () => {
            const on = toggleIn(state.later, id);
            save('later');
            $('#wLater').classList.toggle('on', on);
            $('#wLater span').textContent = on ? 'Salvo' : 'Salvar';
            toast(on ? 'Salvo em Assistir mais tarde' : 'Removido de Assistir mais tarde');
        };
        $('#wSub').onclick = (e) => {
            const on = toggleIn(state.subs, c.id);
            save('subs');
            const b = e.currentTarget;
            b.classList.toggle('subscribed', on);
            b.innerHTML = on ? '<i class="fas fa-bell"></i>Inscrito' : 'Inscrever-se';
            if (on) { const bell = $('i', b); if (bell) pop(bell); }
        };
        $('#descBox').onclick = () => {
            const box = $('#descBox');
            box.classList.toggle('open');
            $('#descMore').textContent = box.classList.contains('open') ? 'Mostrar menos' : '...mais';
        };
        $('#relChips').addEventListener('click', (e) => {
            const b = e.target.closest('[data-rel]');
            if (!b) return;
            $$('#relChips .chip').forEach((x) => x.classList.toggle('active', x === b));
            $('#relList').innerHTML = relatedList(b.dataset.rel);
        });

        mountComments($('#comments'), id);

        /* --- player (vídeo de verdade ou "vídeo" de foto simulado) --- */
        const player = $('#player');
        const vid = $('#vid');
        const speeds = [1, 1.25, 1.5, 2, 0.5, 0.75];
        let si = 0, playing = false, muted = !!state.vol.m, volume = state.vol.v;
        let fakeT = 0, fakeTimer = null, clickT = null, countedView = false;
        const fakeDur = v.duration || 1;

        const getDur = () => (isVideo ? (isFinite(vid.duration) && vid.duration ? vid.duration : v.duration || 0) : fakeDur);
        const getT = () => (isVideo ? vid.currentTime : fakeT);

        const paint = () => {
            const d = getDur() || 1;
            $('#pfill').style.width = Math.min(100, getT() / d * 100) + '%';
            $('#ptime').textContent = fmtTime(getT()) + ' / ' + fmtTime(getDur());
        };
        const paintBuffer = () => {
            if (!isVideo || !vid.buffered.length) return;
            const end = vid.buffered.end(vid.buffered.length - 1);
            $('#pbuf').style.width = Math.min(100, end / (getDur() || 1) * 100) + '%';
        };
        const flash = (icon) => {
            const f = $('#flash');
            f.innerHTML = `<i class="fas ${icon}"></i>`;
            f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
        };
        const setPlayIcon = () => { $('#pPlay i').className = 'fas ' + (playing ? 'fa-pause' : 'fa-play'); };
        const countView = () => {
            if (countedView || viewedNow.has(id)) return;
            countedView = true; viewedNow.add(id);
            api.view(id).then((r) => { v.views = r.views; const m = $('#descMeta'); if (m && route.arg === id) m.textContent = fmtViews(v.views) + ' • ' + age(v); }).catch(() => { });
        };
        const uiPlaying = () => { playing = true; player.classList.add('playing'); player.classList.remove('paused', 'ended'); setPlayIcon(); };
        const uiPaused = (ended) => {
            playing = false; player.classList.remove('playing'); player.classList.add('paused');
            if (ended === true) player.classList.add('ended');
            setPlayIcon();
        };

        const play = () => {
            countView();
            if (isVideo) {
                if (vid.ended) vid.currentTime = 0;
                const p = vid.play();
                if (p && p.catch) p.catch(() => uiPaused());
                return;
            }
            if (fakeT >= fakeDur) fakeT = 0;
            uiPlaying();
            clearInterval(fakeTimer);
            fakeTimer = setInterval(() => {
                fakeT += 0.25 * speeds[si];
                if (fakeT >= fakeDur) { fakeT = fakeDur; pause(true); }
                paint();
            }, 250);
        };
        const pause = (ended) => {
            if (isVideo) { vid.pause(); return; }
            clearInterval(fakeTimer);
            uiPaused(ended === true);
        };
        const toggle = () => { if (playing) { pause(); flash('fa-pause'); } else { play(); flash('fa-play'); } };
        const seek = (s) => {
            s = Math.max(0, Math.min(getDur(), s));
            if (isVideo) vid.currentTime = s;
            else { fakeT = s; if (s < fakeDur) player.classList.remove('ended'); }
            paint();
        };
        const setMute = (m) => {
            muted = m;
            if (isVideo) vid.muted = m;
            state.vol.m = m; save('vol');
            const level = isVideo ? (m || volume === 0 ? 0 : volume) : (m ? 0 : 1);
            $('#pMute i').className = 'fas ' + (level === 0 ? 'fa-volume-xmark' : level < 0.5 ? 'fa-volume-low' : 'fa-volume-high');
            const r = $('#pVol'); if (r) r.value = m ? 0 : volume;
        };
        const setVolume = (x) => {
            volume = Math.max(0, Math.min(1, x));
            vid.volume = volume;
            if (volume > 0) state.vol.v = volume;
            setMute(volume === 0);
        };
        const toggleMute = () => {
            if (isVideo && muted && volume === 0) setVolume(state.vol.v || 1);
            else setMute(!muted);
        };
        const setSpeed = () => {
            si = (si + 1) % speeds.length;
            $('#pSpeed').textContent = speeds[si] + 'x';
            if (isVideo) vid.playbackRate = speeds[si];
        };
        const toggleFull = () => {
            if (document.fullscreenElement) document.exitFullscreen();
            else if (player.requestFullscreen) player.requestFullscreen();
        };

        if (isVideo) {
            vid.volume = volume;
            vid.muted = muted;
            vid.addEventListener('play', uiPlaying);
            vid.addEventListener('pause', () => { if (!vid.ended) uiPaused(); });
            vid.addEventListener('ended', () => uiPaused(true));
            vid.addEventListener('timeupdate', paint);
            vid.addEventListener('loadedmetadata', paint);
            vid.addEventListener('durationchange', paint);
            vid.addEventListener('progress', paintBuffer);
            vid.addEventListener('waiting', () => player.classList.add('loading'));
            ['playing', 'canplay', 'seeked'].forEach((ev) => vid.addEventListener(ev, () => player.classList.remove('loading')));
            vid.addEventListener('error', () => { player.classList.remove('loading', 'playing'); player.classList.add('paused', 'failed'); });
        }
        setMute(muted);

        player.addEventListener('click', (e) => {
            if (e.target.closest('.controls, .big-replay')) return;
            clearTimeout(clickT);
            clickT = setTimeout(toggle, 220);
        });
        player.addEventListener('dblclick', (e) => {
            if (e.target.closest('.controls, .big-replay')) return;
            clearTimeout(clickT);
            const r = player.getBoundingClientRect();
            const x = (e.clientX - r.left) / r.width;
            if (x < 0.33) { seek(getT() - 10); flash('fa-backward'); }
            else if (x > 0.66) { seek(getT() + 10); flash('fa-forward'); }
            else toggleFull();
        });
        $('#pPlay').onclick = toggle;
        $('#replay').onclick = () => { seek(0); play(); };
        $('#pMute').onclick = toggleMute;
        const vol = $('#pVol'); if (vol) { vol.value = muted ? 0 : volume; vol.addEventListener('input', () => setVolume(Number(vol.value))); }
        $('#pSpeed').onclick = setSpeed;
        $('#pFull').onclick = toggleFull;

        const prog = $('#progress');
        let scrubbing = false;
        const seekFromEvent = (e) => {
            const r = prog.getBoundingClientRect();
            seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * getDur());
        };
        prog.addEventListener('pointerdown', (e) => { scrubbing = true; prog.setPointerCapture(e.pointerId); seekFromEvent(e); });
        prog.addEventListener('pointermove', (e) => { if (scrubbing) seekFromEvent(e); });
        prog.addEventListener('pointerup', () => { scrubbing = false; });
        prog.addEventListener('pointercancel', () => { scrubbing = false; });

        const onKey = (e) => {
            if (e.target.matches('input:not([type=range]), textarea, select') || e.ctrlKey || e.metaKey || e.altKey || $('.modal-back')) return;
            const k = e.key.toLowerCase();
            if (k === ' ' || k === 'k') { e.preventDefault(); toggle(); }
            else if (e.key === 'ArrowRight') { e.preventDefault(); seek(getT() + 5); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(getT() - 5); }
            else if (k === 'l') seek(getT() + 10);
            else if (k === 'j') seek(getT() - 10);
            else if (e.key === 'ArrowUp' && isVideo) { e.preventDefault(); setVolume(volume + 0.1); }
            else if (e.key === 'ArrowDown' && isVideo) { e.preventDefault(); setVolume(volume - 0.1); }
            else if (/^[0-9]$/.test(k)) seek(getDur() * Number(k) / 10);
            else if (k === 'm') toggleMute();
            else if (k === 'f') toggleFull();
        };
        document.addEventListener('keydown', onKey);
        cleanup = () => {
            clearInterval(fakeTimer); clearTimeout(clickT);
            document.removeEventListener('keydown', onKey);
            if (vid) { vid.pause(); vid.removeAttribute('src'); vid.load(); }
            if (document.fullscreenElement) document.exitFullscreen();
        };

        setTimeout(() => { if (route.name === 'watch' && route.arg === id) play(); }, 300);
    }

    /* ==========================================================
       STUDIO (gerenciar tudo: conteúdo, canais, categorias, backup)
       ========================================================== */
    function pageStudio() {
        document.title = 'YouTube Studio';
        const tok = renderToken;
        let tab = 'content', filter = '';

        const kindLabel = (v) => (v.short ? 'Short' : (v.type === 'video' ? 'Vídeo' : 'Foto'));

        function contentTab() {
            const q = norm(filter);
            const list = db.videos.filter((v) => !q || norm(v.title + ' ' + chan(v.ch).name + ' ' + (v.cat || '')).includes(q));
            return `<div class="st-bar"><input id="stFilter" class="st-filter" placeholder="Filtrar por título, canal ou categoria" value="${esc(filter)}"><button class="pill primary" data-open="upload"><i class="fas fa-upload"></i>Enviar</button></div>
                <div class="table-wrap"><table class="st-table"><thead><tr><th>Conteúdo</th><th>Canal</th><th>Tipo</th><th>Views</th><th>Publicado</th><th></th></tr></thead><tbody>
                ${list.map((v) => `<tr data-id="${v.id}">
                    <td><div class="st-cell"><img src="${thumbSrc(v)}" ${imgErr} alt=""><a href="#/${v.short ? 'shorts' : 'watch'}/${v.id}">${esc(v.title)}</a></div></td>
                    <td>${esc(chan(v.ch).name)}</td><td>${kindLabel(v)}</td><td>${fmtCount(v.views)}</td><td>${age(v)}</td>
                    <td class="st-actions"><button class="icon-btn" data-st="edit" aria-label="Editar"><i class="fas fa-pen"></i></button><button class="icon-btn" data-st="del" aria-label="Excluir"><i class="fas fa-trash"></i></button></td></tr>`).join('')
                || '<tr><td colspan="6" class="st-none">Nada encontrado.</td></tr>'}
                </tbody></table></div>`;
        }
        function channelsTab() {
            return `<div class="st-bar"><span class="meta">${db.channels.length} canal(is)</span><button class="pill primary" data-open="channel"><i class="fas fa-user-plus"></i>Novo canal</button></div>
                ${db.channels.map((c) => `<div class="st-row" data-ch="${c.id}">${avatar(c, 'xl')}<div class="st-grow"><b>${esc(c.name)}</b><br><small>${esc(c.handle)} • ${esc(c.subs)} • ${db.videos.filter((v) => v.ch === c.id).length} item(ns)</small></div>
                    <button class="pill" data-st="edit-ch"><i class="fas fa-pen"></i>Editar</button></div>`).join('')}`;
        }
        function catsTab() {
            return `<div class="st-bar"><form id="catForm" class="st-inline"><input id="catNew" maxlength="40" placeholder="Nova categoria"><button class="pill primary" type="submit">Adicionar</button></form></div>
                <div class="cat-list">${db.categories.map((c) => `<span class="cat-pill">${esc(c)} <small>(${db.videos.filter((v) => v.cat === c).length})</small><button data-cat-del="${esc(c)}" aria-label="Remover"><i class="fas fa-xmark"></i></button></span>`).join('') || '<p class="meta">Nenhuma categoria.</p>'}</div>
                <p class="meta st-note">Remover uma categoria não apaga os vídeos dela; eles só ficam sem categoria na lista.</p>`;
        }
        function backupTab(stats) {
            return `<div class="st-card"><h3>Armazenamento</h3><p>${stats ? `${stats.files} arquivo(s) • <b>${fmtBytes(stats.bytes)}</b> no servidor` : 'Não foi possível ler o uso agora.'}</p>
                <button class="pill" id="stClean"><i class="fas fa-broom"></i>Apagar arquivos que ninguém usa mais</button></div>
                <div class="st-card"><h3>Backup</h3><p>Baixa um arquivo <b>.tar</b> com o banco de dados e todas as fotos e vídeos. Guarde em lugar seguro.</p>
                <a class="pill primary" id="stBackup" href="${api.backupUrl()}" download><i class="fas fa-download"></i>Baixar backup</a></div>
                <div class="st-card"><h3>Restaurar</h3><p>Envia um backup e <b>substitui</b> os dados atuais pelos dele.</p>
                <button class="pill" id="stRestoreBtn"><i class="fas fa-upload"></i>Escolher arquivo .tar</button><input type="file" id="stRestoreFile" accept=".tar" hidden><p class="up-status" id="stRestoreStatus"></p></div>
                <div class="st-card warn"><h3>Atenção ao hospedar</h3><p>Em hospedagens gratuitas (como o Render grátis) o disco é <b>apagado</b> a cada reinício ou novo deploy. Se for o seu caso, faça backup com frequência ou use um disco persistente e aponte a variável <code>DATA_DIR</code> para ele.</p></div>`;
        }

        const tabs = [['content', 'Conteúdo'], ['channels', 'Canais'], ['cats', 'Categorias'], ['backup', 'Backup e espaço']];
        let stats = null;

        function draw() {
            if (tok !== renderToken) return;
            app.innerHTML = `<div class="studio">
                <h1>YouTube Studio</h1>
                <div class="st-stats">
                    <div><b>${longVideos().length}</b><span>vídeos e fotos</span></div>
                    <div><b>${shortVideos().length}</b><span>shorts</span></div>
                    <div><b>${db.channels.length}</b><span>canais</span></div>
                    <div><b>${db.comments.length}</b><span>comentários</span></div>
                    <div><b>${fmtCount(db.videos.reduce((a, v) => a + v.views, 0))}</b><span>visualizações</span></div>
                </div>
                <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${tab === k ? 'active' : ''}" data-st-tab="${k}">${l}</button>`).join('')}</div>
                <div id="stBody">${tab === 'content' ? contentTab() : tab === 'channels' ? channelsTab() : tab === 'cats' ? catsTab() : backupTab(stats)}</div>
            </div>`;
            bind();
        }

        function bind() {
            $$('[data-st-tab]', app).forEach((b) => b.addEventListener('click', async () => {
                tab = b.dataset.stTab;
                if (tab === 'backup') { try { stats = await api.stats(); } catch (e) { stats = null; } }
                draw();
            }));
            const bindFilter = () => {
                const f = $('#stFilter');
                if (!f) return;
                f.addEventListener('input', () => {
                    filter = f.value;
                    $('#stBody').innerHTML = contentTab();
                    const nf = $('#stFilter');
                    nf.focus(); nf.setSelectionRange(filter.length, filter.length);
                    bindFilter(); bindRows();
                });
            };
            bindFilter();
            bindRows();
            const cf = $('#catForm');
            if (cf) cf.addEventListener('submit', async (e) => {
                e.preventDefault();
                const name = $('#catNew').value.trim();
                if (!name || db.categories.includes(name)) return;
                try { const r = await api.setCategories([...db.categories, name]); db.categories = r.categories; renderSide(); draw(); } catch (er) { toast('Erro: ' + er.message); }
            });
            $$('[data-cat-del]', app).forEach((b) => b.addEventListener('click', async () => {
                const name = b.dataset.catDel;
                if (!confirm(`Remover a categoria "${name}"?`)) return;
                try { const r = await api.setCategories(db.categories.filter((c) => c !== name)); db.categories = r.categories; renderSide(); draw(); } catch (er) { toast('Erro: ' + er.message); }
            }));
            const clean = $('#stClean');
            if (clean) clean.onclick = async () => {
                try { const r = await api.cleanup(); toast(r.removed ? `${r.removed} arquivo(s) apagado(s)` : 'Nada para limpar'); stats = await api.stats(); draw(); } catch (e) { toast('Erro: ' + e.message); }
            };
            const rb = $('#stRestoreBtn');
            if (rb) {
                rb.onclick = () => $('#stRestoreFile').click();
                $('#stRestoreFile').addEventListener('change', async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    if (!confirm(`Restaurar "${file.name}"?\nTodos os dados atuais serão substituídos pelos do backup.`)) { e.target.value = ''; return; }
                    const st = $('#stRestoreStatus');
                    try {
                        const r = await api.restore(file, (p) => { st.textContent = 'Enviando… ' + Math.round(p * 100) + '%'; });
                        st.textContent = `Pronto! ${r.videos} vídeos, ${r.channels} canais, ${r.files} arquivos.`;
                        await loadState(); renderSide(); renderNotifs();
                        toast('Backup restaurado');
                        stats = await api.stats(); draw();
                    } catch (er) { st.textContent = 'Falhou: ' + er.message; toast('Erro: ' + er.message); }
                });
            }
        }
        function bindRows() {
            $$('[data-st="edit"], [data-st="del"]', app).forEach((b) => b.addEventListener('click', () => {
                const v = byId(b.closest('tr').dataset.id);
                if (!v) return;
                if (b.dataset.st === 'edit') openEditVideo(v); else deleteVideo(v);
            }));
            $$('[data-st="edit-ch"]', app).forEach((b) => b.addEventListener('click', () => { const c = db.channels.find((x) => x.id === b.closest('.st-row').dataset.ch); if (c) openChannelModal(c); }));
        }

        draw();
    }

    /* ==========================================================
       INÍCIO
       ========================================================== */
    async function loadState() {
        const s = await api.state();
        db.channels = s.channels; db.videos = s.videos; db.comments = s.comments; db.categories = s.categories;
        serverInfo = { authRequired: s.authRequired, maxUploadMB: s.maxUploadMB };
        if (state.subs === null) { state.subs = db.channels[0] ? [db.channels[0].id] : []; save('subs'); }
    }

    async function init() {
        applyTheme();
        renderMe();
        route = parseHash();
        applyLayout();
        app.innerHTML = skeleton();
        try {
            await loadState();
        } catch (e) {
            app.innerHTML = empty('fas fa-plug', 'Não consegui falar com o servidor', esc(e.message), '<button class="pill primary" onclick="location.reload()">Tentar de novo</button>');
            return;
        }
        renderSide();
        renderNotifs();
        router();
    }
    init();
})();