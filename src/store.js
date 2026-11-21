'use strict';
/** Stockage local : configuration (jeton chiffré par Windows) et état de l'inbox. */
const fs = require('fs');
const path = require('path');

const DEFAULT_CONFIG = { siteUrl: '', runInBackground: true, notifications: true };

function createStore(dir, crypt) {
  const cfgFile = path.join(dir, 'config.json');
  const stateFile = path.join(dir, 'state.json');

  const readJson = (f, def) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return def; } };
  const writeJson = (f, obj) => {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, f);
  };

  return {
    getConfig() {
      const raw = readJson(cfgFile, {});
      let token = '';
      try {
        if (raw.tokenEnc) token = crypt.decrypt(raw.tokenEnc);
        else if (raw.tokenPlain) token = raw.tokenPlain;
      } catch (e) { token = ''; }
      return { ...DEFAULT_CONFIG, siteUrl: raw.siteUrl || '', runInBackground: raw.runInBackground !== false,
        notifications: raw.notifications !== false, token };
    },
    setConfig(patch) {
      const raw = readJson(cfgFile, {});
      if (patch.siteUrl !== undefined) raw.siteUrl = patch.siteUrl;
      if (patch.runInBackground !== undefined) raw.runInBackground = !!patch.runInBackground;
      if (patch.notifications !== undefined) raw.notifications = !!patch.notifications;
      if (patch.token !== undefined) {
        delete raw.tokenEnc; delete raw.tokenPlain;
        if (patch.token) {
          if (crypt.available) raw.tokenEnc = crypt.encrypt(patch.token);
          else raw.tokenPlain = patch.token;
        }
      }
      writeJson(cfgFile, raw);
    },
    getState(host) {
      const all = readJson(stateFile, {});
      const s = all[host] || {};
      return {
        orderStatus: s.orderStatus || {}, readMessages: s.readMessages || [],
        seenOrders: s.seenOrders || [], seenMessages: s.seenMessages || [],
        seenInit: !!s.seenInit, seenMsgInit: !!s.seenMsgInit
      };
    },
    saveState(host, st) {
      const all = readJson(stateFile, {});
      all[host] = st;
      writeJson(stateFile, all);
    }
  };
}

module.exports = { createStore };
