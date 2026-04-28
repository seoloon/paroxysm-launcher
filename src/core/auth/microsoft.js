'use strict';
/**
 * Microsoft Authentication — Authorization Code Flow avec redirect localhost
 *
 * SECURITY FIX [Critique] : Les tokens sensibles (msRefreshToken, mcAccessToken)
 * sont désormais chiffrés au repos via electron.safeStorage (DPAPI sur Windows,
 * Keychain sur macOS, libsecret/kwallet sur Linux).
 * Le store JSON ne conserve plus que les métadonnées non-sensibles (profil, expiresAt).
 *
 * Clés introduites dans le store :
 *   auth            → { expiresAt, profile }        (non-sensible, JSON)
 *   auth_enc_rt     → Buffer chiffré (refreshToken)  (safeStorage)
 *   auth_enc_at     → Buffer chiffré (accessToken)   (safeStorage)
 *
 * Rétrocompatibilité : si des tokens en clair existent déjà dans le store,
 * ils sont migrés automatiquement au premier démarrage puis supprimés.
 */

const fetch   = require('node-fetch');
const http    = require('http');
const crypto  = require('crypto');
const { shell, safeStorage } = require('electron');

const CLIENT_ID    = '17e9ab18-295d-4fa9-85d4-c74fae7d184e';
const REDIRECT_URI = 'http://localhost:3000/callback';
const SCOPE        = 'XboxLive.signin offline_access';
const TENANT       = 'consumers';
const PORT         = 3000;

const MS_AUTH_BASE   = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0`;
const XBL_AUTH       = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_AUTH      = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MC_LOGIN       = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MC_PROFILE     = 'https://api.minecraftservices.com/minecraft/profile';
const MC_ENTITLEMENT = 'https://api.minecraftservices.com/entitlements/mcstore';

// Keys used in the store
const KEY_AUTH_META = 'auth';          // { expiresAt, profile }
const KEY_ENC_RT    = 'auth_enc_rt';   // encrypted refresh token (hex-encoded Buffer)
const KEY_ENC_AT    = 'auth_enc_at';   // encrypted access token  (hex-encoded Buffer)

class MicrosoftAuth {
  constructor(store) {
    this._store  = store;
    this._server = null;
    this._migrateIfNeeded();
  }

  // ── Migration des tokens en clair (rétrocompatibilité) ──────────────────
  _migrateIfNeeded() {
    if (!safeStorage.isEncryptionAvailable()) return;

    const stored = this._store.get(KEY_AUTH_META);
    // Ancien format : le store contenait msRefreshToken / mcAccessToken en clair
    if (stored?.msRefreshToken || stored?.mcAccessToken) {
      console.log('[auth] Migrating plaintext tokens → safeStorage');
      try {
        if (stored.msRefreshToken) this._storeEncrypted(KEY_ENC_RT, stored.msRefreshToken);
        if (stored.mcAccessToken)  this._storeEncrypted(KEY_ENC_AT, stored.mcAccessToken);
        // Réécrire le meta sans les tokens sensibles
        const { msRefreshToken, mcAccessToken, ...safe } = stored;
        this._store.set(KEY_AUTH_META, safe);
      } catch (e) {
        console.warn('[auth] Migration failed, clearing auth state:', e.message);
        this.logout();
      }
    }
  }

  // ── Chiffrement / déchiffrement ──────────────────────────────────────────
  _storeEncrypted(key, plaintext) {
    if (!safeStorage.isEncryptionAvailable()) {
      // Fallback (CI sans display server, etc.) : ne PAS stocker en clair,
      // plutôt ne rien stocker — l'utilisateur devra se reconnecter.
      console.warn(`[auth] safeStorage unavailable — not persisting ${key}`);
      return;
    }
    const encrypted = safeStorage.encryptString(plaintext);
    // Stocker en hex pour que store.json reste un JSON valide (Buffer non sérialisable)
    this._store.set(key, encrypted.toString('hex'));
  }

  _loadDecrypted(key) {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const hex = this._store.get(key);
    if (!hex) return null;
    try {
      return safeStorage.decryptString(Buffer.from(hex, 'hex'));
    } catch (e) {
      console.warn(`[auth] Failed to decrypt ${key}:`, e.message);
      return null;
    }
  }

  // ── Persistance sécurisée de la session ──────────────────────────────────
  _persistSession(msRefreshToken, mcAccessToken, expiresIn, profile) {
    // Chiffrer les secrets
    this._storeEncrypted(KEY_ENC_RT, msRefreshToken);
    this._storeEncrypted(KEY_ENC_AT, mcAccessToken);
    // Stocker les métadonnées non-sensibles en JSON
    this._store.set(KEY_AUTH_META, {
      expiresAt: Date.now() + (expiresIn || 86400) * 1000,
      profile,
    });
  }

  // ── Démarrer le flux d'auth ───────────────────────────────────────────────
  async startLoginDeviceCode(onUpdate = null) {
    const device = await this._requestDeviceCode();
    if (typeof onUpdate === 'function') {
      onUpdate({
        userCode: device.user_code,
        verificationUri: device.verification_uri,
        verificationUriComplete: device.verification_uri_complete,
        expiresIn: device.expires_in,
        interval: device.interval,
        message: device.message,
      });
    }

    const openUrl = device.verification_uri_complete || device.verification_uri;
    if (openUrl) {
      try { await shell.openExternal(openUrl); } catch {}
    }

    return await this._pollDeviceCodeToken(device);
  }

  async _requestDeviceCode() {
    const res = await fetch(`${MS_AUTH_BASE}/devicecode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        scope: SCOPE,
      }),
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`Reponse device code invalide (${res.status})`); }

    if (!res.ok || data.error) {
      throw new Error(`Device code refuse (${res.status}): ${data.error_description || data.error || 'unknown_error'}`);
    }
    if (!data.device_code || !data.user_code) {
      throw new Error('Reponse device code incomplete');
    }
    return data;
  }

  async _pollDeviceCodeToken(deviceData) {
    const startedAt = Date.now();
    const expiresAt = startedAt + (Number(deviceData.expires_in || 900) * 1000);
    let intervalMs = Math.max(2, Number(deviceData.interval || 5)) * 1000;

    while (Date.now() < expiresAt) {
      await new Promise(r => setTimeout(r, intervalMs));

      const res = await fetch(`${MS_AUTH_BASE}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          client_id: CLIENT_ID,
          device_code: deviceData.device_code,
        }),
      });

      const text = await res.text();
      let data = {};
      try { data = JSON.parse(text); } catch {}

      if (res.ok && data.access_token) {
        return {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresIn: data.expires_in,
        };
      }

      const err = String(data.error || '').toLowerCase();
      if (err === 'authorization_pending') continue;
      if (err === 'slow_down') {
        intervalMs += 1000;
        continue;
      }
      if (err === 'authorization_declined') throw new Error('Connexion annulee dans le navigateur.');
      if (err === 'expired_token') throw new Error('Le code de connexion a expire. Reessaie.');
      if (err === 'bad_verification_code') throw new Error('Code de verification invalide.');

      throw new Error(`Echec du device flow (${res.status}): ${data.error_description || data.error || 'unknown_error'}`);
    }

    throw new Error('Timeout: la connexion Microsoft a expire.');
  }

  async startLogin() {
    const state = crypto.randomBytes(16).toString('hex');

    const code = await Promise.race([
      this._waitForCallback(state),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout : connexion non complétée en 5 minutes')), 5 * 60 * 1000)
      ),
    ]);

    return code;
  }

  // ── Serveur HTTP local pour recevoir le callback ──────────────────────────
  _waitForCallback(expectedState) {
    return new Promise((resolve, reject) => {
      if (this._server) {
        try { this._server.close(); } catch {}
        this._server = null;
      }

      this._server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://localhost:${PORT}`);

        // Respond 204 to favicon/noise so the browser doesn't show a connection error
        if (url.pathname !== '/callback') {
          res.writeHead(204);
          res.end();
          return;
        }

        const code      = url.searchParams.get('code');
        const state     = url.searchParams.get('state');
        const error     = url.searchParams.get('error');
        const errorDesc = url.searchParams.get('error_description');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (error) {
          res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Erreur</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#020617;color:#EF4444}.box{text-align:center;padding:40px}</style></head>
<body><div class="box"><h2>❌ Erreur de connexion</h2><p>${errorDesc || error}</p>
<p style="color:#94A3B8;margin-top:20px">Vous pouvez fermer cette fenêtre.</p></div></body></html>`);
        } else {
          // Auto-close the tab after 2 s — user is already back in the launcher
          res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connecté</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#020617;color:#22C55E}.box{text-align:center;padding:40px}</style></head>
<body><div class="box"><h2>✓ Connexion réussie !</h2>
<p style="color:#E2E8F0">Vous pouvez fermer cette fenêtre et retourner sur le launcher.</p>
<p style="color:#64748B;font-size:12px;margin-top:12px">Cette fenêtre se fermera automatiquement...</p></div>
<script>setTimeout(()=>window.close(),2000);</script></body></html>`);
        }

        // Close server after response is flushed
        setTimeout(() => {
          if (this._server) { this._server.close(); this._server = null; }
        }, 500);

        if (error)                   { reject(new Error(`Microsoft auth refusé : ${errorDesc || error}`)); return; }
        if (state !== expectedState) { reject(new Error('State mismatch — possible CSRF')); return; }
        if (!code)                   { reject(new Error('Code absent dans le callback')); return; }
        resolve(code);
      });

      this._server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
          reject(new Error(`Le port ${PORT} est déjà utilisé. Fermez l'application qui l'occupe et réessayez.`));
        } else {
          reject(e);
        }
      });

      // Open the browser ONLY once the server is actually listening
      this._server.listen(PORT, '127.0.0.1', () => {
        const params = new URLSearchParams({
          client_id:     CLIENT_ID,
          response_type: 'code',
          redirect_uri:  REDIRECT_URI,
          scope:         SCOPE,
          state:         expectedState,
          prompt:        'select_account',
        });
        shell.openExternal(`${MS_AUTH_BASE}/authorize?${params}`);
      });
    });
  }

  // ── Échanger le code contre des tokens ────────────────────────────────────
  async exchangeCode(code) {
    const res = await fetch(`${MS_AUTH_BASE}/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        code,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
        scope:         SCOPE,
      }),
    });

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`Réponse MS non-JSON (${res.status}): ${text.slice(0, 200)}`); }

    if (!res.ok || data.error) {
      throw new Error(`Échange de code échoué (${res.status}): ${data.error_description || data.error}`);
    }
    if (!data.access_token) throw new Error('access_token absent dans la réponse');

    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  }

  // ── Chaîne complète MS → XBL → XSTS → Minecraft ──────────────────────────
  async _fullAuthChain(msAccessToken, msRefreshToken) {
    // 1. Xbox Live
    const xblRes = await fetch(XBL_AUTH, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        Properties:   { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType:    'JWT',
      }),
    });
    if (!xblRes.ok) throw new Error(`XBL auth échoué (${xblRes.status})`);
    const xblData  = await xblRes.json();
    const xblToken = xblData.Token;
    const userHash = xblData.DisplayClaims?.xui?.[0]?.uhs;
    if (!xblToken || !userHash) throw new Error('XBL : token ou userHash manquant');

    // 2. XSTS
    const xstsRes  = await fetch(XSTS_AUTH, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        Properties:   { SandboxId: 'RETAIL', UserTokens: [xblToken] },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType:    'JWT',
      }),
    });
    const xstsText = await xstsRes.text();
    let xstsData;
    try { xstsData = JSON.parse(xstsText); }
    catch { throw new Error(`XSTS réponse invalide (${xstsRes.status}): ${xstsText.slice(0, 200)}`); }

    if (xstsData.XErr) {
      const XERR = {
        2148916233: 'Ce compte n\'a pas de profil Xbox. Créez-en un sur xbox.com.',
        2148916235: 'Xbox Live n\'est pas disponible dans votre pays.',
        2148916238: 'Compte enfant : ajoutez-le à une famille Xbox sur xbox.com.',
      };
      throw new Error(XERR[xstsData.XErr] || `XSTS Error: ${xstsData.XErr}`);
    }
    if (!xstsRes.ok) throw new Error(`XSTS échoué (${xstsRes.status}): ${xstsText.slice(0, 200)}`);
    const xstsToken = xstsData.Token;
    if (!xstsToken) throw new Error(`XSTS Token absent. Réponse: ${xstsText.slice(0, 400)}`);

    // 3. Minecraft
    const mcRes  = await fetch(MC_LOGIN, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identityToken: `XBL3.0 x=${userHash};${xstsToken}` }),
    });
    const mcText = await mcRes.text();
    if (!mcRes.ok) throw new Error(`Minecraft login échoué (${mcRes.status}): ${mcText.slice(0, 300)}`);
    let mcData;
    try { mcData = JSON.parse(mcText); }
    catch { throw new Error(`MC login réponse invalide: ${mcText.slice(0, 200)}`); }
    const mcToken = mcData.access_token;
    if (!mcToken) throw new Error('Minecraft : access_token manquant');

    // 4. Vérifier possession du jeu
    const entRes  = await fetch(MC_ENTITLEMENT, { headers: { Authorization: `Bearer ${mcToken}` } });
    const entData = await entRes.json();
    const ownsGame = (entData.items || []).some(
      i => i.name === 'product_minecraft' || i.name === 'game_minecraft'
    );
    if (!ownsGame) throw new Error('Ce compte ne possède pas Minecraft Java Edition.');

    // 5. Profil
    const profileRes = await fetch(MC_PROFILE, { headers: { Authorization: `Bearer ${mcToken}` } });
    if (!profileRes.ok) throw new Error(`Profil Minecraft introuvable (${profileRes.status})`);
    const profile = await profileRes.json();
    if (!profile.id || !profile.name) throw new Error('Profil Minecraft invalide');

    // ── Persister de façon sécurisée (chiffrée) ──────────────────────────────
    this._persistSession(msRefreshToken, mcToken, mcData.expires_in, {
      id: profile.id, name: profile.name, skins: profile.skins || [],
    });

    return this._store.get(KEY_AUTH_META).profile;
  }

  // ── Refresh silencieux ────────────────────────────────────────────────────
  async _refreshToken(refreshToken) {
    const res = await fetch(`${MS_AUTH_BASE}/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
        scope:         SCOPE,
      }),
    });
    if (!res.ok) throw new Error('Token refresh failed');
    const data = await res.json();
    if (!data.access_token) throw new Error('Refresh: access_token manquant');
    return this._fullAuthChain(data.access_token, data.refresh_token);
  }

  // ── Profil courant (avec auto-refresh) ───────────────────────────────────
  async getProfile() {
    const meta = this._store.get(KEY_AUTH_META);
    if (!meta?.profile) return null;

    if (Date.now() > meta.expiresAt - 300_000) {
      const rt = this._loadDecrypted(KEY_ENC_RT);
      if (!rt) { this.logout(); return null; }
      try {
        await this._refreshToken(rt);
        return this._store.get(KEY_AUTH_META)?.profile ?? null;
      } catch {
        this.logout();
        return null;
      }
    }
    return meta.profile;
  }

  getStoredToken() { return this._loadDecrypted(KEY_ENC_AT); }
  getStoredUUID()  { return this._store.get(KEY_AUTH_META)?.profile?.id ?? null; }

  logout() {
    this._store.delete(KEY_AUTH_META);
    this._store.delete(KEY_ENC_RT);
    this._store.delete(KEY_ENC_AT);
  }
}

module.exports = MicrosoftAuth;
