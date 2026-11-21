'use strict';
/** Logique métier : contenu du site, commandes, messagerie. Indépendant d'Electron (testable). */
const { ApiError, normalizeHost } = require('./netlify');

const MAX_PRODUCTS = 10;
const DEFAULT_PHONE = '+226 70 70 70 21';
const ST_NEW = 0, ST_PROCESSING = 1, ST_DELIVERED = 2;

const clean = (s) => String(s == null ? '' : s).trim();
const toBuf = (obj) => Buffer.from(JSON.stringify(obj, null, 2), 'utf8');

function isValidPhone(t) {
  const v = clean(t);
  if (!v.startsWith('+')) return false;
  if ((v.match(/\+/g) || []).length !== 1) return false;
  if (!/^[0-9 +]+$/.test(v)) return false;
  const digits = (v.match(/[0-9]/g) || []).length;
  return digits >= 8 && digits <= 15;
}

const parseHome = (t) => { const o = JSON.parse(t); return { titre: clean(o.titre), texte: clean(o.texte) }; };
const parseProducts = (t) => JSON.parse(t).map((o) => ({
  nom: clean(o.nom), categorie: clean(o.categorie), prix: clean(o.prix),
  description: clean(o.description), image: clean(o.image)
}));
const parseServices = (t) => JSON.parse(t).map((o) => ({
  domaine: clean(o.domaine), titre: clean(o.titre), description: clean(o.description), image: clean(o.image)
}));
function parsePhone(t) {
  try { const v = clean(JSON.parse(t).telephone); return v || DEFAULT_PHONE; } catch (e) { return DEFAULT_PHONE; }
}

function createService({ store, clientFactory, onProgress }) {
  let client = null;
  let clientKey = '';

  function getClient() {
    const c = store.getConfig();
    if (!c.siteUrl || !c.token) throw new ApiError("Connectez d'abord l'application à votre site (menu Réglages).");
    const key = c.siteUrl + '|' + c.token;
    if (key !== clientKey) { client = clientFactory(c.token, c.siteUrl); clientKey = key; }
    return client;
  }
  const step = (s) => { if (onProgress) onProgress(s); };
  async function publish(changes, deletions) { await getClient().publish(changes, new Set(deletions || []), step); }

  // ------------------------------------------------------------ connexion
  function getConfig() {
    const c = store.getConfig();
    return { siteUrl: c.siteUrl, connected: !!(c.siteUrl && c.token), runInBackground: c.runInBackground, notifications: c.notifications };
  }

  async function saveConnection({ siteUrl, token }) {
    const host = normalizeHost(siteUrl);
    if (!host) throw new ApiError("Saisissez l'adresse de votre site (ex : harrwama-mind.netlify.app).");
    const tok = clean(token) || store.getConfig().token;
    if (!tok) throw new ApiError('Saisissez votre clé secrète Netlify.');
    await clientFactory(tok, host).connect(); // lève une erreur claire si refusé
    store.setConfig({ siteUrl: host, token: tok });
    client = null; clientKey = '';
    return getConfig();
  }

  // ------------------------------------------------------------ contenu du site
  async function loadSite() {
    const c = getClient();
    await c.connect();
    const [h, s, p, ct] = await Promise.all([
      c.fetchPublic('home.json'), c.fetchPublic('services.json'),
      c.fetchPublic('products.json'), c.fetchPublic('contact.json').catch(() => null)
    ]);
    if (h == null || s == null) {
      throw new ApiError("Les fichiers home.json / services.json sont absents du site. Publiez d'abord le dernier zip du site sur Netlify, puis réessayez.");
    }
    return {
      home: parseHome(h), services: parseServices(s),
      products: p == null ? [] : parseProducts(p),
      phone: ct == null ? DEFAULT_PHONE : parsePhone(ct),
      siteUrl: 'https://' + c.host
    };
  }

  async function saveHome({ titre, texte }) {
    const home = { titre: clean(titre), texte: clean(texte) };
    if (!home.titre || !home.texte) throw new ApiError('Le titre et le texte ne peuvent pas être vides.');
    await publish([{ path: 'home.json', bytes: toBuf(home) }]);
    return { home };
  }

  async function savePhone(tel) {
    const phone = clean(tel);
    if (!isValidPhone(phone)) throw new ApiError("Numéro invalide : commencez par + et l'indicatif du pays (8 à 15 chiffres).");
    await publish([{ path: 'contact.json', bytes: toBuf({ telephone: phone }) }]);
    return { phone };
  }

  // Les listes sont relues sur le site AVANT chaque modification : on ne remplace jamais
  // un changement fait entre-temps depuis le téléphone.
  async function fetchList(file, parse) {
    const t = await getClient().fetchPublic(file);
    return t == null ? [] : parse(t);
  }
  function findIndex(list, orig, key) {
    let i = list.findIndex((x) => x[key] === orig[key] && x.image === (orig.image || ''));
    if (i < 0 && orig.image) i = list.findIndex((x) => x.image === orig.image);
    if (i < 0) i = list.findIndex((x) => x[key] === orig[key]);
    if (i < 0) throw new ApiError("Cet élément a été modifié ailleurs (téléphone ou autre ordinateur). Actualisez la page puis recommencez.");
    return i;
  }
  const stillUsed = (list, idx, image) => list.some((x, i) => i !== idx && x.image === image);
  const jpeg = (b64) => Buffer.from(b64, 'base64');

  async function addProduct(p, imageB64) {
    const list = await fetchList('products.json', parseProducts);
    if (list.length >= MAX_PRODUCTS) throw new ApiError(`Maximum ${MAX_PRODUCTS} produits : supprimez-en un avant d'en ajouter.`);
    const item = { nom: clean(p.nom), categorie: clean(p.categorie), prix: clean(p.prix), description: clean(p.description), image: '' };
    if (!item.nom) throw new ApiError('Le nom du produit est obligatoire.');
    const changes = [];
    if (imageB64) { item.image = `assets/products/p-${Date.now()}.jpg`; changes.push({ path: item.image, bytes: jpeg(imageB64) }); }
    list.push(item);
    changes.push({ path: 'products.json', bytes: toBuf(list) });
    await publish(changes);
    return { products: list };
  }

  async function editProduct(orig, p, imageB64) {
    const list = await fetchList('products.json', parseProducts);
    const idx = findIndex(list, orig, 'nom');
    const old = list[idx];
    const item = { nom: clean(p.nom), categorie: clean(p.categorie), prix: clean(p.prix), description: clean(p.description), image: old.image };
    if (!item.nom) throw new ApiError('Le nom du produit est obligatoire.');
    const changes = [], deletions = [];
    if (imageB64) {
      if (old.image && !stillUsed(list, idx, old.image)) deletions.push(old.image);
      item.image = `assets/products/p-${Date.now()}.jpg`;
      changes.push({ path: item.image, bytes: jpeg(imageB64) });
    }
    list[idx] = item;
    changes.push({ path: 'products.json', bytes: toBuf(list) });
    await publish(changes, deletions);
    return { products: list };
  }

  async function deleteProduct(orig) {
    const list = await fetchList('products.json', parseProducts);
    const idx = findIndex(list, orig, 'nom');
    const [old] = list.splice(idx, 1);
    const deletions = old.image && !stillUsed(list, -1, old.image) ? [old.image] : [];
    await publish([{ path: 'products.json', bytes: toBuf(list) }], deletions);
    return { products: list };
  }

  async function addService(s, imageB64) {
    const list = await fetchList('services.json', parseServices);
    const item = { domaine: clean(s.domaine), titre: clean(s.titre), description: clean(s.description), image: '' };
    if (!item.titre) throw new ApiError('Le titre du service est obligatoire.');
    const changes = [];
    if (imageB64) { item.image = `assets/services/s-${Date.now()}.jpg`; changes.push({ path: item.image, bytes: jpeg(imageB64) }); }
    list.push(item);
    changes.push({ path: 'services.json', bytes: toBuf(list) });
    await publish(changes);
    return { services: list };
  }

  async function editService(orig, s, imageB64) {
    const list = await fetchList('services.json', parseServices);
    const idx = findIndex(list, orig, 'titre');
    const old = list[idx];
    const item = { domaine: clean(s.domaine), titre: clean(s.titre), description: clean(s.description), image: old.image };
    if (!item.titre) throw new ApiError('Le titre du service est obligatoire.');
    const changes = [], deletions = [];
    if (imageB64) {
      if (old.image && !stillUsed(list, idx, old.image)) deletions.push(old.image);
      item.image = `assets/services/s-${Date.now()}.jpg`;
      changes.push({ path: item.image, bytes: jpeg(imageB64) });
    }
    list[idx] = item;
    changes.push({ path: 'services.json', bytes: toBuf(list) });
    await publish(changes, deletions);
    return { services: list };
  }

  async function deleteService(orig) {
    const list = await fetchList('services.json', parseServices);
    const idx = findIndex(list, orig, 'titre');
    const [old] = list.splice(idx, 1);
    const deletions = old.image && !stillUsed(list, -1, old.image) ? [old.image] : [];
    await publish([{ path: 'services.json', bytes: toBuf(list) }], deletions);
    return { services: list };
  }

  // ------------------------------------------------------------ commandes & messagerie
  /** Relit commandes et messages ; détecte ceux qui sont nouveaux depuis la dernière lecture. */
  async function refreshInbox() {
    const c = getClient();
    const st = store.getState(c.host);
    const result = { orders: null, messages: null, errors: { orders: null, messages: null }, freshOrders: [], freshMessages: [] };

    try {
      const list = await c.listOrders();
      const seen = new Set(st.seenOrders);
      if (st.seenInit) result.freshOrders = list.filter((o) => !seen.has(o.id));
      st.seenOrders = list.map((o) => o.id);
      st.seenInit = true;
      result.orders = list.map((o) => ({ ...o, status: st.orderStatus[o.id] != null ? st.orderStatus[o.id] : ST_NEW }));
    } catch (e) { result.errors.orders = e.message; }

    try {
      const list = await c.listMessages();
      const seen = new Set(st.seenMessages);
      const read = new Set(st.readMessages);
      if (st.seenMsgInit) result.freshMessages = list.filter((m) => !seen.has(m.id));
      st.seenMessages = list.map((m) => m.id);
      st.seenMsgInit = true;
      result.messages = list.map((m) => ({ ...m, read: read.has(m.id) }));
    } catch (e) { result.errors.messages = e.message; }

    store.saveState(c.host, st);
    return result;
  }

  function setOrderStatus({ id, status }) {
    const host = getClient().host;
    const st = store.getState(host);
    st.orderStatus[id] = status;
    store.saveState(host, st);
    return true;
  }

  function markRead({ id, read }) {
    const host = getClient().host;
    const st = store.getState(host);
    const set = new Set(st.readMessages);
    if (read) set.add(id); else set.delete(id);
    st.readMessages = [...set];
    store.saveState(host, st);
    return true;
  }

  async function deleteSubmissionAndState(id) {
    const c = getClient();
    await c.deleteSubmission(id);
    const st = store.getState(c.host);
    delete st.orderStatus[id];
    st.readMessages = st.readMessages.filter((x) => x !== id);
    st.seenOrders = st.seenOrders.filter((x) => x !== id);
    st.seenMessages = st.seenMessages.filter((x) => x !== id);
    store.saveState(c.host, st);
    return true;
  }

  return {
    getConfig, saveConnection, loadSite, saveHome, savePhone,
    addProduct, editProduct, deleteProduct, addService, editService, deleteService,
    refreshInbox, setOrderStatus, markRead,
    deleteOrder: ({ id }) => deleteSubmissionAndState(id),
    deleteMessage: ({ id }) => deleteSubmissionAndState(id)
  };
}

module.exports = { createService, isValidPhone, MAX_PRODUCTS, DEFAULT_PHONE, ST_NEW, ST_PROCESSING, ST_DELIVERED };
