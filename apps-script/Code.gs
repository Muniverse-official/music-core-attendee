var CONFIG = {
  VERSION: 6,
  TOKEN_PROPERTY: 'WEBHOOK_TOKEN',
  NOTIFY_EMAIL_PROPERTY: 'NOTIFY_EMAIL',
  FANS_PICK_SHEET_ID_PROPERTY: 'FANS_PICK_SHEET_ID',
  LEGACY_FANS_PICK_SHEET_ID: '1GsFyGTLeJV62T9xsfFyvsxOljRy3Egr7MkahpttlrPs',
  FANS_PICK_FOLDER_PROPERTY: 'FANS_PICK_FOLDER_ID',
  MUSIC_CORE_FOLDER_PROPERTY: 'MUSIC_CORE_FOLDER_ID',
  DEFAULT_NOTIFY_EMAIL: 'support@muniverse.io',
  MAX_CLOCK_SKEW_MS: 5 * 60 * 1000,
  NONCE_TTL_SECONDS: 10 * 60,
  MAX_TEXT_LENGTH: 300
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

    var kind = clean_(body.kind || 'fans_pick', 40);
    var payload = body.payload || {};
    var result;

    if (kind === 'fans_pick' || kind === 'cover_pick') {
      result = handleFansPick_(payload);
      kind = 'fans_pick';
    } else if (kind === 'music_core') {
      result = handleMusicCore_(payload);
    } else {
      throw new Error('UNSUPPORTED_KIND');
    }

    return json_(Object.assign({ ok: true, kind: kind }, result));
  } catch (error) {
    return json_({
      ok: false,
      code: clean_(error && error.message ? error.message : error, 120)
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
  if (String(e.postData.contents).length > 20000) {
    throw new Error('PAYLOAD_TOO_LARGE');
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

  var version = Number(body.version || 0);
  if (!isFinite(version) || version < 3 || version > CONFIG.VERSION) {
    throw new Error('UNSUPPORTED_VERSION');
  }

  var ts = Number(body.ts || 0);
  if (!isFinite(ts) || Math.abs(Date.now() - ts) > CONFIG.MAX_CLOCK_SKEW_MS) {
    throw new Error('STALE_REQUEST');
  }

  var nonce = clean_(body.nonce, 160);
  if (!nonce) {
    throw new Error('INVALID_NONCE');
  }
  var nonceKey = 'nonce_' + sha256Hex_(nonce);
  var cache = CacheService.getScriptCache();
  if (cache.get(nonceKey)) {
    throw new Error('REPLAYED_REQUEST');
  }
  cache.put(nonceKey, '1', CONFIG.NONCE_TTL_SECONDS);
}

function handleFansPick_(payload) {
  requireFields_(payload, [
    'muniverse_nickname',
    'account_email',
    'name',
    'birth_date',
    'nationality',
    'phone',
    'contact_email'
  ]);

  var eventDate = clean_(payload.event_date || '2026-09-14', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    throw new Error('INVALID_EVENT_DATE');
  }

  var spreadsheet = getOrCreateFansPickSpreadsheet_(eventDate);
  var sheet = getOrCreateFansPickSheet_(spreadsheet);
  var idempotencyKey = clean_(payload.idempotency_key || buildFallbackIdempotencyKey_(payload), 160);

  if (hasIdempotencyKey_(sheet, idempotencyKey, 9)) {
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
    clean_(payload.birth_date, 10),
    clean_(payload.nationality, 100),
    clean_(payload.phone, 40),
    clean_(payload.contact_email, 254),
    idempotencyKey,
    new Date()
  ]);
  sheet.hideColumns(9);

  var attendeeNumber = Math.max(1, sheet.getLastRow() - 1);
  var emailSent = notifyFansPickSubmission_(attendeeNumber, spreadsheet.getUrl(), payload);

  return {
    sheetUpdated: true,
    emailSent: emailSent,
    duplicate: false,
    attendeeNumber: attendeeNumber,
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
  var sheet = getOrCreateMusicCoreEventSheet_(spreadsheet, eventDate);

  if (hasIdempotencyKey_(sheet, idempotencyKey, 8)) {
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

  var wasEmpty = sheet.getLastRow() <= 1;
  sheet.appendRow([
    clean_(payload.muniverse_nickname, 80),
    clean_(payload.account_email, 254),
    clean_(payload.name, 100),
    age,
    clean_(payload.nationality, 100),
    clean_(payload.phone, 40),
    clean_(payload.contact_email, 254),
    idempotencyKey,
    new Date()
  ]);
  sheet.hideColumns(8);

  var emailSent = false;
  if (wasEmpty) {
    emailSent = notifyOnce_(
      'music_core_' + spreadsheet.getId() + '_' + eventDate,
      eventDate + ' 쇼! 음악중심 방청자 명단 생성',
      eventDate + ' 녹화 방청자 정보 입력이 시작되었습니다.',
      spreadsheet.getUrl()
    );
  }

  return {
    sheetUpdated: true,
    emailSent: emailSent,
    duplicate: false,
    spreadsheetUrl: spreadsheet.getUrl()
  };
}

function getOrCreateFansPickSpreadsheet_(eventDate) {
  var properties = PropertiesService.getScriptProperties();
  var configuredId = clean_(properties.getProperty(CONFIG.FANS_PICK_SHEET_ID_PROPERTY), 160);
  var candidateIds = [];
  if (configuredId) candidateIds.push(configuredId);
  if (CONFIG.LEGACY_FANS_PICK_SHEET_ID) candidateIds.push(CONFIG.LEGACY_FANS_PICK_SHEET_ID);

  for (var i = 0; i < candidateIds.length; i++) {
    try {
      var existing = SpreadsheetApp.openById(candidateIds[i]);
      existing.rename(fansPickTitle_(eventDate));
      properties.setProperty(CONFIG.FANS_PICK_SHEET_ID_PROPERTY, existing.getId());
      return existing;
    } catch (_) {}
  }

  var title = fansPickTitle_(eventDate);
  var files = DriveApp.getFilesByName(title);
  while (files.hasNext()) {
    var file = files.next();
    if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
      properties.setProperty(CONFIG.FANS_PICK_SHEET_ID_PROPERTY, file.getId());
      return SpreadsheetApp.openById(file.getId());
    }
  }

  var spreadsheet = SpreadsheetApp.create(title);
  properties.setProperty(CONFIG.FANS_PICK_SHEET_ID_PROPERTY, spreadsheet.getId());
  moveToConfiguredFolder_(spreadsheet.getId(), CONFIG.FANS_PICK_FOLDER_PROPERTY);
  return spreadsheet;
}

function fansPickTitle_(eventDate) {
  var parts = eventDate.split('-');
  return Number(parts[0]) + '년 ' + Number(parts[1]) + '월 FANS PICK 방청자 명단';
}

function getOrCreateFansPickSheet_(spreadsheet) {
  var name = '방청자 등록';
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    var sheets = spreadsheet.getSheets();
    if (sheets.length === 1 && sheets[0].getLastRow() === 0) {
      sheet = sheets[0];
      sheet.setName(name);
    } else {
      sheet = spreadsheet.insertSheet(name);
    }
  }

  var headers = [
    'Muniverse 닉네임',
    '가입 이메일',
    '이름',
    '만 나이',
    '생년월일',
    '국적',
    '연락처',
    '방청 안내용 이메일',
    '내부 중복방지용 등록키',
    '등록 시각'
  ];
  initializeSheet_(sheet, headers, '#dff7f2');
  sheet.hideColumns(9);
  return sheet;
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
  moveToConfiguredFolder_(spreadsheet.getId(), CONFIG.MUSIC_CORE_FOLDER_PROPERTY);
  return spreadsheet;
}

function getOrCreateMusicCoreEventSheet_(spreadsheet, eventDate) {
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
    '내부 중복방지용 등록키',
    '등록 시각'
  ];
  initializeSheet_(sheet, headers, '#dff7f2');
  sheet.hideColumns(8);
  return sheet;
}

function initializeSheet_(sheet, headers, headerColor) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground(headerColor);
    sheet.autoResizeColumns(1, headers.length);
  }
}

function moveToConfiguredFolder_(fileId, propertyName) {
  var folderId = clean_(PropertiesService.getScriptProperties().getProperty(propertyName), 160);
  if (!folderId) return;
  try {
    DriveApp.getFileById(fileId).moveTo(DriveApp.getFolderById(folderId));
  } catch (_) {}
}

function hasIdempotencyKey_(sheet, key, columnNumber) {
  if (!key || sheet.getLastRow() < 2) return false;
  var found = sheet
    .getRange(2, columnNumber, sheet.getLastRow() - 1, 1)
    .createTextFinder(key)
    .matchEntireCell(true)
    .findNext();
  return Boolean(found);
}

function buildFallbackIdempotencyKey_(payload) {
  return 'fans_pick:' + sha256Hex_(
    clean_(payload.account_email, 254).toLowerCase() + '\n' + clean_(payload.muniverse_nickname, 80)
  );
}

function notifyFansPickSubmission_(attendeeNumber, spreadsheetUrl, payload) {
  var properties = PropertiesService.getScriptProperties();
  var email = clean_(properties.getProperty(CONFIG.NOTIFY_EMAIL_PROPERTY), 254) || CONFIG.DEFAULT_NOTIFY_EMAIL;
  var subject = attendeeNumber + '번째 당첨자 개인정보 입력';
  var message = [
    'FANS PICK ' + attendeeNumber + '번째 당첨자가 개인정보 입력을 완료했습니다.',
    '',
    'Muniverse 닉네임: ' + clean_(payload.muniverse_nickname, 80),
    '방청자 명단: ' + spreadsheetUrl
  ].join('\n');
  MailApp.sendEmail(email, subject, message);
  return true;
}

function notifyOnce_(notificationKey, subject, message, spreadsheetUrl) {
  var properties = PropertiesService.getScriptProperties();
  var key = 'notified_' + sha256Hex_(notificationKey);
  if (properties.getProperty(key)) return false;

  var email = clean_(properties.getProperty(CONFIG.NOTIFY_EMAIL_PROPERTY), 254) || CONFIG.DEFAULT_NOTIFY_EMAIL;
  MailApp.sendEmail(email, subject, message + '\n\n방청자 명단: ' + spreadsheetUrl);
  properties.setProperty(key, new Date().toISOString());
  return true;
}

/**
 * Run after FANS PICK attendee verification and final guidance are complete.
 * Clears submitted personal data while preserving the header row and file link.
 */
function purgeFansPickData() {
  var spreadsheet = getOrCreateFansPickSpreadsheet_('2026-09-14');
  var sheet = getOrCreateFansPickSheet_(spreadsheet);
  clearDataRows_(sheet);
  return spreadsheet.getUrl();
}

/**
 * Run after the specified SHOW! MUSIC CORE recording's verification and guidance are complete.
 */
function purgeMusicCoreEvent(eventDate) {
  var normalized = clean_(eventDate, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error('INVALID_EVENT_DATE');
  var spreadsheet = getOrCreateMusicCoreSpreadsheet_(normalized);
  var sheet = spreadsheet.getSheetByName(normalized);
  if (sheet) clearDataRows_(sheet);
  return spreadsheet.getUrl();
}

function clearDataRows_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getMaxColumns()).clearContent();
}

function requireFields_(payload, fields) {
  for (var i = 0; i < fields.length; i++) {
    if (!String(payload[fields[i]] == null ? '' : payload[fields[i]]).trim()) {
      throw new Error('MISSING_' + fields[i].toUpperCase());
    }
  }
}

function clean_(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength || CONFIG.MAX_TEXT_LENGTH);
}

function ageOnDate_(birthDate, eventDate) {
  var birth = birthDate.split('-').map(Number);
  var event = eventDate.split('-').map(Number);
  if (birth.length !== 3 || event.length !== 3 || birth.concat(event).some(function(value) { return !isFinite(value); })) {
    return NaN;
  }
  var age = event[0] - birth[0];
  if (event[1] < birth[1] || (event[1] === birth[1] && event[2] < birth[2])) {
    age--;
  }
  return age;
}

function safeEquals_(a, b) {
  if (a.length !== b.length) return false;
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
