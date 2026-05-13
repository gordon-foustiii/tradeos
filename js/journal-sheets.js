// TradeOS — Google Sheets source-of-truth for Trade Journal.
// Depends on google-storage.js being loaded first (uses _internals.getAccessToken + _internals.gfetch).
//
// Setup (first login):
//   1. Searches Drive for existing "TradeOS" folder (drive.metadata.readonly)
//   2. Creates folder if missing (drive.file)
//   3. Finds or creates "Trade Journal" spreadsheet in that folder (drive.file + spreadsheets)
//   4. Writes header row; loads existing rows into localStorage
//
// Ongoing:
//   syncFromSheets() — Sheets → localStorage (called on journal page load)
//   pushToSheets()   — localStorage → Sheets (called after each user write)

(function () {
  'use strict';

  var FOLDER_NAME = 'TradeOS';
  var SHEET_NAME  = 'Trade Journal';
  var TAB_NAME    = 'Trades';

  var SHEET_ID_KEY  = 'tradeos_sheet_id';
  var FOLDER_ID_KEY = 'tradeos_drive_folder_id';
  var SHEET_TAB_KEY = 'tradeos_sheet_tab';

  // Column order used in the spreadsheet.
  var COLS = [
    'id', 'ticker', 'entryPrice', 'currentPrice', 'shares',
    'high', 'low', 'status', 'catalyst', 'notes',
    'timestamp', 'closedAt', 'ohlcSource', 'grade'
  ];

  // Scopes needed only for first-time setup (finding/creating folder + sheet).
  var SETUP_SCOPES = [
    'https://www.googleapis.com/auth/drive.metadata.readonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets'
  ];

  // Scopes needed for ongoing read/write of cell data.
  var SYNC_SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

  // ── Helpers ──────────────────────────────────────────────────────────────

  function lib() {
    if (!window.TradeOSGoogle || !window.TradeOSGoogle._internals) {
      throw new Error('google-storage.js must load before journal-sheets.js');
    }
    return window.TradeOSGoogle._internals;
  }

  function driveGet(url, token) {
    return lib().gfetch(url, { method: 'GET' }, token);
  }

  function drivePost(url, body, token) {
    return lib().gfetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, token);
  }

  function sheetsPut(url, body, token) {
    return lib().gfetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, token);
  }

  function sheetsPost(url, body, token) {
    return lib().gfetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, token);
  }

  function tabName() {
    return localStorage.getItem(SHEET_TAB_KEY) || TAB_NAME;
  }

  // ── Drive folder helpers ──────────────────────────────────────────────────

  function findFolder(token) {
    var q = "name='" + FOLDER_NAME + "' and mimeType='application/vnd.google-apps.folder' and trashed=false";
    return driveGet(
      'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)',
      token
    ).then(function (d) { return (d.files || [])[0] || null; });
  }

  function createFolder(token) {
    return drivePost(
      'https://www.googleapis.com/drive/v3/files?fields=id,name',
      { name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
      token
    );
  }

  // ── Spreadsheet helpers ───────────────────────────────────────────────────

  function findSheet(token, folderId) {
    var q = "name='" + SHEET_NAME + "' and '" + folderId + "' in parents"
      + " and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
    return driveGet(
      'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)',
      token
    ).then(function (d) { return (d.files || [])[0] || null; });
  }

  function getFirstTabName(sheetId, token) {
    return driveGet(
      'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId
        + '?fields=sheets.properties(sheetId,title)',
      token
    ).then(function (d) {
      var sheets = (d && d.sheets) || [];
      return sheets.length ? sheets[0].properties.title : TAB_NAME;
    });
  }

  function renameFirstTab(sheetId, token) {
    return sheetsPost(
      'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId + ':batchUpdate',
      {
        requests: [{
          updateSheetProperties: {
            properties: { sheetId: 0, title: TAB_NAME },
            fields: 'title'
          }
        }]
      },
      token
    );
  }

  // Create the spreadsheet via Drive API (supports specifying parents at creation).
  // Then rename the default tab and write header row.
  function createSheetInFolder(token, folderId) {
    return drivePost(
      'https://www.googleapis.com/drive/v3/files?fields=id,name',
      {
        name: SHEET_NAME,
        mimeType: 'application/vnd.google-apps.spreadsheet',
        parents: [folderId]
      },
      token
    ).then(function (file) {
      return renameFirstTab(file.id, token).then(function () {
        return sheetsPut(
          'https://sheets.googleapis.com/v4/spreadsheets/' + file.id
            + '/values/' + encodeURIComponent(TAB_NAME + '!A1')
            + '?valueInputOption=RAW',
          { values: [COLS] },
          token
        );
      }).then(function () {
        return { id: file.id, tab: TAB_NAME };
      });
    });
  }

  // For an existing sheet with no header row, write headers.
  function ensureHeaders(sheetId, tab, token) {
    return driveGet(
      'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId
        + '/values/' + encodeURIComponent(tab + '!A1:A1'),
      token
    ).then(function (d) {
      var hasData = d && d.values && d.values.length > 0;
      if (hasData) return;
      return sheetsPut(
        'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId
          + '/values/' + encodeURIComponent(tab + '!A1')
          + '?valueInputOption=RAW',
        { values: [COLS] },
        token
      );
    });
  }

  // ── Public: first-login setup (idempotent) ────────────────────────────────

  function setup() {
    if (localStorage.getItem(SHEET_ID_KEY)) {
      return Promise.resolve({ skipped: true });
    }

    var token;
    return lib().getAccessToken(SETUP_SCOPES)
      .then(function (t) {
        token = t;
        return findFolder(token);
      })
      .then(function (folder) {
        if (folder) {
          localStorage.setItem(FOLDER_ID_KEY, folder.id);
          return folder;
        }
        return createFolder(token).then(function (f) {
          localStorage.setItem(FOLDER_ID_KEY, f.id);
          return f;
        });
      })
      .then(function (folder) {
        return findSheet(token, folder.id).then(function (sheet) {
          if (sheet) {
            return getFirstTabName(sheet.id, token).then(function (tab) {
              localStorage.setItem(SHEET_TAB_KEY, tab);
              return ensureHeaders(sheet.id, tab, token).then(function () {
                return sheet;
              });
            });
          }
          return createSheetInFolder(token, folder.id).then(function (created) {
            localStorage.setItem(SHEET_TAB_KEY, created.tab);
            return created;
          });
        });
      })
      .then(function (sheet) {
        localStorage.setItem(SHEET_ID_KEY, sheet.id);
        return syncFromSheets();
      })
      .then(function () {
        return { ok: true };
      });
  }

  // ── Public: sync Sheets → localStorage ───────────────────────────────────

  function syncFromSheets() {
    var sheetId = localStorage.getItem(SHEET_ID_KEY);
    if (!sheetId) return Promise.resolve([]);

    return lib().getAccessToken(SYNC_SCOPES)
      .then(function (token) {
        var url = 'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId
          + '/values/' + encodeURIComponent(tabName());
        return lib().gfetch(url, { method: 'GET' }, token);
      })
      .then(function (data) {
        var values = (data && data.values) || [];
        var trades = [];
        if (values.length >= 2) {
          var headers = values[0];
          trades = values.slice(1)
            .filter(function (row) { return row.some(function (c) { return c !== ''; }); })
            .map(function (row) {
              var t = {};
              headers.forEach(function (h, i) { t[h] = row[i] != null ? row[i] : ''; });
              t.id           = parseFloat(t.id)           || 0;
              t.entryPrice   = parseFloat(t.entryPrice)   || 0;
              t.currentPrice = parseFloat(t.currentPrice) || 0;
              t.shares       = parseFloat(t.shares)       || 0;
              t.high         = parseFloat(t.high)         || 0;
              t.low          = parseFloat(t.low)          || 0;
              return t;
            });
        }
        localStorage.setItem('tradeos_journal', JSON.stringify(trades));
        if (typeof clearApiCache === 'function') clearApiCache();
        return trades;
      });
  }

  // ── Public: push localStorage → Sheets (full overwrite) ──────────────────

  function pushToSheets() {
    var sheetId = localStorage.getItem(SHEET_ID_KEY);
    if (!sheetId) return Promise.resolve();

    var trades = [];
    try { trades = JSON.parse(localStorage.getItem('tradeos_journal') || '[]'); } catch (_) {}

    return lib().getAccessToken(SYNC_SCOPES)
      .then(function (token) {
        var tab = tabName();
        var rows = [COLS];
        trades.forEach(function (t) {
          rows.push(COLS.map(function (c) {
            var v = t[c];
            return v != null ? String(v) : '';
          }));
        });

        // Clear first so deleted trades don't linger beyond the new data.
        return sheetsPost(
          'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId
            + '/values/' + encodeURIComponent(tab) + ':clear',
          {},
          token
        ).then(function () {
          return sheetsPut(
            'https://sheets.googleapis.com/v4/spreadsheets/' + sheetId
              + '/values/' + encodeURIComponent(tab + '!A1')
              + '?valueInputOption=RAW',
            { values: rows },
            token
          );
        });
      });
  }

  window.JournalSheets = {
    setup: setup,
    syncFromSheets: syncFromSheets,
    pushToSheets: pushToSheets
  };
})();
