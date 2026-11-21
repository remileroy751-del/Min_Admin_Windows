'use strict';
/* Tests de la logique avec un faux serveur Netlify (aucun accès Internet nécessaire). */
const http = require('http');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { NetlifyClient, sha1 } = require('../src/netlify');
const { createStore } = require('../src/store');
const { createService } = require('../src/service');

const HOST = 'demo.netlify.app';
const TOKEN = 'tok-123';

function startMock() {
  const blobs = new Map();          // sha -> Buffer
  let files = new Map();            // "/path" -> sha  (déploiement publié)
  const put = (p, data) => { const b = Buffer.isBuffer(data) ? data : Buffer.from(data); const s = sha1(b); blobs.set(s, b); files.set(p, s); };
  put('/index.html', '<html></html>');
  put('/home.json', JSON.stringify({ titre: 'Titre *un*', texte: 'Texte' }));
  put('/services.json', JSON.stringify([{ domaine: 'Finance', titre: 'Conseil', description: 'D', image: 'assets/services/s1.jpg' }]));
  put('/products.json', JSON.stringify([{ nom: 'Moringa', categorie: 'Bien-être', prix: '5000 FCFA', description: 'x', image: 'assets/products/a.jpg' }]));
  put('/assets/products/a.jpg', 'IMG-A');
  put('/assets/services/s1.jpg', 'IMG-S1');
  const submissions = { 'commande-livraison': [], 'message-contact': [] };
  const pending = {};
  const log = { deploys: 0 };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const send = (code, obj) => { const b = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)); res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(b); };

      if (url.pathname.startsWith('/api/')) {
        if (req.headers.authorization !== 'Bearer ' + TOKEN) return send(401, {});
        const p = url.pathname.slice(4);
        let m;
        if (req.method === 'GET' && p === '/sites/' + HOST) return send(200, { id: 'site1', published_deploy: { id: 'dep' + log.deploys } });
        if (req.method === 'GET' && p.startsWith('/sites/') && p.split('/').length === 3 && p !== '/sites/site1') return send(404, {});
        if (req.method === 'GET' && p === '/sites/site1') return send(200, { id: 'site1', published_deploy: { id: 'dep' + log.deploys } });
        if (req.method === 'GET' && p === '/sites') return send(200, []);
        if (req.method === 'GET' && (m = p.match(/^\/deploys\/(dep\d+)\/files$/))) {
          return send(200, [...files].map(([fp, sha]) => ({ id: fp, path: fp, sha })));
        }
        if (req.method === 'POST' && p === '/sites/site1/deploys') {
          const digest = JSON.parse(body.toString()).files;
          const required = [...new Set(Object.values(digest).filter((s) => !blobs.has(s)))];
          const id = 'new' + (++log.deploys);
          pending[id] = { digest, required, uploaded: new Set() };
          return send(200, { id, required, state: 'prepared' });
        }
        if (req.method === 'PUT' && (m = p.match(/^\/deploys\/(new\d+)\/files\/(.+)$/))) {
          const d = pending[m[1]]; const s = sha1(body);
          if (!d.required.includes(s)) return send(422, { error: 'not required' });
          blobs.set(s, body); d.uploaded.add(s); return send(200, {});
        }
        if (req.method === 'GET' && (m = p.match(/^\/deploys\/(new\d+)$/))) {
          const d = pending[m[1]];
          const ready = d.required.every((s) => d.uploaded.has(s));
          if (ready) { files = new Map(Object.entries(d.digest)); return send(200, { id: m[1], state: 'ready', required: [] }); }
          return send(200, { id: m[1], state: 'prepared', required: d.required });
        }
        if (req.method === 'GET' && p === '/sites/site1/forms') {
          return send(200, Object.keys(submissions).map((n) => ({ id: 'f-' + n, name: n })));
        }
        if (req.method === 'GET' && (m = p.match(/^\/forms\/f-(.+)\/submissions$/))) return send(200, submissions[m[1]]);
        if (req.method === 'DELETE' && (m = p.match(/^\/submissions\/(.+)$/))) {
          for (const k of Object.keys(submissions)) submissions[k] = submissions[k].filter((s) => s.id !== m[1]);
          return send(204, '');
        }
        return send(404, {});
      }
      const fp = decodeURIComponent(url.pathname);
      if (files.has(fp)) { res.writeHead(200); return res.end(blobs.get(files.get(fp))); }
      res.writeHead(404); res.end('nf');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const base = 'http://127.0.0.1:' + server.address().port;
    resolve({ base, server, files: () => files, blobs, submissions, text: (p) => blobs.get(files.get(p)).toString() });
  }));
}

(async () => {
  const mock = await startMock();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-'));
  const store = createStore(dir, { available: true, encrypt: (s) => Buffer.from(s).toString('base64'), decrypt: (s) => Buffer.from(s, 'base64').toString() });
  const steps = [];
  const svc = createService({
    store, onProgress: (s) => steps.push(s),
    clientFactory: (t, s) => new NetlifyClient(t, s, { api: mock.base + '/api', siteBase: mock.base })
  });
  let n = 0;
  const ok = (name) => console.log('  ✓ ' + name);

  // connexion
  await assert.rejects(() => svc.saveConnection({ siteUrl: HOST, token: 'mauvais' }), /refusée/);
  assert.strictEqual(svc.getConfig().connected, false); ok('jeton refusé');
  await assert.rejects(() => svc.saveConnection({ siteUrl: 'autre.netlify.app', token: TOKEN }), /introuvable/);
  const cfg = await svc.saveConnection({ siteUrl: 'https://' + HOST + '/', token: TOKEN });
  assert.strictEqual(cfg.connected, true); assert.strictEqual(cfg.siteUrl, HOST);
  assert.ok(!JSON.stringify(svc.getConfig()).includes(TOKEN));
  assert.ok(!fs.readFileSync(path.join(dir, 'config.json'), 'utf8').includes(TOKEN)); ok('connexion + jeton chiffré');

  // lecture
  let site = await svc.loadSite();
  assert.strictEqual(site.products.length, 1); assert.strictEqual(site.phone, '+226 70 70 70 21');
  assert.strictEqual(site.home.titre, 'Titre *un*'); ok('lecture du site');

  // accueil & téléphone
  await svc.saveHome({ titre: 'Nouveau *titre*', texte: 'Nouveau texte' });
  assert.strictEqual(JSON.parse(mock.text('/home.json')).titre, 'Nouveau *titre*'); ok('modification accueil');
  await assert.rejects(() => svc.savePhone('70707021'), /invalide/);
  await svc.savePhone('+228 90 11 22 33');
  assert.strictEqual(JSON.parse(mock.text('/contact.json')).telephone, '+228 90 11 22 33'); ok('numéro principal');
  assert.ok(mock.files().has('/index.html') && mock.files().has('/assets/products/a.jpg')); ok('fichiers existants conservés');

  // produits
  const img1 = Buffer.from('JPEG-1').toString('base64');
  let r = await svc.addProduct({ nom: 'Curcuma', categorie: 'Santé', prix: '3000', description: 'desc' }, img1);
  assert.strictEqual(r.products.length, 2);
  const added = JSON.parse(mock.text('/products.json'))[1];
  assert.ok(/^assets\/products\/p-\d+\.jpg$/.test(added.image));
  assert.strictEqual(mock.text('/' + added.image), 'JPEG-1'); ok('ajout produit + image');

  r = await svc.editProduct({ nom: 'Curcuma', image: added.image }, { nom: 'Curcuma bio', categorie: 'Santé', prix: '3500', description: 'd2' }, null);
  assert.strictEqual(JSON.parse(mock.text('/products.json'))[1].nom, 'Curcuma bio');
  assert.strictEqual(JSON.parse(mock.text('/products.json'))[1].image, added.image); ok('modification sans changer la photo');

  await new Promise((res) => setTimeout(res, 5));
  await svc.editProduct({ nom: 'Curcuma bio', image: added.image }, { nom: 'Curcuma bio', categorie: 'Santé', prix: '3500', description: 'd2' }, Buffer.from('JPEG-2').toString('base64'));
  const edited = JSON.parse(mock.text('/products.json'))[1];
  assert.notStrictEqual(edited.image, added.image);
  assert.strictEqual(mock.text('/' + edited.image), 'JPEG-2');
  assert.ok(!mock.files().has('/' + added.image)); ok('changement de photo (ancienne supprimée)');

  await assert.rejects(() => svc.editProduct({ nom: 'Inconnu', image: 'x' }, { nom: 'Z' }, null), /modifié ailleurs/); ok('élément modifié ailleurs détecté');

  await svc.deleteProduct({ nom: 'Curcuma bio', image: edited.image });
  assert.strictEqual(JSON.parse(mock.text('/products.json')).length, 1);
  assert.ok(!mock.files().has('/' + edited.image)); ok('suppression produit + image');

  for (let i = 0; i < 9; i++) await svc.addProduct({ nom: 'P' + i }, null);
  await assert.rejects(() => svc.addProduct({ nom: 'Trop' }, null), /Maximum 10/); ok('limite de 10 produits');

  // services
  await svc.addService({ titre: 'Voyage', domaine: 'Agence', description: 'd' }, Buffer.from('S2').toString('base64'));
  assert.strictEqual(JSON.parse(mock.text('/services.json')).length, 2);
  await svc.editService({ titre: 'Conseil', image: 'assets/services/s1.jpg' }, { titre: 'Conseil+', domaine: 'Finance', description: 'D' }, null);
  assert.strictEqual(JSON.parse(mock.text('/services.json'))[0].titre, 'Conseil+');
  await svc.deleteService({ titre: 'Conseil+', image: 'assets/services/s1.jpg' });
  assert.ok(!mock.files().has('/assets/services/s1.jpg')); ok('services (ajout, modification, suppression)');

  assert.ok(steps.includes('Mise en ligne en cours…')); ok('étapes de progression');

  // commandes & messages
  let inbox = await svc.refreshInbox();
  assert.strictEqual(inbox.orders.length, 0); assert.strictEqual(inbox.freshOrders.length, 0);
  mock.submissions['commande-livraison'].push({ id: 'o1', created_at: '2026-11-20T10:00:00Z', data: { prenom: 'Awa', produit: 'Moringa', quantite: '2', pays: 'Togo', whatsapp_complet: '+22890000000', adresse: 'Tokoin', date_livraison: '2026-11-25', produit_image: 'assets/products/a.jpg' } });
  mock.submissions['message-contact'].push({ id: 'm1', created_at: '2026-11-20T11:00:00Z', data: { nom_complet: 'Koffi Mensah', pays: 'Togo', whatsapp_complet: '+22891111111', message: 'Bonjour' } });
  inbox = await svc.refreshInbox();
  assert.strictEqual(inbox.freshOrders.length, 1); assert.strictEqual(inbox.freshMessages.length, 1);
  assert.strictEqual(inbox.orders[0].status, 0); assert.strictEqual(inbox.messages[0].read, false); ok('nouvelle commande / nouveau message détectés');
  inbox = await svc.refreshInbox();
  assert.strictEqual(inbox.freshOrders.length, 0); ok('pas de doublon de notification');
  svc.setOrderStatus({ id: 'o1', status: 1 }); svc.markRead({ id: 'm1', read: true });
  inbox = await svc.refreshInbox();
  assert.strictEqual(inbox.orders[0].status, 1); assert.strictEqual(inbox.messages[0].read, true); ok('statuts et lu/non lu mémorisés');
  await svc.deleteOrder({ id: 'o1' }); await svc.deleteMessage({ id: 'm1' });
  inbox = await svc.refreshInbox();
  assert.strictEqual(inbox.orders.length + inbox.messages.length, 0); ok('suppression commande / message');

  mock.server.close();
  console.log('\nTous les tests sont passés.');
})().catch((e) => { console.error('\nÉCHEC :', e); process.exit(1); });
