// TradeOS — Google Drive (appDataFolder) backup/restore + Google Sheets export.
// Browser-side, on-demand OAuth via Google Identity Services token client.
// Drive is treated as backup-only; Worker/KV + localStorage remain primary.
//
// Scopes are requested on-demand and only when the user clicks a feature button:
//   Backup/Restore: https://www.googleapis.com/auth/drive.appdata
//   Export Sheets:  https://www.googleapis.com/auth/drive.file
//                   https://www.googleapis.com/auth/spreadsheets
//
// Existing sign-in (login.html) keeps openid/email/profile only.

(function () {
  'use strict';

  var GOOGLE_CLIENT_ID = '421306806975-bnktjac5i2g8js8sadr8lrfdtm0age02.apps.googleusercontent.com';
  var WORKER_BASE = 'https://tradeos-proxy.gordon-foustiii.workers.dev';
  var BACKUP_FILENAME = 'tradeos-backup.json';
  var BACKUP_VERSION = 1;
  var GIS_SRC = 'https://accounts.google.com/gsi/client';

  // ── Token cache (in-memory only; we never persist Drive/Sheets tokens) ──
  var _tokenCache = {}; // scope-key → { token, expiresAt }
  var _gisLoading = null;

  function loadGIS() {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      return Promise.resolve();
    }
    if (_gisLoading) return _gisLoading;
    _gisLoading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Failed to load Google Identity Services')); };
      document.head.appendChild(s);
    });
    return _gisLoading;
  }

  function scopeKey(scopes) {
    return scopes.slice().sort().join(' ');
  }

  // Request an OAuth access token for the given scopes. Uses GIS token client.
  // Returns a Promise<string> resolving with the access_token.
  function getAccessToken(scopes, opts) {
    opts = opts || {};
    var key = scopeKey(scopes);
    var now = Date.now();
    var cached = _tokenCache[key];
    if (cached && cached.expiresAt - 60000 > now) {
      return Promise.resolve(cached.token);
    }

    return loadGIS().then(function () {
      return new Promise(function (resolve, reject) {
        var hint = '';
        try {
          var idToken = localStorage.getItem('tradeos_id_token');
          if (idToken) {
            var payload = JSON.parse(atob(idToken.split('.')[1]));
            if (payload && payload.email) hint = payload.email;
          }
        } catch (_) {}

        var client = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: scopes.join(' '),
          hint: hint || undefined,
          prompt: opts.prompt || '', // '' = silent if previously granted
          callback: function (resp) {
            if (resp && resp.error) {
              reject(new Error(humanAuthError(resp.error)));
              return;
            }
            if (!resp || !resp.access_token) {
              reject(new Error('No access token returned by Google.'));
              return;
            }
            var expiresIn = (resp.expires_in || 3600) * 1000;
            _tokenCache[key] = {
              token: resp.access_token,
              expiresAt: Date.now() + expiresIn
            };
            resolve(resp.access_token);
          },
          error_callback: function (err) {
            reject(new Error(humanAuthError((err && err.type) || 'unknown_error')));
          }
        });
        try {
          client.requestAccessToken({ prompt: opts.prompt || '' });
        } catch (e) {
          reject(new Error('Could not request Google access token: ' + e.message));
        }
      });
    });
  }

  function humanAuthError(code) {
    switch (code) {
      case 'access_denied':
      case 'user_cancel':
      case 'popup_closed':
        return 'Google authorization was cancelled. Please try again and approve access.';
      case 'popup_failed_to_open':
        return 'Could not open the Google popup. Allow popups for this site and try again.';
      case 'immediate_failed':
        return 'Silent authorization failed; please retry — you may need to grant access.';
      default:
        return 'Google authorization failed (' + code + ').';
    }
  }

  // ── Generic fetch helper with friendly error mapping ──
  function gfetch(url, opts, accessToken) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    opts.headers['Authorization'] = 'Bearer ' + accessToken;
    return fetch(url, opts).then(function (res) {
      if (res.status === 401) {
        // token expired / revoked
        Object.keys(_tokenCache).forEach(function (k) { delete _tokenCache[k]; });
        throw new Error('Google access token expired. Please retry to re-authorize.');
      }
      if (res.status === 403) {
        return res.text().then(function (t) {
          throw new Error('Google denied the request (403). ' + truncate(t, 240));
        });
      }
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('Google API error ' + res.status + ': ' + truncate(t, 240));
        });
      }
      var ct = res.headers.get('content-type') || '';
      if (ct.indexOf('application/json') >= 0) return res.json();
      return res.text();
    }, function (e) {
      // network-level
      throw new Error('Network error talking to Google: ' + (e.message || e));
    });
  }

  function truncate(s, n) {
    if (!s) return '';
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  // ── Collect TradeOS app data ──
  function readLocalPlans() {
    try {
      var raw = localStorage.getItem('tradeos_local_plans');
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }
  function readScanCriteria() {
    try { return JSON.parse(localStorage.getItem('tradeos_scan_criteria') || 'null'); }
    catch (_) { return null; }
  }
  function getIdToken() {
    return localStorage.getItem('tradeos_id_token') || '';
  }
  function getUserEmail() {
    try {
      var t = getIdToken();
      if (!t) return '';
      var p = JSON.parse(atob(t.split('.')[1]));
      return p && p.email ? p.email : '';
    } catch (_) { return ''; }
  }

  function fetchWorker(path) {
    var tok = getIdToken();
    var headers = {};
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
    return fetch(WORKER_BASE + path, { headers: headers, cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('Worker ' + path + ' failed: ' + r.status);
        return r.json();
      });
  }

  function collectAppData() {
    // Pull remote plans + remote trades in parallel; never block on failure.
    var plansP = fetchWorker('/scan/plans').then(
      function (d) { return (d && d.plans) || []; },
      function () { return []; }
    );
    var tradesP = fetchWorker('?action=trades').then(
      function (d) {
        if (!d) return [];
        if (Array.isArray(d)) return d;
        if (Array.isArray(d.trades)) return d.trades;
        return [];
      },
      function () { return []; }
    );
    var habitsP = fetchWorker('?action=getHabits').then(
      function (d) { return d || null; },
      function () { return null; }
    );
    return Promise.all([plansP, tradesP, habitsP]).then(function (arr) {
      var remotePlans = arr[0];
      var trades = arr[1];
      var habits = arr[2];
      var localPlans = readLocalPlans();
      return {
        backupVersion: BACKUP_VERSION,
        exportedAt: new Date().toISOString(),
        app: 'TradeOS',
        user: { email: getUserEmail() || null },
        sections: {
          plansRemote: remotePlans,
          plansLocal: localPlans,
          trades: trades,
          habits: habits,
          scanCriteria: readScanCriteria()
        }
      };
    });
  }

  // ── Drive appDataFolder helpers ──
  function findBackupFile(token) {
    var url = 'https://www.googleapis.com/drive/v3/files'
      + '?spaces=appDataFolder'
      + '&q=' + encodeURIComponent("name='" + BACKUP_FILENAME + "' and trashed=false")
      + '&fields=files(id,name,modifiedTime,size)';
    return gfetch(url, { method: 'GET' }, token).then(function (data) {
      var files = (data && data.files) || [];
      return files.length ? files[0] : null;
    });
  }

  function multipartBody(metadata, jsonText, boundary) {
    return (
      '--' + boundary + '\r\n' +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) + '\r\n' +
      '--' + boundary + '\r\n' +
      'Content-Type: application/json\r\n\r\n' +
      jsonText + '\r\n' +
      '--' + boundary + '--'
    );
  }

  function uploadBackupFile(token, existingId, payload) {
    var boundary = 'tradeos-' + Math.random().toString(36).slice(2);
    var jsonText = JSON.stringify(payload);
    var metadata;
    var url;
    var method;
    if (existingId) {
      metadata = { name: BACKUP_FILENAME };
      url = 'https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(existingId)
        + '?uploadType=multipart&fields=id,name,modifiedTime,size';
      method = 'PATCH';
    } else {
      metadata = { name: BACKUP_FILENAME, parents: ['appDataFolder'] };
      url = 'https://www.googleapis.com/upload/drive/v3/files'
        + '?uploadType=multipart&fields=id,name,modifiedTime,size';
      method = 'POST';
    }
    return gfetch(url, {
      method: method,
      headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
      body: multipartBody(metadata, jsonText, boundary)
    }, token);
  }

  function downloadBackupFile(token, fileId) {
    var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media';
    return fetch(url, { headers: { 'Authorization': 'Bearer ' + token } }).then(function (r) {
      if (r.status === 401) {
        Object.keys(_tokenCache).forEach(function (k) { delete _tokenCache[k]; });
        throw new Error('Google access token expired. Please retry.');
      }
      if (!r.ok) throw new Error('Could not download backup (' + r.status + ').');
      return r.json();
    }, function (e) {
      throw new Error('Network error downloading backup: ' + (e.message || e));
    });
  }

  // ── Public: backup ──
  function backupToDrive() {
    var scopes = ['https://www.googleapis.com/auth/drive.appdata'];
    var token;
    return getAccessToken(scopes)
      .then(function (t) { token = t; return collectAppData(); })
      .then(function (payload) {
        return findBackupFile(token).then(function (existing) {
          return uploadBackupFile(token, existing && existing.id, payload).then(function (file) {
            return {
              ok: true,
              fileId: file.id,
              modifiedTime: file.modifiedTime,
              size: file.size,
              counts: summarize(payload)
            };
          });
        });
      });
  }

  function summarize(payload) {
    var s = (payload && payload.sections) || {};
    return {
      plansRemote: (s.plansRemote || []).length,
      plansLocal: (s.plansLocal || []).length,
      trades: (s.trades || []).length,
      habits: s.habits ? 1 : 0,
      scanCriteria: s.scanCriteria ? 1 : 0
    };
  }

  // ── Public: peek backup metadata (for confirmation UI) ──
  function describeBackup() {
    var scopes = ['https://www.googleapis.com/auth/drive.appdata'];
    var token;
    return getAccessToken(scopes)
      .then(function (t) { token = t; return findBackupFile(token); })
      .then(function (file) {
        if (!file) return { found: false };
        return downloadBackupFile(token, file.id).then(function (payload) {
          return {
            found: true,
            fileId: file.id,
            modifiedTime: file.modifiedTime,
            size: file.size,
            backupVersion: payload && payload.backupVersion,
            exportedAt: payload && payload.exportedAt,
            user: payload && payload.user,
            counts: summarize(payload)
          };
        });
      });
  }

  // ── Public: restore. Caller is responsible for showing the confirm prompt. ──
  // Restore is conservative: it merges local plans (does NOT wipe other localStorage keys),
  // and re-uploads remote plans to the Worker via /scan/plan. Trades are NOT pushed back
  // to the Worker (no bulk-upsert endpoint exists); the user is informed in the summary.
  function restoreFromDrive(opts) {
    opts = opts || {};
    var scopes = ['https://www.googleapis.com/auth/drive.appdata'];
    var token;
    return getAccessToken(scopes)
      .then(function (t) { token = t; return findBackupFile(token); })
      .then(function (file) {
        if (!file) throw new Error('No TradeOS backup was found in your Google Drive.');
        return downloadBackupFile(token, file.id);
      })
      .then(function (payload) {
        if (!payload || payload.app !== 'TradeOS') {
          throw new Error('Backup file is not recognised as a TradeOS backup.');
        }
        var sections = payload.sections || {};
        var summary = {
          plansLocalRestored: 0,
          plansRemoteResynced: 0,
          remoteResyncFailed: 0,
          scanCriteriaRestored: false,
          tradesSkipped: (sections.trades || []).length,
          habitsSkipped: sections.habits ? 1 : 0,
          backupExportedAt: payload.exportedAt
        };

        // 1) Restore local plans (merge by ticker; backup wins on conflict).
        try {
          var current = readLocalPlans();
          var byTicker = {};
          current.forEach(function (p) {
            if (p && p.ticker) byTicker[p.ticker.toUpperCase()] = p;
          });
          (sections.plansLocal || []).forEach(function (p) {
            if (p && p.ticker) {
              byTicker[p.ticker.toUpperCase()] = Object.assign({}, p, { synced: false });
              summary.plansLocalRestored++;
            }
          });
          var merged = Object.keys(byTicker).map(function (k) { return byTicker[k]; });
          localStorage.setItem('tradeos_local_plans', JSON.stringify(merged));
        } catch (e) {
          throw new Error('Could not write restored plans to local storage: ' + e.message);
        }

        // 2) Restore scan criteria if present and user wants it.
        if (sections.scanCriteria && opts.restoreScanCriteria !== false) {
          try {
            localStorage.setItem('tradeos_scan_criteria', JSON.stringify(sections.scanCriteria));
            summary.scanCriteriaRestored = true;
          } catch (_) {}
        }

        // 3) Best-effort: re-push remote plans to the Worker so they reappear in /scan/plans.
        var remotePlans = sections.plansRemote || [];
        if (!remotePlans.length || opts.resyncRemote === false) {
          return summary;
        }
        var idTok = getIdToken();
        if (!idTok) {
          summary.remoteResyncFailed = remotePlans.length;
          return summary;
        }
        return remotePlans.reduce(function (chain, plan) {
          return chain.then(function () {
            if (!plan || !plan.ticker) return;
            return fetch(WORKER_BASE + '/scan/plan', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + idTok
              },
              body: JSON.stringify({ ticker: plan.ticker, plan: plan })
            }).then(function (r) {
              if (r.ok) summary.plansRemoteResynced++;
              else summary.remoteResyncFailed++;
            }, function () { summary.remoteResyncFailed++; });
          });
        }, Promise.resolve()).then(function () { return summary; });
      });
  }

  // ── Public: export to Google Sheets (one spreadsheet, two tabs) ──
  function exportToSheets() {
    var scopes = [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/spreadsheets'
    ];
    var token;
    return getAccessToken(scopes)
      .then(function (t) { token = t; return collectAppData(); })
      .then(function (payload) {
        var trades = (payload.sections && payload.sections.trades) || [];
        var plans = []
          .concat(payload.sections.plansRemote || [])
          .concat(payload.sections.plansLocal || []);

        // Dedupe plans by ticker+savedAt; remote wins.
        var seen = {};
        var combinedPlans = [];
        plans.forEach(function (p) {
          if (!p) return;
          var key = (p.ticker || '') + '|' + (p.savedAt || '');
          if (seen[key]) return;
          seen[key] = true;
          combinedPlans.push(p);
        });

        var stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
        var title = 'TradeOS Export — ' + stamp;
        var spreadsheet = {
          properties: { title: title },
          sheets: [
            { properties: { title: 'Trades' } },
            { properties: { title: 'Plans' } }
          ]
        };
        return gfetch('https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(spreadsheet)
        }, token).then(function (created) {
          var id = created.spreadsheetId;
          var url = created.spreadsheetUrl
            || ('https://docs.google.com/spreadsheets/d/' + id + '/edit');

          var tradesValues = rowsFromObjects(trades);
          var plansValues = rowsFromObjects(combinedPlans);

          var data = [];
          if (tradesValues.length) {
            data.push({ range: 'Trades!A1', majorDimension: 'ROWS', values: tradesValues });
          }
          if (plansValues.length) {
            data.push({ range: 'Plans!A1', majorDimension: 'ROWS', values: plansValues });
          }
          if (!data.length) {
            return { ok: true, spreadsheetId: id, url: url, trades: 0, plans: 0, note: 'No data to write.' };
          }
          var body = { valueInputOption: 'RAW', data: data };
          return gfetch(
            'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(id)
              + '/values:batchUpdate',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            },
            token
          ).then(function () {
            return {
              ok: true,
              spreadsheetId: id,
              url: url,
              trades: Math.max(0, tradesValues.length - 1),
              plans: Math.max(0, plansValues.length - 1)
            };
          });
        });
      });
  }

  // Convert an array of objects into [headerRow, ...dataRows] for Sheets.
  // Stable column order: union of keys, sorted, with common ones first.
  function rowsFromObjects(items) {
    if (!items || !items.length) return [];
    var keySet = {};
    items.forEach(function (it) {
      if (it && typeof it === 'object') {
        Object.keys(it).forEach(function (k) { keySet[k] = true; });
      }
    });
    var preferred = [
      'ticker', 'date', 'savedAt', 'status', 'rating',
      'entry', 'stop', 'target', 'shares', 'support', 'resistance',
      'pnl', 'side', 'notes', 'catalysts', 'catalystNote', 'kind', 'source'
    ];
    var keys = [];
    preferred.forEach(function (k) { if (keySet[k]) { keys.push(k); delete keySet[k]; } });
    Object.keys(keySet).sort().forEach(function (k) { keys.push(k); });

    var rows = [keys];
    items.forEach(function (it) {
      var row = keys.map(function (k) {
        var v = it ? it[k] : '';
        if (v == null) return '';
        if (typeof v === 'object') {
          try { return JSON.stringify(v); } catch (_) { return String(v); }
        }
        return v;
      });
      rows.push(row);
    });
    return rows;
  }

  // ── Public API ──
  window.TradeOSGoogle = {
    backupToDrive: backupToDrive,
    describeBackup: describeBackup,
    restoreFromDrive: restoreFromDrive,
    exportToSheets: exportToSheets,
    // exposed for tests / debugging
    _internals: {
      collectAppData: collectAppData,
      rowsFromObjects: rowsFromObjects
    }
  };
})();
