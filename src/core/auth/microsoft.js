'use strict';
/**
 * Microsoft Authentication — Authorization Code Flow avec redirect localhost
 *
 * Utilisé par tous les launchers Minecraft tiers sérieux (Prism, MultiMC…).
 * Avantages vs Device Code Flow :
 *  - Pas d'app vérifiée requise
 *  - Pas d'écran d'avertissement Microsoft
 *  - Flux standard, reconnu par Microsoft pour les apps natives
 *
 * Flux :
 *  1. Lancer un serveur HTTP temporaire sur localhost:PORT
 *  2. Ouvrir le navigateur → URL d'auth Microsoft
 *  3. L'utilisateur se connecte, Microsoft redirige vers localhost:PORT/callback
 *  4. Récupérer le `code` dans l'URL de callback
 *  5. Échanger le code contre des tokens
 *  6. Chaîne XBL → XSTS → Minecraft
 *
 * Dans Azure/Entra ID :
 *  - URI de redirection : http://localhost:3000/callback  (type : Web OU natif)
 */

const fetch  = require('node-fetch');
const http   = require('http');
const crypto = require('crypto');
const { shell } = require('electron');

const CLIENT_ID    = '17e9ab18-295d-4fa9-85d4-c74fae7d184e';
const REDIRECT_URI = 'http://localhost:3000/callback';
const SCOPE        = 'XboxLive.signin offline_access';
const TENANT       = 'consumers';
const PORT         = 3000;

const MS_AUTH_BASE  = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0`;
const XBL_AUTH      = 'https://user.auth.xboxlive.com/user/authenticate';
const XSTS_AUTH     = 'https://xsts.auth.xboxlive.com/xsts/authorize';
const MC_LOGIN      = 'https://api.minecraftservices.com/authentication/login_with_xbox';
const MC_PROFILE    = 'https://api.minecraftservices.com/minecraft/profile';
const MC_ENTITLEMENT = 'https://api.minecraftservices.com/entitlements/mcstore';

class MicrosoftAuth {
  constructor(store) {
    this._store  = store;
    this._server = null;
  }

  // ── Démarrer le flux d'auth ───────────────────────────────────────────────
  async startLogin() {
    // Générer un state aléatoire anti-CSRF
    const state = crypto.randomBytes(16).toString('hex');

    // Construire l'URL d'autorisation Microsoft
    const params = new URLSearchParams({
      client_id:     CLIENT_ID,
      response_type: 'code',
      redirect_uri:  REDIRECT_URI,
      scope:         SCOPE,
      state,
      prompt:        'select_account',
    });
    const authUrl = `${MS_AUTH_BASE}/authorize?${params}`;

    // Démarrer le serveur local AVANT d'ouvrir le navigateur
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
      // Fermer un éventuel serveur précédent
      if (this._server) {
        try { this._server.close(); } catch {}
        this._server = null;
      }

      this._server = http.createServer((req, res) => {
        const url = new URL(req.url, `http://localhost:${PORT}`);
        if (url.pathname !== '/callback') {
          res.end('Not found');
          return;
        }

        const code  = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');
        const errorDesc = url.searchParams.get('error_description');

        // Répondre avec une page HTML propre
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (error) {
          res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Erreur</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#020617;color:#EF4444}
.box{text-align:center;padding:40px}</style></head>
<body><div class="box"><h2>❌ Erreur de connexion</h2><p>${errorDesc || error}</p>
<p style="color:#94A3B8;margin-top:20px">Vous pouvez fermer cette fenêtre.</p></div></body></html>`);
        } else {
          res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connecté</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#020617;color:#22C55E}
.box{text-align:center;padding:40px}</style></head>
<body><div class="box"><h2>✓ Connexion réussie !</h2>
<p style="color:#E2E8F0">Vous pouvez fermer cette fenêtre et retourner sur le launcher.</p></div></body></html>`);
        }

        // Fermer le serveur proprement après la réponse
        setTimeout(() => {
          if (this._server) {
            this._server.close();
            this._server = null;
          }
        }, 500);

        if (error) {
          reject(new Error(`Microsoft auth refusé : ${errorDesc || error}`));
          return;
        }
        if (state !== expectedState) {
          reject(new Error('State mismatch — possible CSRF'));
          return;
        }
        if (!code) {
          reject(new Error('Code absent dans le callback'));
          return;
        }

        resolve(code);
      });

      this._server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
          reject(new Error(`Le port ${PORT} est déjà utilisé. Fermez l'application qui l'occupe et réessayez.`));
        } else {
          reject(e);
        }
      });

      this._server.listen(PORT, '127.0.0.1', () => {
        // Serveur prêt → ouvrir le navigateur
        const params = new URLSearchParams({
          client_id:     CLIENT_ID,
          response_type: 'code',
          redirect_uri:  REDIRECT_URI,
          scope:         SCOPE,
          state:         expectedState,
          prompt:        'select_account',
        });
        const authUrl = `${MS_AUTH_BASE}/authorize?${params}`;
        shell.openExternal(authUrl);
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
    const xstsRes = await fetch(XSTS_AUTH, {
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
    catch { throw new Error(`XSTS réponse invalide (${xstsRes.status}): ${xstsText.slice(0,200)}`); }

    console.log('[auth] XSTS status:', xstsRes.status, 'XErr:', xstsData.XErr, 'Token:', !!xstsData.Token);

    if (xstsData.XErr) {
      const XERR = {
        2148916233: 'Ce compte n\'a pas de profil Xbox. Créez-en un sur xbox.com.',
        2148916235: 'Xbox Live n\'est pas disponible dans votre pays.',
        2148916238: 'Compte enfant : ajoutez-le à une famille Xbox sur xbox.com.',
      };
      throw new Error(XERR[xstsData.XErr] || `XSTS Error: ${xstsData.XErr}`);
    }
    if (!xstsRes.ok) throw new Error(`XSTS échoué (${xstsRes.status}): ${xstsText.slice(0,200)}`);

    const xstsToken = xstsData.Token;
    if (!xstsToken) throw new Error(`XSTS Token absent. Réponse complète: ${xstsText.slice(0,400)}`);

    // 3. Minecraft
    const mcRes = await fetch(MC_LOGIN, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identityToken: `XBL3.0 x=${userHash};${xstsToken}` }),
    });
    const mcText = await mcRes.text();
    console.log('[auth] MC login status:', mcRes.status, 'body:', mcText.slice(0,300));
    if (!mcRes.ok) throw new Error(`Minecraft login échoué (${mcRes.status}): ${mcText.slice(0,300)}`);
    let mcData;
    try { mcData = JSON.parse(mcText); }
    catch { throw new Error(`MC login réponse invalide: ${mcText.slice(0,200)}`); }
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

    const stored = {
      msRefreshToken,
      mcAccessToken: mcToken,
      expiresAt:     Date.now() + (mcData.expires_in || 86400) * 1000,
      profile: { id: profile.id, name: profile.name, skins: profile.skins || [] },
    };
    this._store.set('auth', stored);
    return stored.profile;
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
    const stored = this._store.get('auth');
    if (!stored) return null;
    if (Date.now() > stored.expiresAt - 300_000) {
      try {
        await this._refreshToken(stored.msRefreshToken);
        return this._store.get('auth')?.profile ?? null;
      } catch {
        this.logout();
        return null;
      }
    }
    return stored.profile;
  }

  getStoredToken() { return this._store.get('auth')?.mcAccessToken ?? null; }
  getStoredUUID()  { return this._store.get('auth')?.profile?.id   ?? null; }
  logout()         { this._store.delete('auth'); }
}

module.exports = MicrosoftAuth;
