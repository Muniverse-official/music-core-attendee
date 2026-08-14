var CONFIG = {
  VERSION: 4,
  TOKEN_PROPERTY: 'WEBHOOK_TOKEN',
  COVER_PICK_SHEET_ID: '1GsFyGTLeJV62T9xsfFyvsxOljRy3Egr7MkahpttlrPs',
  MUSIC_CORE_FOLDER_PROPERTY: 'MUSIC_CORE_FOLDER_ID',
  SUPPORT_EMAIL: 'support@muniverse.io',
  MAX_CLOCK_SKEW_MS: 5 * 60 * 1000,
  NONCE_TTL_SECONDS: 10 * 60
};

function doGet() {
  return json_({
    ok: true,
    service: 'muniverse-attendee-dispatcher',
    version: CONFIG.VERSION
  });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(30000)) {
      return json_({ ok: false, code: 'BUSY' });
    }

    var body = parseBody_(e);
    validateRequest_(body);

    var kind = String(body.kind || 'cover_pick').trim();
    var payload = body.payload || {};
    var result;

    if (kind === 'cover_pick') {
      result = handleCoverPick_(payload);
    } else if (kind === 'music_core') {
      result = handleMusicCore_(payload);
    } else {
      throw new Error('UNSUPPORTED_KIND');
    }

    return json_(Object.assign({ ok: true, kind: kind }, result));
  } catch (error) {
    return json_({
      ok: false,
      code: String(error && error.message ? error.message : error).slice(0, 120)
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (_) {}
  }
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw new Error('INVALID_JSON');
  }

  try {
    return JSON.parse(e.postData.contents);
  } catch (_) {
    throw new Error('INVALID_JSON');
  }
}

function validateRequest_(body) {
  var expectedToken = PropertiesService.getScriptProperties().getProperty(CONFIG.TOKEN_PROPERTY);
  if (!expectedToken) {
    throw new Error('WEBHOOK_TOKEN_NOT_CONFIGURED');
  }

  if (!safeEquals_(String(body.token || ''), expectedToken)) {
    throw new Error('UNAUTHORIZED');
  }

  var ts = Number(body.ts || 0);
  if (!isFinite(ts) || Math.abs(Date.now() - ts) > CONFIG.MAX_CLOCK_SKEW_MS) {
    throw new Error('STALE_REQUEST');
  }

  var nonce = String(body.nonce || '').trim();
  if (!nonce || nonce.length > 160) {
    throw new Error('INVALID_NONCE');
  }

  var nonceKey = 'nonce_' + sha256Hex_(nonce);
  var cache = CacheService.getScriptCache();
  if (cache.get(nonceKey)) {
    throw new Error('REPLAYED_REQUEST');
  }
  cache.put(nonceKey, '1', CONFIG.NONCE_TTL_SECONDS);
}

function handleCoverPick_(payload) {
  requireFields_(payload, [
    'muniverse_nickname',
    'account_email',
    'name',
    'birth_date',
    'nationality',
    'phone',
    'contact_email'
  ]);

  var spreadsheet = SpreadsheetApp.openById(CONFIG.COVER_PICK_SHEET_ID);
  var sheet = spreadsheet.getSheets()[0];
  sheet.appendRow([
    clean_(payload.muniverse_nickname, 80),
    clean_(payload.account_email, 254),
    clean_(payload.name, 100),
    clean_(payload.birth_date, 10),
    clean_(payload.nationality, 100),
    clean_(payload.phone, 40),
    clean_(payload.contact_email, 254)
  ]);

  sendSheetEmail_(
    'COVER PICK 방청자 등록',
    'COVER PICK 방청자 정보가 등록되었습니다.',
    spreadsheet.getUrl()
  );

  return {
    sheetUpdated: true,
    emailSent: true,
    duplicate: false,
    spreadsheetUrl: spreadsheet.getUrl()
  };
}

function handleMusicCore_(payload) {
  requireFields_(payload, [
    'event_date',
    'muniverse_nickname',
    'account_email',
    'name',
    'nationality',
    'phone',
    'contact_email',
    'idempotency_key'
  ]);

  var eventDate = clean_(payload.event_date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    throw new Error('INVALID_EVENT_DATE');
  }

  var idempotencyKey = clean_(payload.idempotency_key, 160);
  var spreadsheet = getOrCreateMusicCoreSpreadsheet_(eventDate);
  var sheet = getOrCreateEventSheet_(spreadsheet, eventDate);

  if (hasIdempotencyKey_(sheet, idempotencyKey)) {
    return {
      sheetUpdated: true,
      emailSent: false,
      duplicate: true,
      spreadsheetUrl: spreadsheet.getUrl()
    };
  }

  var age = Number(payload.age);
  if (!isFinite(age)) {
    age = ageOnDate_(clean_(payload.birth_date, 10), eventDate);
  }
  if (!isFinite(age) || age < 15) {
    throw new Error('INVALID_AGE');
  }

  sheet.appendRow([
    clean_(payload.muniverse_nickname, 80),
    clean_(payload.account_email, 254),
    clean_(payload.name, 100),
    age,
    clean_(payload.nationality, 100),
    clean_(payload.phone, 40),
    clean_(payload.contact_email, 254),
    idempotencyKey
  ]);
  sheet.hideColumns(8);

  sendSheetEmail_(
    eventDate + ' 쇼! 음악중심 방청자 등록',
    eventDate + ' 녹화 방청자 정보가 등록되었습니다.',
    spreadsheet.getUrl()
  );

  return {
    sheetUpdated: true,
    emailSent: true,
    duplicate: false,
    spreadsheetUrl: spreadsheet.getUrl()
  };
}

function getOrCreateMusicCoreSpreadsheet_(eventDate) {
  var parts = eventDate.split('-');
  var title = Number(parts[0]) + '년 ' + Number(parts[1]) + '월 쇼! 음악중심 방청자 명단';
  var files = DriveApp.getFilesByName(title);

  while (files.hasNext()) {
    var file = files.next();
    if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
      return SpreadsheetApp.openById(file.getId());
    }
  }

  var spreadsheet = SpreadsheetApp.create(title);
  var folderId = PropertiesService.getScriptProperties().getProperty(CONFIG.MUSIC_CORE_FOLDER_PROPERTY);
  if (folderId) {
    DriveApp.getFileById(spreadsheet.getId()).moveTo(DriveApp.getFolderById(folderId));
  }
  return spreadsheet;
}

function getOrCreateEventSheet_(spreadsheet, eventDate) {
  var sheet = spreadsheet.getSheetByName(eventDate);
  if (!sheet) {
    var sheets = spreadsheet.getSheets();
    if (sheets.length === 1 && sheets[0].getLastRow() === 0) {
      sheet = sheets[0];
      sheet.setName(eventDate);
    } else {
      sheet = spreadsheet.insertSheet(eventDate);
    }
  }

  var headers = [
    'Muniverse 닉네임',
    '가입 이메일',
    '이름',
    '만 나이',
    '국적',
    '연락처',
    '방청 안내용 이메일',
    '내부 중복방지용 등록키'
  ];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#dff7f2');
    sheet.autoResizeColumns(1, headers.length);
  }
  sheet.hideColumns(8);
  return sheet;
}

function hasIdempotencyKey_(sheet, key) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return false;
  }
  var found = sheet
    .getRange(2, 8, lastRow - 1, 1)
    .createTextFinder(key)
    .matchEntireCell(true)
    .findNext();
  return Boolean(found);
}

function sendSheetEmail_(subject, message, spreadsheetUrl) {
  MailApp.sendEmail(
    CONFIG.SUPPORT_EMAIL,
    subject,
    message + '\n\n방청자 명단: ' + spreadsheetUrl
  );
}

function requireFields_(payload, fields) {
  for (var i = 0; i < fields.length; i++) {
    if (!String(payload[fields[i]] == null ? '' : payload[fields[i]]).trim()) {
      throw new Error('MISSING_' + fields[i].toUpperCase());
    }
  }
}

function clean_(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function ageOnDate_(birthDate, eventDate) {
  var birth = birthDate.split('-').map(Number);
  var event = eventDate.split('-').map(Number);
  if (birth.length !== 3 || event.length !== 3) {
    return NaN;
  }
  var age = event[0] - birth[0];
  if (event[1] < birth[1] || (event[1] === birth[1] && event[2] < birth[2])) {
    age--;
  }
  return age;
}

function safeEquals_(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function sha256Hex_(value) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return bytes.map(function(byte) {
    var normalized = byte < 0 ? byte + 256 : byte;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function json_(body) {
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
