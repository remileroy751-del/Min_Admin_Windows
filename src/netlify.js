'use strict';
/**
 * Client Netlify (port fidèle de la version Android) :
 * connexion au site, lecture des commandes/messages (Netlify Forms),
 * publication d'une nouvelle version du site par empreintes SHA-1.
 */
const crypto = require('crypto');

class ApiError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizeHost(input) {
  let s = String(input || '').trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.split('/')[0].split('?')[0].split('#')[0];
  return s.toLowerCase();
}
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
const withSlash = (p) => (p.startsWith('/') ? p : '/' + p);
const encodePath = (p) => p.replace(/^\//, '').split('/').map(encodeURIComponent).join('/');

async function http(method, url, { token, body, contentType, timeout = 60000 } = {}) {
  const headers = { 'User-Agent': 'HarrwamaAdminDesktop/1.0' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (contentType) headers['Content-Type'] = contentType;
  let res;
  try {
    res = await fetch(url, { method, headers, body, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
  } catch (e) {
    throw new ApiError('Connexion impossible : vérifiez votre accès Internet puis réessayez.');
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { code: res.status, body: buf, get text() { return buf.toString('utf8'); } };
}

class NetlifyClient {
  constructor(token, siteUrl, opts = {}) {
    this.token = token;
    this.host = normalizeHost(siteUrl);
    this.api = opts.api || process.env.HARRWAMA_API || 'https://api.netlify.com/api/v1';
    this.siteBase = opts.siteBase || process.env.HARRWAMA_SITE_BASE || 'https://' + this.host;
    this._siteId = null;
    this._formIds = {};
  }

  /** Retrouve le site à partir de son adresse et vérifie la clé secrète. */
  async connect() {
    if (!this.host) throw new ApiError('Adresse du site manquante.');
    if (!this.token) throw new ApiError('Clé secrète manquante.');
    const bad401 = 'Clé secrète refusée par Netlify (401). Vérifiez le jeton saisi.';

    let r = await http('GET', `${this.api}/sites/${this.host}`, { token: this.token });
    if (r.code === 401) throw new ApiError(bad401);
    if (r.code === 404) {
      const list = await http('GET', `${this.api}/sites?filter=all&per_page=100`, { token: this.token });
      if (list.code === 401) throw new ApiError(bad401);
      if (list.code >= 200 && list.code < 300) {
        for (const o of JSON.parse(list.text)) {
          const cands = [o.url, o.ssl_url, o.custom_domain, o.default_domain].map(normalizeHost);
          if (cands.includes(this.host)) {
            r = await http('GET', `${this.api}/sites/${o.id}`, { token: this.token });
            break;
          }
        }
      }
    }
    if (r.code < 200 || r.code >= 300) {
      throw new ApiError(`Site introuvable sur ce compte Netlify (code ${r.code}). Vérifiez l'adresse et que la clé appartient au bon compte.`);
    }
    const o = JSON.parse(r.text);
    this._siteId = o.id;
    const pid = o.published_deploy && o.published_deploy.id ? o.published_deploy.id : null;
    return { id: o.id, publishedDeployId: pid };
  }

  async siteId() {
    if (!this._siteId) await this.connect();
    return this._siteId;
  }

  async formIdFor(name) {
    if (this._formIds[name]) return this._formIds[name];
    const r = await http('GET', `${this.api}/sites/${await this.siteId()}/forms`, { token: this.token });
    if (r.code === 401) throw new ApiError('Clé secrète refusée par Netlify (401).');
    if (r.code < 200 || r.code >= 300) throw new ApiError(`Lecture des formulaires impossible (code ${r.code}).`);
    for (const f of JSON.parse(r.text)) {
      if (f.name === name) { this._formIds[name] = f.id; return f.id; }
    }
    return null; // aucun envoi reçu pour l'instant
  }

  async _submissions(formName, label) {
    const formId = await this.formIdFor(formName);
    if (!formId) return [];
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const r = await http('GET', `${this.api}/forms/${formId}/submissions?per_page=100&page=${page}`, { token: this.token });
      if (r.code === 401) throw new ApiError('Clé secrète refusée par Netlify (401).');
      if (r.code < 200 || r.code >= 300) throw new ApiError(`Lecture des ${label} impossible (code ${r.code}).`);
      const arr = JSON.parse(r.text);
      for (const o of arr) out.push(o);
      if (arr.length < 100) break;
    }
    return out;
  }

  /** Commandes du formulaire « commande-livraison », les plus récentes d'abord. */
  async listOrders() {
    const out = [];
    for (const o of await this._submissions('commande-livraison', 'commandes')) {
      const d = o.data || {};
      const prenom = d.prenom || '';
      const whatsapp = d.whatsapp_complet || '';
      if (!prenom && !whatsapp) continue;
      out.push({
        id: String(o.id), createdAt: o.created_at || '',
        produit: d.produit || '', produitImage: d.produit_image || '', produitPrix: d.produit_prix || '',
        quantite: String(d.quantite || ''), prenom, pays: d.pays || '', whatsapp,
        adresse: d.adresse || '', dateLivraison: d.date_livraison || ''
      });
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** Messages du formulaire « message-contact » (bouton « Nous écrire »). */
  async listMessages() {
    const out = [];
    for (const o of await this._submissions('message-contact', 'messages')) {
      const d = o.data || {};
      const nom = d.nom_complet || '';
      const message = d.message || '';
      if (!nom && !message) continue;
      out.push({
        id: String(o.id), createdAt: o.created_at || '',
        nom, pays: d.pays || '', whatsapp: d.whatsapp_complet || '', message
      });
    }
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async deleteSubmission(id) {
    const r = await http('DELETE', `${this.api}/submissions/${id}`, { token: this.token });
    if ((r.code < 200 || r.code >= 300) && r.code !== 404) {
      throw new ApiError(`Suppression impossible (code ${r.code}).`);
    }
  }

  /** Fichier texte du site en ligne (null si absent). */
  async fetchPublic(path) {
    const r = await http('GET', `${this.siteBase}/${path}?t=${Date.now()}`);
    if (r.code === 404) return null;
    if (r.code < 200 || r.code >= 300) throw new ApiError(`Lecture de ${path} impossible (code ${r.code}).`);
    return r.text;
  }

  /**
   * Publie une nouvelle version : on reprend TOUS les fichiers actuels (SHA-1),
   * on applique modifications/suppressions, puis on n'envoie que les fichiers nouveaux.
   * changes : [{path, bytes(Buffer)}]   deletions : Set<string>
   */
  async publish(changes, deletions, onStep = () => {}) {
    onStep('Connexion à Netlify…');
    const info = await this.connect();
    if (!info.publishedDeployId) {
      throw new ApiError("Aucun déploiement publié trouvé. Publiez d'abord le site (zip) sur Netlify.");
    }

    onStep('Lecture des fichiers actuels du site…');
    const fr = await http('GET', `${this.api}/deploys/${info.publishedDeployId}/files`, { token: this.token });
    if (fr.code < 200 || fr.code >= 300) throw new ApiError(`Impossible de lire les fichiers du site (code ${fr.code}).`);
    const files = new Map();
    for (const o of JSON.parse(fr.text)) {
      const p = o.path || o.id;
      if (p && o.sha) files.set(withSlash(p), o.sha);
    }
    if (!files.has('/index.html')) {
      throw new ApiError('Liste des fichiers du site incomplète : publication annulée par sécurité.');
    }

    for (const d of deletions || []) files.delete(withSlash(d));
    const shaByPath = new Map();
    for (const c of changes) {
      const sha = sha1(c.bytes);
      files.set(withSlash(c.path), sha);
      shaByPath.set(withSlash(c.path), sha);
    }

    onStep('Préparation de la publication…');
    const digest = {};
    for (const [p, sha] of files) digest[p] = sha;
    const cr = await http('POST', `${this.api}/sites/${info.id}/deploys`, {
      token: this.token, body: JSON.stringify({ files: digest }), contentType: 'application/json'
    });
    if (cr.code < 200 || cr.code >= 300) {
      throw new ApiError(`Création du déploiement refusée (code ${cr.code}) : ${cr.text.slice(0, 160)}`);
    }
    const dep = JSON.parse(cr.text);
    const newId = dep.id;
    let required = dep.required || [];
    let state = dep.state || '';

    for (let tries = 0; (state === 'new' || state === 'preparing' || state === '') && tries < 30; tries++) {
      await sleep(1000);
      const g = await http('GET', `${this.api}/deploys/${newId}`, { token: this.token });
      if (g.code >= 200 && g.code < 300) {
        const o = JSON.parse(g.text);
        state = o.state || '';
        if (o.required && o.required.length) required = o.required;
      }
    }

    const toSend = changes.filter((c) => {
      const s = shaByPath.get(withSlash(c.path));
      return s && required.includes(s);
    });
    const sent = new Set();
    let n = 0;
    for (const c of toSend) {
      const sha = shaByPath.get(withSlash(c.path));
      if (sent.has(sha)) continue;
      sent.add(sha);
      n++;
      onStep(`Envoi des fichiers (${n}/${toSend.length})…`);
      await this._upload(newId, c);
    }

    onStep('Mise en ligne en cours…');
    for (let waited = 0; waited < 120; waited += 2) {
      const g = await http('GET', `${this.api}/deploys/${newId}`, { token: this.token });
      if (g.code >= 200 && g.code < 300) {
        const o = JSON.parse(g.text);
        if (o.state === 'ready') return;
        if (o.state === 'error') throw new ApiError('Netlify a signalé une erreur : ' + (o.error_message || 'inconnue'));
      }
      await sleep(waited === 0 ? 300 : 2000);
    }
    throw new ApiError('La mise en ligne prend plus de temps que prévu. Vérifiez dans Netlify (onglet Deploys).');
  }

  async _upload(deployId, c) {
    const url = `${this.api}/deploys/${deployId}/files/${encodePath(c.path)}`;
    for (let attempt = 1; ; attempt++) {
      const r = await http('PUT', url, { token: this.token, body: c.bytes, contentType: 'application/octet-stream' });
      if (r.code >= 200 && r.code < 300) return;
      if (attempt >= 5) throw new ApiError(`Envoi de ${c.path} refusé (code ${r.code}) : ${r.text.slice(0, 160)}`);
      await sleep(1500);
    }
  }
}

module.exports = { NetlifyClient, ApiError, normalizeHost, sha1 };
