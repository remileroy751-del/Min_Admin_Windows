(() => {
'use strict';

const MAX_PRODUCTS = 10;
const api = window.api;

/* ============================================================ état */
const S = {
  cfg: null, settings: null, content: null,
  orders: [], messages: [],
  page: 'dashboard', ordersTab: 0, selOrder: null, selMsg: null,
  errors: { site: null, orders: null, messages: null },
  imgVer: Date.now(), loading: false
};
let M = null; // état de la fenêtre d'édition (produit / service)

/* ============================================================ utilitaires */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = (s) => String(s || '').replace(/\D/g, '');

function fmtCreated(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDelivery(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s || '';
}
const waUrl = (phone, msg) => 'https://wa.me/' + digits(phone) + '?text=' + encodeURIComponent(msg);
const imgUrl = (p) => (p && S.content ? `${S.content.siteUrl}/${p}?v=${S.imgVer}` : '');

const ICON = {
  dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM13 3v6h8V3zM3 21h8v-6H3z"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  box: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2M3 13h18"/>',
  cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 002 1.6h7.7a2 2 0 002-1.5L21 8H6"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  chat: '<path d="M21 12a8 8 0 01-11.6 7.1L3 21l1.9-6.2A8 8 0 1121 12z"/>',
  ext: '<path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h5"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>'
};
const ico = (n) => `<svg class="i" viewBox="0 0 24 24">${ICON[n]}</svg>`;

function toast(msg, kind = 'info', ms = 4200) {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

async function withBusy(text, fn) {
  $('#busy-text').textContent = text;
  $('#busy').classList.remove('hidden');
  try { return await fn(); }
  catch (e) { toast(e.message || String(e), 'err', 7000); return undefined; }
  finally { $('#busy').classList.add('hidden'); }
}

function confirmDialog({ title, text, confirmLabel = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-back" data-action="noop"><div class="modal sm" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${esc(title)}</h2></div>
      <div class="modal-body"><p style="margin:0">${esc(text)}</p></div>
      <div class="modal-foot">
        <button class="btn btn-light" id="cf-no">Annuler</button>
        <button class="btn ${danger ? 'btn-primary' : 'btn-navy'}" id="cf-yes">${esc(confirmLabel)}</button>
      </div></div></div>`;
    const done = (v) => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    document.addEventListener('keydown', onKey);
    $('#cf-no').onclick = () => done(false);
    $('#cf-yes').onclick = () => done(true);
    $('#cf-yes').focus();
  });
}

/* ============================================================ données */
const newCount = () => S.orders.filter((o) => o.status === 0).length;
const unreadCount = () => S.messages.filter((m) => !m.read).length;
const countStatus = (st) => S.orders.filter((o) => o.status === st).length;

function applyInbox(r, announce) {
  if (!r) return;
  if (r.orders) S.orders = r.orders;
  if (r.messages) S.messages = r.messages;
  S.errors.orders = r.errors ? r.errors.orders : null;
  S.errors.messages = r.errors ? r.errors.messages : null;
  if (announce) {
    const fo = r.freshOrders || [], fm = r.freshMessages || [];
    if (fo.length === 1) toast(`🔔 Nouvelle commande de ${fo[0].prenom}`, 'ok', 6000);
    else if (fo.length > 1) toast(`🔔 ${fo.length} nouvelles commandes`, 'ok', 6000);
    if (fm.length === 1) toast(`✉ Nouveau message de ${fm[0].nom}`, 'ok', 6000);
    else if (fm.length > 1) toast(`✉ ${fm.length} nouveaux messages`, 'ok', 6000);
  }
  renderSidebar();
  if (['dashboard', 'orders', 'messages'].includes(S.page)) renderPage();
}

async function reloadAll() {
  S.loading = true;
  const [site, inbox] = await Promise.allSettled([api.call('loadSite'), api.call('refreshInbox')]);
  if (site.status === 'fulfilled') { S.content = site.value; S.errors.site = null; S.imgVer = Date.now(); }
  else S.errors.site = site.reason.message;
  if (inbox.status === 'fulfilled') applyInbox(inbox.value, false);
  else S.errors.orders = S.errors.messages = inbox.reason.message;
  S.loading = false;
  renderSidebar(); renderTop(); renderPage();
}

/* ============================================================ navigation */
const PAGES = {
  dashboard: { title: 'Tableau de bord', sub: "Vue d'ensemble de votre activité" },
  home: { title: "Accueil du site", sub: "Texte de présentation et numéro de téléphone principal" },
  products: { title: 'Produits', sub: 'Catalogue affiché sur la page « Nos produits »' },
  services: { title: 'Services', sub: 'Prestations affichées sur la page « Nos services »' },
  orders: { title: 'Commandes', sub: 'Commandes à livrer reçues depuis le site' },
  messages: { title: 'Messagerie', sub: 'Messages envoyés par les visiteurs via « Nous écrire »' },
  settings: { title: 'Réglages', sub: "Connexion au site et préférences de l'application" }
};

function go(page) {
  if (!S.cfg || !S.cfg.connected) page = 'settings';
  S.page = page;
  if (page === 'messages') {
    if (!S.messages.find((m) => m.id === S.selMsg)) S.selMsg = S.messages.length ? S.messages[0].id : null;
    if (S.selMsg) markReadLocal(S.selMsg);
  }
  renderSidebar(); renderTop(); renderPage();
}

function renderSidebar() {
  const item = (id, label, icon, badge) => `<button class="nav-item ${S.page === id ? 'active' : ''}" data-action="nav" data-page="${id}">
      ${ico(icon)}<span class="grow">${label}</span>${badge ? `<span class="badge">${badge}</span>` : ''}</button>`;
  const connected = S.cfg && S.cfg.connected;
  $('#sidebar').innerHTML = `
    <div class="brand"><img src="logo.png" alt=""><div><b>HARRWAMA MIND</b><span>Administration</span></div></div>
    <nav class="nav">
      <div class="nav-label">Pilotage</div>
      ${item('dashboard', 'Tableau de bord', 'dashboard')}
      <div class="nav-label">Contenu du site</div>
      ${item('home', 'Accueil du site', 'home')}
      ${item('products', 'Produits', 'box')}
      ${item('services', 'Services', 'briefcase')}
      <div class="nav-label">Clients</div>
      ${item('orders', 'Commandes', 'cart', newCount() || '')}
      ${item('messages', 'Messagerie', 'mail', unreadCount() || '')}
    </nav>
    <div class="nav" style="flex:none;padding-top:0">${item('settings', 'Réglages', 'settings')}</div>
    <div class="side-foot"><div class="conn"><span class="dot ${connected ? 'on' : ''}"></span>
      <span>${connected ? esc(S.cfg.siteUrl) : 'Non connecté'}</span></div></div>`;
}

function renderTop() {
  const p = PAGES[S.page];
  const connected = S.cfg && S.cfg.connected;
  $('#topbar').innerHTML = `<div><h1>${p.title}</h1><p>${p.sub}</p></div><div class="grow"></div>
    ${connected ? `<button class="btn btn-light" data-action="open-site">${ico('ext')} Voir le site</button>
    <button class="btn btn-navy" data-action="refresh">${ico('refresh')} Actualiser</button>` : ''}`;
}

function renderPage() {
  const el = $('#content');
  const scroll = el.scrollTop;
  const siteBound = ['home', 'products', 'services'].includes(S.page);
  let html = '';
  if (S.errors.site && siteBound) {
    html += `<div class="banner"><span class="grow">${esc(S.errors.site)}</span><button class="btn btn-light" data-action="refresh">Réessayer</button></div>`;
  }
  switch (S.page) {
    case 'dashboard': html += pageDashboard(); break;
    case 'home': html += S.content ? pageHome() : pageLoading(); break;
    case 'products': html += S.content ? pageItems('products') : pageLoading(); break;
    case 'services': html += S.content ? pageItems('services') : pageLoading(); break;
    case 'orders': html += pageOrders(); break;
    case 'messages': html += pageMessages(); break;
    default: html += pageSettings();
  }
  el.innerHTML = html;
  el.scrollTop = scroll;
  if (S.page === 'home') updateHomeButtons();
  if (S.page === 'settings') loadSettingsValues();
}

const pageLoading = () => `<div class="empty">${S.errors.site ? '' : 'Chargement du site…'}</div>`;

/* ============================================================ tableau de bord */
function pageDashboard() {
  const c = S.content;
  const stat = (page, tone, icon, val, lab) => `<button class="stat" data-action="nav" data-page="${page}">
      <span class="stat-ico ${tone}">${ico(icon)}</span><span class="stat-val">${val}</span><span class="stat-lab">${lab}</span></button>`;
  const recentOrders = S.orders.slice(0, 5).map((o) => `<li data-action="open-order" data-id="${esc(o.id)}">
      <span class="chip s${o.status}">${['Nouvelle', 'En cours', 'Livrée'][o.status]}</span>
      <span class="main"><b>${esc(o.prenom)}</b><small>${esc(o.quantite)} × ${esc(o.produit)} · livraison le ${esc(fmtDelivery(o.dateLivraison))}</small></span></li>`).join('');
  const recentMsgs = S.messages.slice(0, 5).map((m) => `<li data-action="open-msg" data-id="${esc(m.id)}">
      <span class="unread ${m.read ? 'off' : ''}"></span>
      <span class="main"><b>${esc(m.nom)}</b><small>${esc(m.message)}</small></span></li>`).join('');
  return `
    ${S.errors.orders ? `<div class="banner"><span class="grow">Commandes : ${esc(S.errors.orders)}</span></div>` : ''}
    <div class="stats">
      ${stat('orders', 't-red', 'cart', countStatus(0), 'Nouvelles commandes')}
      ${stat('orders', 't-amber', 'cart', countStatus(1), 'En cours de traitement')}
      ${stat('orders', 't-green', 'check', countStatus(2), 'Commandes livrées')}
      ${stat('messages', 't-blue', 'mail', unreadCount(), 'Messages non lus')}
      ${stat('products', 't-navy', 'box', c ? `${c.products.length} / ${MAX_PRODUCTS}` : '—', 'Produits en catalogue')}
      ${stat('services', 't-navy', 'briefcase', c ? c.services.length : '—', 'Services publiés')}
    </div>
    <div class="grid-2">
      <div class="card"><h2>Dernières commandes</h2><p class="sub">Touchez une commande pour la traiter.</p>
        ${recentOrders ? `<ul class="list-plain">${recentOrders}</ul>` : '<div class="empty">Aucune commande pour le moment.</div>'}</div>
      <div class="stack">
        <div class="card"><h2>Derniers messages</h2><p class="sub">Envoyés via « Nous écrire ».</p>
          ${recentMsgs ? `<ul class="list-plain">${recentMsgs}</ul>` : '<div class="empty">Aucun message pour le moment.</div>'}</div>
        ${c ? `<div class="card"><h2>Votre site</h2><p class="sub">${esc(c.siteUrl.replace('https://', ''))}</p>
          <div class="plabel">Téléphone principal</div><b style="font-size:18px;color:var(--navy)">${esc(c.phone)}</b></div>` : ''}
      </div>
    </div>`;
}

/* ============================================================ accueil du site */
let homeBase = null, phoneBase = null;
function pageHome() {
  const c = S.content;
  homeBase = { titre: c.home.titre, texte: c.home.texte };
  phoneBase = c.phone;
  return `<div class="grid-2">
    <div class="card"><h2>Texte de la page d'accueil</h2><p class="sub">Le grand titre et le paragraphe affichés en haut du site.</p>
      <label class="lab" for="home-titre">Grand titre</label>
      <textarea id="home-titre" data-field="home" rows="2">${esc(c.home.titre)}</textarea>
      <div class="hint">Entourez des mots avec des étoiles pour les mettre en couleur : *votre santé*</div>
      <label class="lab" for="home-texte">Texte sous le grand titre</label>
      <textarea id="home-texte" data-field="home" rows="6">${esc(c.home.texte)}</textarea>
      <div class="actions"><button class="btn btn-primary btn-lg" id="home-save" data-action="save-home">Valider et mettre à jour le site</button></div>
    </div>
    <div class="stack">
      <div class="card"><div class="plabel">Aperçu</div>
        <div class="preview"><h3 id="pv-titre"></h3><p id="pv-texte"></p></div></div>
      <div class="card"><h2>Téléphone principal du site</h2>
        <p class="sub">Utilisé par le bouton WhatsApp, le lien de contact en bas de page et les boutons « Contacter pour ce service ». Il reste cliquable sur le site.</p>
        <label class="lab" for="phone">Numéro (WhatsApp)</label>
        <input type="tel" id="phone" data-field="phone" value="${esc(c.phone)}">
        <div class="hint">Format international : + puis l'indicatif et le numéro. Ex : +226 70 70 70 21</div>
        <div class="hint" id="phone-link"></div>
        <div class="actions"><button class="btn btn-navy" id="phone-save" data-action="save-phone">Valider et mettre à jour le site</button></div>
      </div>
    </div></div>`;
}

function updateHomeButtons() {
  const t = $('#home-titre'), x = $('#home-texte'), ph = $('#phone');
  if (!t) return;
  $('#pv-titre').innerHTML = esc(t.value).replace(/\*([^*]+)\*/g, '<em>$1</em>');
  $('#pv-texte').textContent = x.value;
  $('#home-save').disabled = (t.value.trim() === homeBase.titre && x.value.trim() === homeBase.texte) || !t.value.trim() || !x.value.trim();
  $('#phone-save').disabled = ph.value.trim() === phoneBase.trim();
  $('#phone-link').textContent = 'Lien WhatsApp : wa.me/' + digits(ph.value);
}

/* ============================================================ produits & services */
function pageItems(kind) {
  const isP = kind === 'products';
  const list = S.content[kind];
  const full = isP && list.length >= MAX_PRODUCTS;
  const cards = list.map((it, i) => {
    const name = isP ? it.nom : it.titre;
    const tag = isP ? it.categorie : it.domaine;
    return `<article class="item-card">
      <div class="item-img">${it.image ? `<img src="${esc(imgUrl(it.image))}" alt="">` : ico('image')}</div>
      <div class="item-body">${tag ? `<span class="item-tag">${esc(tag)}</span>` : ''}
        <h3>${esc(name)}</h3>${isP && it.prix ? `<div class="item-price">${esc(it.prix)}</div>` : ''}
        <p>${esc(it.description)}</p></div>
      <div class="item-actions">
        <button class="btn btn-light" data-action="edit-item" data-kind="${kind}" data-i="${i}">${ico('edit')} Modifier</button>
        <button class="btn btn-danger" data-action="delete-item" data-kind="${kind}" data-i="${i}">${ico('trash')} Supprimer</button>
      </div></article>`;
  }).join('');
  return `<div class="toolbar">
      <span class="count">${isP ? `${list.length} / ${MAX_PRODUCTS} produits` : `${list.length} service${list.length > 1 ? 's' : ''}`}</span>
      <span class="grow" style="flex:1"></span>
      <button class="btn btn-primary" data-action="add-item" data-kind="${kind}" ${full ? 'disabled title="Maximum atteint"' : ''}>${ico('plus')} ${isP ? 'Ajouter un produit' : 'Ajouter un service'}</button>
    </div>
    ${list.length ? `<div class="items">${cards}</div>` : `<div class="card empty">Aucun ${isP ? 'produit' : 'service'} publié pour le moment.</div>`}`;
}

async function prepareImage(file, maxSide = 1200) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  const dataUrl = cv.toDataURL('image/jpeg', 0.85);
  return { dataUrl, base64: dataUrl.split(',')[1] };
}

function openEditor(kind, index) {
  const isP = kind === 'products';
  const cur = index == null ? null : S.content[kind][index];
  M = { kind, index, orig: cur ? { ...cur } : null, b64: null, preview: cur && cur.image ? imgUrl(cur.image) : '' };
  const v = (k) => esc(cur ? cur[k] : '');
  $('#modal-root').innerHTML = `<div class="modal-back" data-action="noop"><div class="modal" role="dialog" aria-modal="true">
    <div class="modal-head"><h2>${cur ? 'Modifier' : 'Ajouter'} ${isP ? 'le produit' : 'le service'}</h2><button class="icon-btn" data-action="modal-close" aria-label="Fermer">×</button></div>
    <div class="modal-body">
      <div class="plabel">Photo</div>
      <div class="photo-box" id="photo-box">${photoInner()}</div>
      <div class="photo-actions"><button class="btn btn-light" data-action="pick-photo">${ico('image')} <span id="photo-btn-label">${M.preview ? 'Changer la photo' : 'Choisir une photo'}</span></button>
        <span class="hint" style="margin:0">Glissez-déposez une image ici. Elle sera réduite et optimisée automatiquement.</span></div>
      <input type="file" id="file-input" accept="image/*" hidden>
      <label class="lab" for="f-name">${isP ? 'Nom du produit' : 'Titre du service'}</label>
      <input type="text" id="f-name" value="${isP ? v('nom') : v('titre')}">
      <label class="lab" for="f-tag">${isP ? 'Catégorie (facultatif)' : 'Domaine (facultatif, ex : Finance)'}</label>
      <input type="text" id="f-tag" value="${isP ? v('categorie') : v('domaine')}">
      ${isP ? `<label class="lab" for="f-price">Prix (facultatif)</label><input type="text" id="f-price" value="${v('prix')}">` : ''}
      <label class="lab" for="f-desc">Petite description</label>
      <textarea id="f-desc" rows="4">${v('description')}</textarea>
    </div>
    <div class="modal-foot"><button class="btn btn-light" data-action="modal-close">Annuler</button>
      <button class="btn btn-primary btn-lg" data-action="modal-save">Valider et mettre à jour le site</button></div>
  </div></div>`;
  setTimeout(() => { const f = $('#f-name'); if (f) f.focus(); }, 50);
}
const photoInner = () => (M && M.preview ? `<img src="${esc(M.preview)}" alt="">` : `${ico('image')}<span>Aucune photo</span>`);

async function takeFile(file) {
  if (!file || !file.type.startsWith('image/')) { toast('Choisissez un fichier image (JPG, PNG…).', 'err'); return; }
  try {
    const r = await prepareImage(file);
    M.b64 = r.base64; M.preview = r.dataUrl;
    $('#photo-box').innerHTML = photoInner();
    $('#photo-btn-label').textContent = 'Choisir une autre photo';
  } catch (e) { toast('Image illisible : ' + (e.message || ''), 'err'); }
}

async function saveEditor() {
  if (!M) return;
  const isP = M.kind === 'products';
  const name = $('#f-name').value.trim();
  if (!name) { toast(isP ? 'Le nom du produit est obligatoire.' : 'Le titre du service est obligatoire.', 'err'); $('#f-name').focus(); return; }
  const tag = $('#f-tag').value.trim(), desc = $('#f-desc').value.trim();
  const price = isP ? $('#f-price').value.trim() : '';
  const item = isP ? { nom: name, categorie: tag, prix: price, description: desc } : { titre: name, domaine: tag, description: desc };

  if (M.orig && !M.b64) {
    const o = M.orig;
    const same = isP ? (o.nom === name && o.categorie === tag && o.prix === price && o.description === desc)
                     : (o.titre === name && o.domaine === tag && o.description === desc);
    if (same) { closeModal(); return; }
  }
  const m = M;
  closeModal();
  await withBusy('Publication en cours…', async () => {
    let r;
    if (m.kind === 'products') {
      r = m.orig ? await api.call('editProduct', { nom: m.orig.nom, image: m.orig.image }, item, m.b64)
                 : await api.call('addProduct', item, m.b64);
      S.content.products = r.products;
    } else {
      r = m.orig ? await api.call('editService', { titre: m.orig.titre, image: m.orig.image }, item, m.b64)
                 : await api.call('addService', item, m.b64);
      S.content.services = r.services;
    }
    S.imgVer = Date.now();
    toast('Site mis à jour ✔', 'ok');
    renderPage();
  });
}

function closeModal() { M = null; $('#modal-root').innerHTML = ''; }

async function deleteItem(kind, i) {
  const it = S.content[kind][i];
  if (!it) return;
  const name = kind === 'products' ? it.nom : it.titre;
  const ok = await confirmDialog({ title: kind === 'products' ? 'Supprimer ce produit ?' : 'Supprimer ce service ?',
    text: `« ${name} » sera retiré du site immédiatement.`, confirmLabel: 'Supprimer', danger: true });
  if (!ok) return;
  await withBusy('Publication en cours…', async () => {
    const r = kind === 'products'
      ? await api.call('deleteProduct', { nom: it.nom, image: it.image })
      : await api.call('deleteService', { titre: it.titre, image: it.image });
    S.content[kind] = r[kind];
    toast('Supprimé et site mis à jour ✔', 'ok');
    renderPage();
  });
}

/* ============================================================ commandes */
function pageOrders() {
  const labels = ['Nouvelles', 'En cours', 'Livrées'];
  const list = S.orders.filter((o) => o.status === S.ordersTab);
  if (!list.find((o) => o.id === S.selOrder)) S.selOrder = list.length ? list[0].id : null;
  const rows = list.map((o) => `<div class="row-item ${o.id === S.selOrder ? 'sel' : ''}" data-action="sel-order" data-id="${esc(o.id)}">
      <span class="main"><b>${esc(o.prenom)}</b><small>${esc(o.quantite)} × ${esc(o.produit)}</small><small>Livraison souhaitée le ${esc(fmtDelivery(o.dateLivraison))}</small></span></div>`).join('');
  const sel = S.orders.find((o) => o.id === S.selOrder);
  return `${S.errors.orders ? `<div class="banner"><span class="grow">${esc(S.errors.orders)}</span><button class="btn btn-light" data-action="refresh">Réessayer</button></div>` : ''}
    <div class="tabs">${labels.map((l, i) => `<button class="tab ${S.ordersTab === i ? 'active' : ''}" data-action="orders-tab" data-tab="${i}">${l}<span class="n">${countStatus(i)}</span></button>`).join('')}</div>
    <div class="split">
      <div class="list">${rows || `<div class="empty">${['Aucune nouvelle commande.', 'Aucune commande en cours.', 'Aucune commande livrée.'][S.ordersTab]}</div>`}</div>
      <div class="card detail">${sel ? orderDetail(sel) : '<div class="empty-detail">' + ico('cart') + '<span>Sélectionnez une commande pour voir les détails.</span></div>'}</div>
    </div>`;
}

function orderDetail(o) {
  const acts = o.status === 0
    ? `<button class="btn btn-navy btn-lg" data-action="order-status" data-id="${esc(o.id)}" data-st="1">Prendre en charge</button>`
    : o.status === 1
      ? `<button class="btn btn-primary btn-lg" data-action="order-status" data-id="${esc(o.id)}" data-st="2">${ico('check')} Marquer comme livrée</button>
         <button class="btn btn-light" data-action="order-status" data-id="${esc(o.id)}" data-st="0">Remettre dans « Nouvelles »</button>`
      : `<button class="btn btn-light" data-action="order-status" data-id="${esc(o.id)}" data-st="1">Remettre « En cours »</button>
         <button class="btn btn-danger" data-action="delete-order" data-id="${esc(o.id)}">${ico('trash')} Supprimer la commande</button>`;
  return `<div class="detail-head">
      <div class="thumb">${o.produitImage ? `<img src="${esc(imgUrl(o.produitImage))}" alt="">` : ico('image')}</div>
      <div><span class="chip s${o.status}">${['Nouvelle commande', 'En cours de traitement', 'Livrée'][o.status]}</span>
        <h2 style="margin-top:8px">${esc(o.produit)}</h2>
        <div class="muted">${o.produitPrix ? esc(o.produitPrix) + ' · ' : ''}Quantité : <b>${esc(o.quantite)}</b> boîte(s)</div></div></div>
    <dl class="kv">
      <dt>Client</dt><dd style="font-size:18px">${esc(o.prenom)}</dd>
      <dt>Pays</dt><dd>${esc(o.pays)}</dd>
      <dt>Adresse de livraison</dt><dd>${esc(o.adresse)}</dd>
      <dt>Date souhaitée</dt><dd>${esc(fmtDelivery(o.dateLivraison))}</dd>
      <dt>Paiement</dt><dd>À la livraison</dd>
      <dt>Commande reçue le</dt><dd>${esc(fmtCreated(o.createdAt))}</dd>
    </dl>
    <button class="btn btn-wa" data-action="wa-order" data-id="${esc(o.id)}">${ico('chat')} ${esc(o.whatsapp)} — Ouvrir WhatsApp</button>
    <div class="hint">Un message de confirmation prêt à envoyer est préparé pour fixer le rendez-vous de livraison.</div>
    <div class="detail-actions">${acts}</div>`;
}

async function orderStatus(id, st) {
  const o = S.orders.find((x) => x.id === id);
  if (!o) return;
  try {
    await api.call('setOrderStatus', { id, status: st });
    o.status = st;
    S.ordersTab = st;
    S.selOrder = id;
    renderSidebar(); renderPage();
  } catch (e) { toast(e.message, 'err'); }
}

function openWaOrder(id) {
  const o = S.orders.find((x) => x.id === id);
  if (!o) return;
  const msg = `Bonjour ${o.prenom}, ici HARRWAMA MIND. Nous avons bien reçu votre commande : ${o.quantite} boîte(s) de ${o.produit}. ` +
    `Vous souhaitez être livré(e) le ${fmtDelivery(o.dateLivraison)} à : ${o.adresse}. ` +
    `Pouvez-vous confirmer, afin que nous fixions ensemble l'heure du rendez-vous de livraison ? Merci !`;
  api.call('openExternal', { url: waUrl(o.whatsapp, msg) }).catch((e) => toast(e.message, 'err'));
  if (o.status === 0) { orderStatus(id, 1); toast('Commande passée « en cours de traitement ».', 'info'); }
}

async function deleteOrder(id) {
  const o = S.orders.find((x) => x.id === id);
  if (!o) return;
  const ok = await confirmDialog({ title: 'Supprimer cette commande ?', text: `La commande de ${o.prenom} sera définitivement supprimée de Netlify.`, confirmLabel: 'Supprimer', danger: true });
  if (!ok) return;
  await withBusy('Suppression…', async () => {
    await api.call('deleteOrder', { id });
    S.orders = S.orders.filter((x) => x.id !== id);
    toast('Commande supprimée.', 'ok');
    renderSidebar(); renderPage();
  });
}

/* ============================================================ messagerie */
function markReadLocal(id) {
  const m = S.messages.find((x) => x.id === id);
  if (m && !m.read) {
    m.read = true;
    api.call('markRead', { id, read: true }).catch(() => {});
    renderSidebar();
  }
}

function pageMessages() {
  if (!S.messages.find((m) => m.id === S.selMsg)) S.selMsg = S.messages.length ? S.messages[0].id : null;
  const rows = S.messages.map((m) => `<div class="row-item ${m.id === S.selMsg ? 'sel' : ''}" data-action="sel-msg" data-id="${esc(m.id)}">
      <span class="unread ${m.read ? 'off' : ''}"></span>
      <span class="main"><b>${esc(m.nom)}</b><small>${esc(fmtCreated(m.createdAt))}</small></span></div>`).join('');
  const sel = S.messages.find((m) => m.id === S.selMsg);
  return `${S.errors.messages ? `<div class="banner"><span class="grow">${esc(S.errors.messages)}</span><button class="btn btn-light" data-action="refresh">Réessayer</button></div>` : ''}
    <div class="split">
      <div class="list">${rows || '<div class="empty">Aucun message pour le moment.</div>'}</div>
      <div class="card detail">${sel ? messageDetail(sel) : '<div class="empty-detail">' + ico('mail') + '<span>Sélectionnez un message pour le lire.</span></div>'}</div>
    </div>`;
}

function messageDetail(m) {
  return `<div class="plabel">Message</div>
    <div class="bubble">${esc(m.message)}<span class="sig">— ${esc(m.nom)}</span></div>
    <dl class="kv"><dt>Expéditeur</dt><dd style="font-size:18px">${esc(m.nom)}</dd>
      <dt>Pays</dt><dd>${esc(m.pays)}</dd><dt>Reçu le</dt><dd>${esc(fmtCreated(m.createdAt))}</dd></dl>
    <button class="btn btn-wa" data-action="wa-msg" data-id="${esc(m.id)}">${ico('chat')} ${esc(m.whatsapp)} — Répondre sur WhatsApp</button>
    <div class="hint">La discussion WhatsApp s'ouvre directement avec ce visiteur.</div>
    <div class="detail-actions">
      <button class="btn btn-light" data-action="msg-unread" data-id="${esc(m.id)}">Marquer comme non lu</button>
      <button class="btn btn-danger" data-action="delete-msg" data-id="${esc(m.id)}">${ico('trash')} Supprimer le message</button></div>`;
}

async function deleteMsg(id) {
  const m = S.messages.find((x) => x.id === id);
  if (!m) return;
  const ok = await confirmDialog({ title: 'Supprimer ce message ?', text: `Le message de ${m.nom} sera définitivement supprimé de Netlify.`, confirmLabel: 'Supprimer', danger: true });
  if (!ok) return;
  await withBusy('Suppression…', async () => {
    await api.call('deleteMessage', { id });
    S.messages = S.messages.filter((x) => x.id !== id);
    toast('Message supprimé.', 'ok');
    renderSidebar(); renderPage();
  });
}

/* ============================================================ réglages */
function pageSettings() {
  const connected = S.cfg && S.cfg.connected;
  return `<div class="settings">
    ${connected ? '' : `<div class="welcome"><h2>Bienvenue dans Harrwama Mind Admin</h2><p>Connectez le logiciel à votre site Netlify pour gérer le contenu, les commandes et les messages depuis votre ordinateur.</p></div>`}
    <div class="card"><h2>Connexion au site</h2><p class="sub">Les mêmes informations que dans l'application mobile.</p>
      <label class="lab" for="set-url">Adresse du site</label>
      <input type="text" id="set-url" placeholder="harrwama-mind.netlify.app" autocomplete="off" spellcheck="false">
      <label class="lab" for="set-token">Clé secrète Netlify (jeton personnel)</label>
      <input type="password" id="set-token" placeholder="${connected ? '•••••••• enregistrée (laisser vide pour la conserver)' : 'Collez votre jeton ici'}" autocomplete="off">
      <ol class="steps"><li>Ouvrez app.netlify.com puis votre photo de profil &gt; <b>User settings</b></li>
        <li><b>Applications</b> &gt; <b>Personal access tokens</b> &gt; <b>New access token</b></li><li>Copiez le jeton et collez-le ci-dessus.</li></ol>
      <div class="actions"><button class="btn btn-primary btn-lg" data-action="save-connection">Tester et enregistrer</button></div>
      <div class="hint">Le jeton est chiffré par Windows et n'est jamais affiché ni envoyé ailleurs qu'à Netlify.</div></div>
    ${connected ? `<div class="card"><h2>Application</h2><p class="sub">Alertes et démarrage.</p>
      <div class="switch-row"><div class="t"><b>Notifications de bureau</b><small>Alerte Windows à chaque nouvelle commande ou nouveau message.</small></div>
        <label class="switch"><input type="checkbox" id="opt-notif" data-action="opt"><span class="slider"></span></label></div>
      <div class="switch-row"><div class="t"><b>Rester actif en arrière-plan</b><small>La croix ferme la fenêtre mais l'application continue de vous alerter (icône près de l'horloge).</small></div>
        <label class="switch"><input type="checkbox" id="opt-bg" data-action="opt"><span class="slider"></span></label></div>
      <div class="switch-row"><div class="t"><b>Lancer au démarrage de Windows</b><small>Démarre discrètement pour que vous ne ratiez aucune commande.</small></div>
        <label class="switch"><input type="checkbox" id="opt-auto" data-action="opt"><span class="slider"></span></label></div>
      <div class="hint" style="margin-top:12px">Vérification des nouvelles commandes et messages toutes les 30 secondes. Version <span id="app-version"></span>.</div></div>` : ''}
  </div>`;
}

async function loadSettingsValues() {
  const url = $('#set-url');
  if (url && !url.value && S.cfg) url.value = S.cfg.siteUrl || '';
  if (!(S.cfg && S.cfg.connected)) return;
  try {
    const st = await api.call('getSettings');
    S.settings = st;
    if ($('#opt-notif')) {
      $('#opt-notif').checked = st.notifications;
      $('#opt-bg').checked = st.runInBackground;
      $('#opt-auto').checked = st.autoStart;
      $('#app-version').textContent = st.version;
    }
  } catch (e) { /* ignoré */ }
}

async function saveConnection() {
  const siteUrl = $('#set-url').value.trim(), token = $('#set-token').value.trim();
  const first = !(S.cfg && S.cfg.connected);
  await withBusy('Connexion à Netlify…', async () => {
    S.cfg = await api.call('saveConnection', { siteUrl, token });
    $('#set-token').value = '';
    toast('Connexion réussie ✔', 'ok');
    await reloadAll();
    if (first) go('dashboard'); else { renderSidebar(); renderPage(); }
  });
}

async function saveOptions() {
  try {
    await api.call('saveSettings', { notifications: $('#opt-notif').checked, runInBackground: $('#opt-bg').checked, autoStart: $('#opt-auto').checked });
    toast('Préférences enregistrées.', 'ok', 2200);
  } catch (e) { toast(e.message, 'err'); }
}

/* ============================================================ événements */
const actions = {
  noop() {},
  nav(el) { go(el.dataset.page); },
  refresh() { withBusy('Actualisation…', reloadAll); },
  'open-site'() { if (S.content) api.call('openExternal', { url: S.content.siteUrl }); else if (S.cfg) api.call('openExternal', { url: 'https://' + S.cfg.siteUrl }); },
  'save-home'() {
    const titre = $('#home-titre').value, texte = $('#home-texte').value;
    withBusy('Publication en cours…', async () => {
      const r = await api.call('saveHome', { titre, texte });
      S.content.home = r.home; toast('Site mis à jour ✔', 'ok'); renderPage();
    });
  },
  'save-phone'() {
    const tel = $('#phone').value;
    withBusy('Publication en cours…', async () => {
      const r = await api.call('savePhone', tel);
      S.content.phone = r.phone; toast('Numéro mis à jour sur le site ✔', 'ok'); renderPage();
    });
  },
  'add-item'(el) { openEditor(el.dataset.kind, null); },
  'edit-item'(el) { openEditor(el.dataset.kind, Number(el.dataset.i)); },
  'delete-item'(el) { deleteItem(el.dataset.kind, Number(el.dataset.i)); },
  'modal-close'() { closeModal(); },
  'modal-save'() { saveEditor(); },
  'pick-photo'() { $('#file-input').click(); },
  'orders-tab'(el) { S.ordersTab = Number(el.dataset.tab); renderPage(); },
  'sel-order'(el) { S.selOrder = el.dataset.id; renderPage(); },
  'order-status'(el) { orderStatus(el.dataset.id, Number(el.dataset.st)); },
  'wa-order'(el) { openWaOrder(el.dataset.id); },
  'delete-order'(el) { deleteOrder(el.dataset.id); },
  'open-order'(el) { const o = S.orders.find((x) => x.id === el.dataset.id); if (o) { S.ordersTab = o.status; S.selOrder = o.id; } go('orders'); },
  'sel-msg'(el) { S.selMsg = el.dataset.id; markReadLocal(S.selMsg); renderPage(); },
  'open-msg'(el) { S.selMsg = el.dataset.id; go('messages'); },
  'wa-msg'(el) {
    const m = S.messages.find((x) => x.id === el.dataset.id);
    if (m) api.call('openExternal', { url: waUrl(m.whatsapp, `Bonjour ${m.nom}, ici HARRWAMA MIND. Merci pour votre message : « ${m.message} ».`) });
  },
  'msg-unread'(el) {
    const m = S.messages.find((x) => x.id === el.dataset.id);
    if (!m) return;
    m.read = false;
    api.call('markRead', { id: m.id, read: false }).catch(() => {});
    toast('Message marqué comme non lu.', 'info', 2200);
    renderSidebar(); renderPage();
  },
  'delete-msg'(el) { deleteMsg(el.dataset.id); },
  'save-connection'() { saveConnection(); },
  opt() { saveOptions(); }
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'noop') {
    // clic sur le fond d'une fenêtre modale : on ne ferme que pour l'éditeur
    if (e.target === el && M) closeModal();
    return;
  }
  if (el.tagName === 'INPUT') return; // les cases à cocher passent par « change »
  const fn = actions[el.dataset.action];
  if (fn) fn(el, e);
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'file-input') { takeFile(e.target.files[0]); e.target.value = ''; return; }
  if (e.target.matches && e.target.matches('input[data-action="opt"]')) saveOptions();
});

document.addEventListener('input', (e) => {
  if (e.target.matches && e.target.matches('[data-field]')) updateHomeButtons();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && M) closeModal();
});

// glisser-déposer d'une photo
document.addEventListener('dragover', (e) => {
  const box = e.target.closest && e.target.closest('#photo-box');
  if (box) { e.preventDefault(); box.classList.add('drag'); }
});
document.addEventListener('dragleave', (e) => {
  const box = e.target.closest && e.target.closest('#photo-box');
  if (box) box.classList.remove('drag');
});
document.addEventListener('drop', (e) => {
  const box = e.target.closest && e.target.closest('#photo-box');
  if (box) { e.preventDefault(); box.classList.remove('drag'); if (e.dataTransfer.files[0]) takeFile(e.dataTransfer.files[0]); }
  else e.preventDefault(); // jamais d'ouverture de fichier dans la fenêtre
});

/* ============================================================ événements du processus principal */
api.on('progress', (s) => { const t = $('#busy-text'); if (t) t.textContent = s; });
api.on('inbox', (r) => applyInbox(r, true));
api.on('navigate', (page) => go(page));

/* ============================================================ démarrage */
(async function boot() {
  renderSidebar(); renderTop(); $('#content').innerHTML = '<div class="empty">Chargement…</div>';
  try { S.cfg = await api.call('getConfig'); } catch (e) { S.cfg = { connected: false, siteUrl: '' }; }
  if (!S.cfg.connected) { go('settings'); return; }
  renderSidebar(); renderTop(); renderPage();
  await reloadAll();
})();

})();
