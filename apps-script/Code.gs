var CONFIG={VERSION:9,TOKEN_PROPERTY:'WEBHOOK_TOKEN',NOTIFY_EMAIL_PROPERTY:'NOTIFY_EMAIL',FANS_PICK_SHEET_ID_PROPERTY:'FANS_PICK_SHEET_ID',LEGACY_FANS_PICK_SHEET_ID:'1GsFyGTLeJV62T9xsfFyvsxOljRy3Egr7MkahpttlrPs',FANS_PICK_SHEET_TITLE:'FANS PICK 방청자 등록 명단',FANS_PICK_FOLDER_PROPERTY:'FANS_PICK_FOLDER_ID',MUSIC_CORE_SHEET_ID:'191598ZPdnCdDlvoa8aFGGNPmT1_xqEZXOq7vvEEahp0',DEFAULT_NOTIFY_EMAIL:'support@muniverse.io',MAX_CLOCK_SKEW_MS:300000,NONCE_TTL_SECONDS:600,MAX_TEXT_LENGTH:300,HEADER_ROWS:4,ROUND_METADATA_KEY:'MUNIVERSE_ROUND_ID'};

function doGet(){return json_({ok:true,service:'muniverse-attendee-dispatcher',version:CONFIG.VERSION,sheetMode:'round-tabs',deliveryState:'per-row-v1',textCells:true});}
function doPost(e){var lock=LockService.getScriptLock();try{if(!lock.tryLock(1000))return json_({ok:false,code:'BUSY'});var body=parseBody_(e);validateRequest_(body);var kind=clean_(body.kind||'fans_pick',40),payload=body.payload||{},result;if(kind==='fans_pick'||kind==='cover_pick'){result=handleFansPick_(payload);kind='fans_pick';}else if(kind==='music_core'){result=handleMusicCore_(payload);}else throw new Error('UNSUPPORTED_KIND');return json_(Object.assign({ok:true,kind:kind},result));}catch(error){return json_({ok:false,code:clean_(error&&error.message?error.message:error,120)});}finally{try{lock.releaseLock();}catch(_){}}}
function parseBody_(e){if(!e||!e.postData||!e.postData.contents)throw new Error('INVALID_JSON');if(String(e.postData.contents).length>20000)throw new Error('PAYLOAD_TOO_LARGE');try{return JSON.parse(e.postData.contents);}catch(_){throw new Error('INVALID_JSON');}}
function validateRequest_(body){var expected=PropertiesService.getScriptProperties().getProperty(CONFIG.TOKEN_PROPERTY);if(!expected)throw new Error('WEBHOOK_TOKEN_NOT_CONFIGURED');if(!safeEquals_(String(body.token||''),expected))throw new Error('UNAUTHORIZED');var version=Number(body.version||0);if(!isFinite(version)||version<3||version>CONFIG.VERSION)throw new Error('UNSUPPORTED_VERSION');var ts=Number(body.ts||0);if(!isFinite(ts)||Math.abs(Date.now()-ts)>CONFIG.MAX_CLOCK_SKEW_MS)throw new Error('STALE_REQUEST');var nonce=clean_(body.nonce,160);if(!nonce)throw new Error('INVALID_NONCE');var key='nonce_'+sha256Hex_(nonce),cache=CacheService.getScriptCache();if(cache.get(key))throw new Error('REPLAYED_REQUEST');cache.put(key,'1',CONFIG.NONCE_TTL_SECONDS);}

function handleFansPick_(p){return handleRegistration_('fans_pick',p);}
function handleMusicCore_(p){return handleRegistration_('music_core',p);}
function handleRegistration_(program,p){
  requireFields_(p,['round_id','round_title','event_date','muniverse_nickname','account_email','name','birth_date','nationality','phone','x_account','contact_email','idempotency_key']);
  var eventDate=validEventDate_(p.event_date),book=program==='music_core'?getMusicCoreSpreadsheet_():getFansPickSpreadsheet_();
  var sheet=getOrCreateRoundSheet_(book,program,p),idk=clean_(p.idempotency_key,160),keyCol=program==='music_core'?12:11;
  var row=findRegistrationRow_(sheet,idk,keyCol),duplicate=!!row;
  if(!row){
    var age=resolveAge_(p,eventDate);
    var values=program==='music_core'?
      [eventDateLabel_(p),clean_(p.muniverse_nickname,80),clean_(p.account_email,254),clean_(p.name,100),age,clean_(p.birth_date,10),clean_(p.nationality,100),clean_(p.phone,40),clean_(p.x_account,100),clean_(p.contact_email,254),new Date(),idk,'PENDING']:
      [clean_(p.muniverse_nickname,80),clean_(p.account_email,254),clean_(p.name,100),age,clean_(p.birth_date,10),clean_(p.nationality,100),clean_(p.phone,40),clean_(p.x_account,100),clean_(p.contact_email,254),new Date(),idk,'','PENDING'];
    sheet.appendRow(values.map(sheetText_));SpreadsheetApp.flush();row=sheet.getLastRow();
  }
  sheet.hideColumns(program==='music_core'?12:11,program==='music_core'?2:3);
  var result={sheetUpdated:true,emailSent:false,duplicate:duplicate,attendeeNumber:row-CONFIG.HEADER_ROWS,spreadsheetUrl:book.getUrl(),sheetUrl:roundSheetUrl_(book,sheet),sheetName:sheet.getName()};
  var marker=sheet.getRange(row,13),mailState=String(marker.getValue()||'');
  if(mailState.indexOf('SENT:')===0){result.emailSent=true;return result;}
  // A legacy row or an interrupted send has an unknown email outcome. Do not resend blindly.
  if(mailState!=='PENDING'){result.ok=false;result.code='EMAIL_STATUS_UNCERTAIN';return result;}
  marker.setValue('SENDING:'+new Date().toISOString());SpreadsheetApp.flush();
  try{
    if(program==='music_core')notifyMusicCoreSubmission_(result.attendeeNumber,result.sheetUrl,p);
    else notifyFansPickSubmission_(result.attendeeNumber,result.sheetUrl,p);
  }catch(error){
    marker.setValue('PENDING');SpreadsheetApp.flush();
    result.ok=false;result.code='EMAIL_SEND_FAILED';return result;
  }
  // Keep SENDING if this write fails, so an ambiguous send is surfaced for review.
  try{marker.setValue('SENT:'+new Date().toISOString());SpreadsheetApp.flush();}
  catch(error){result.ok=false;result.code='EMAIL_STATUS_UNCERTAIN';return result;}
  result.emailSent=true;return result;
}
function findRegistrationRow_(sheet,key,col){
  if(!key||sheet.getLastRow()<=CONFIG.HEADER_ROWS)return 0;
  var match=sheet.getRange(CONFIG.HEADER_ROWS+1,col,sheet.getLastRow()-CONFIG.HEADER_ROWS,1).createTextFinder(key).matchEntireCell(true).findNext();
  return match?match.getRow():0;
}
function sheetText_(value){return typeof value==='string'&&/^[\s]*[=+@-]/.test(value)?"'"+value:value;}
function eventDateIsTba_(p){return p.event_date_tba===true||p.event_date_tba==='true'||p.event_date==='2099-12-31';}
function eventDateLabel_(p){return eventDateIsTba_(p)?'방청일 미정':validEventDate_(p.event_date);}

function getFansPickSpreadsheet_(){var props=PropertiesService.getScriptProperties(),configured=clean_(props.getProperty(CONFIG.FANS_PICK_SHEET_ID_PROPERTY),160),ids=[];if(configured)ids.push(configured);if(CONFIG.LEGACY_FANS_PICK_SHEET_ID)ids.push(CONFIG.LEGACY_FANS_PICK_SHEET_ID);for(var i=0;i<ids.length;i++){try{var existing=SpreadsheetApp.openById(ids[i]);if(existing.getName()!==CONFIG.FANS_PICK_SHEET_TITLE)existing.rename(CONFIG.FANS_PICK_SHEET_TITLE);props.setProperty(CONFIG.FANS_PICK_SHEET_ID_PROPERTY,existing.getId());return existing;}catch(_){}}var files=DriveApp.getFilesByName(CONFIG.FANS_PICK_SHEET_TITLE);while(files.hasNext()){var file=files.next();if(file.getMimeType()===MimeType.GOOGLE_SHEETS){props.setProperty(CONFIG.FANS_PICK_SHEET_ID_PROPERTY,file.getId());return SpreadsheetApp.openById(file.getId());}}var book=SpreadsheetApp.create(CONFIG.FANS_PICK_SHEET_TITLE);props.setProperty(CONFIG.FANS_PICK_SHEET_ID_PROPERTY,book.getId());moveToConfiguredFolder_(book.getId(),CONFIG.FANS_PICK_FOLDER_PROPERTY);return book;}
function getMusicCoreSpreadsheet_(){try{return SpreadsheetApp.openById(CONFIG.MUSIC_CORE_SHEET_ID);}catch(_){throw new Error('MUSIC_CORE_SHEET_UNAVAILABLE');}}
function getOrCreateRoundSheet_(book,program,p){var roundId=clean_(p.round_id,80),roundTitle=clean_(p.round_title,120);if(!roundId||!roundTitle)throw new Error('ROUND_REQUIRED');var name=safeSheetName_(roundTitle),sheet=findRoundSheetById_(book,roundId);if(!sheet){sheet=book.getSheetByName(name);if(sheet&&sheet.getDeveloperMetadata().some(function(m){return m.getKey()===CONFIG.ROUND_METADATA_KEY&&m.getValue()!==roundId;})){name=safeSheetName_(roundTitle)+'_'+roundId.slice(0,8);sheet=book.getSheetByName(name);}}if(!sheet){sheet=book.insertSheet(name,0);sheet.addDeveloperMetadata(CONFIG.ROUND_METADATA_KEY,roundId,SpreadsheetApp.DeveloperMetadataVisibility.DOCUMENT);}else{ensureRoundMetadata_(sheet,roundId);if(sheet.getName()!==name&&!book.getSheetByName(name))sheet.setName(name);}initializeRoundSheet_(sheet,program,p);return sheet;}
function findRoundSheetById_(book,roundId){var sheets=book.getSheets();for(var i=0;i<sheets.length;i++){var md=sheets[i].getDeveloperMetadata();for(var j=0;j<md.length;j++)if(md[j].getKey()===CONFIG.ROUND_METADATA_KEY&&md[j].getValue()===roundId)return sheets[i];}return null;}
function ensureRoundMetadata_(sheet,roundId){var md=sheet.getDeveloperMetadata();for(var i=0;i<md.length;i++)if(md[i].getKey()===CONFIG.ROUND_METADATA_KEY&&md[i].getValue()===roundId)return;sheet.addDeveloperMetadata(CONFIG.ROUND_METADATA_KEY,roundId,SpreadsheetApp.DeveloperMetadataVisibility.DOCUMENT);}
function initializeRoundSheet_(sheet,program,p){var headers=program==='music_core'?['녹화일','Muniverse 닉네임','가입 이메일','이름','만 나이','생년월일','국적','연락처','X 계정','방청 안내용 이메일','등록 시각','내부 중복방지용 등록키']:['Muniverse 닉네임','가입 이메일','이름','만 나이','생년월일','국적','연락처','X 계정','방청 안내용 이메일','등록 시각','내부 중복방지용 등록키','레거시 연동 원본'];var label=program==='music_core'?'쇼! 음악중심':'FANS PICK',eventDate=eventDateLabel_(p),period=registrationPeriod_(p);if(sheet.getLastRow()===0){sheet.getRange(1,1,1,headers.length).merge();sheet.getRange(1,1).setValue(label+' '+clean_(p.round_title,120)+' 방청자 등록 명단').setFontWeight('bold').setFontSize(14);sheet.getRange(2,1,1,2).setValues([['방청일',eventDate]]);sheet.getRange(3,1,1,2).setValues([['등록기간 (KST)',period]]);sheet.getRange(4,1,1,headers.length).setValues([headers]).setFontWeight('bold');sheet.getRange(2,1).setFontWeight('bold');sheet.getRange(3,1).setFontWeight('bold');sheet.setFrozenRows(CONFIG.HEADER_ROWS);sheet.autoResizeColumns(1,headers.length);}else{sheet.getRange(1,1).setValue(label+' '+clean_(p.round_title,120)+' 방청자 등록 명단');sheet.getRange(2,2).setValue(eventDate);if(period)sheet.getRange(3,2).setValue(period);}sheet.getRange(4,13).setValue('내부 알림 발송 상태');if(program==='music_core')sheet.hideColumns(12,2);else sheet.hideColumns(11,3);}
function registrationPeriod_(p){var o=clean_(p.registration_open_at,40),c=clean_(p.registration_close_at,40);if(!o||!c)return'관리자 설정 기준';try{return formatKst_(o)+' ~ '+formatKst_(c);}catch(_){return'관리자 설정 기준';}}
function formatKst_(v){return Utilities.formatDate(new Date(v),'Asia/Seoul','yyyy-MM-dd HH:mm');}
function safeSheetName_(v){return clean_(v,80).replace(/[\\\/\?\*\[\]\:]/g,'_')||'회차';}
function roundSheetUrl_(book,sheet){return book.getUrl()+'#gid='+sheet.getSheetId();}
function validEventDate_(v){var d=clean_(v,10),date=new Date(d+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!isFinite(date.getTime())||date.toISOString().slice(0,10)!==d)throw new Error('INVALID_EVENT_DATE');return d;}
function resolveAge_(p,eventDate){
  var reference=eventDateIsTba_(p)?Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd'):eventDate;
  var age=ageOnDate_(validEventDate_(p.birth_date),reference);
  if(!isFinite(age)||age<15||age>130)throw new Error('INVALID_AGE');return age;
}
function moveToConfiguredFolder_(fileId,propertyName){var folderId=clean_(PropertiesService.getScriptProperties().getProperty(propertyName),160);if(!folderId)return;try{DriveApp.getFileById(fileId).moveTo(DriveApp.getFolderById(folderId));}catch(_){}}
function hasIdempotencyKey_(sheet,key,col){if(!key||sheet.getLastRow()<=CONFIG.HEADER_ROWS)return false;return Boolean(sheet.getRange(CONFIG.HEADER_ROWS+1,col,sheet.getLastRow()-CONFIG.HEADER_ROWS,1).createTextFinder(key).matchEntireCell(true).findNext());}
function buildFallbackIdempotencyKey_(p){return'fans_pick:'+sha256Hex_(clean_(p.account_email,254).toLowerCase()+'\n'+clean_(p.muniverse_nickname,80));}

function notifyFansPickSubmission_(n,url,p){var email=clean_(PropertiesService.getScriptProperties().getProperty(CONFIG.NOTIFY_EMAIL_PROPERTY),254)||CONFIG.DEFAULT_NOTIFY_EMAIL,round=clean_(p.round_title,120),subject='[FANS PICK '+round+'] '+n+'번째 당첨자 개인정보 입력',message=['FANS PICK '+round+' '+n+'번째 당첨자가 개인정보 입력을 완료했습니다.','','Muniverse 닉네임: '+clean_(p.muniverse_nickname,80),'회차 명단: '+url].join('\n');MailApp.sendEmail(email,subject,message);return true;}
function notifyMusicCoreSubmission_(n,url,p){var email=clean_(PropertiesService.getScriptProperties().getProperty(CONFIG.NOTIFY_EMAIL_PROPERTY),254)||CONFIG.DEFAULT_NOTIFY_EMAIL,round=clean_(p.round_title,120),subject='[쇼! 음악중심 '+round+'] '+n+'번째 방청자 개인정보 입력',message=['쇼! 음악중심 '+round+' '+n+'번째 방청자가 개인정보 입력을 완료했습니다.','','녹화일: '+eventDateLabel_(p),'Muniverse 닉네임: '+clean_(p.muniverse_nickname,80),'회차 명단: '+url].join('\n');MailApp.sendEmail(email,subject,message);return true;}
function notifyOnce_(notificationKey,subject,message,url){var props=PropertiesService.getScriptProperties(),key='notified_'+sha256Hex_(notificationKey);if(props.getProperty(key))return false;var email=clean_(props.getProperty(CONFIG.NOTIFY_EMAIL_PROPERTY),254)||CONFIG.DEFAULT_NOTIFY_EMAIL;MailApp.sendEmail(email,subject,message+'\n\n방청자 명단: '+url);props.setProperty(key,new Date().toISOString());return true;}

function purgeFansPickRound(roundTitle){var book=getFansPickSpreadsheet_(),sheet=book.getSheetByName(safeSheetName_(roundTitle));if(!sheet)throw new Error('ROUND_SHEET_NOT_FOUND');clearDataRows_(sheet);return roundSheetUrl_(book,sheet);}
function purgeFansPickData(){return purgeFansPickRound('1회차');}
function purgeMusicCoreEvent(eventDate){var d=validEventDate_(eventDate),book=getMusicCoreSpreadsheet_(),sheets=book.getSheets(),cleared=0;for(var i=0;i<sheets.length;i++){if(clean_(sheets[i].getRange(2,2).getDisplayValue(),10)===d){clearDataRows_(sheets[i]);cleared++;}}if(!cleared)throw new Error('ROUND_SHEET_NOT_FOUND');return book.getUrl();}
function clearDataRows_(sheet){var last=sheet.getLastRow();if(last>CONFIG.HEADER_ROWS)sheet.getRange(CONFIG.HEADER_ROWS+1,1,last-CONFIG.HEADER_ROWS,sheet.getMaxColumns()).clearContent();}
function requireFields_(p,fields){for(var i=0;i<fields.length;i++)if(!String(p[fields[i]]==null?'':p[fields[i]]).trim())throw new Error('MISSING_'+fields[i].toUpperCase());}
function clean_(v,max){return String(v==null?'':v).trim().slice(0,max||CONFIG.MAX_TEXT_LENGTH);}
function ageOnDate_(birthDate,eventDate){var b=birthDate.split('-').map(Number),e=eventDate.split('-').map(Number);if(b.length!==3||e.length!==3||b.concat(e).some(function(v){return!isFinite(v);}))return NaN;var age=e[0]-b[0];if(e[1]<b[1]||(e[1]===b[1]&&e[2]<b[2]))age--;return age;}
function safeEquals_(a,b){if(a.length!==b.length)return false;var diff=0;for(var i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function sha256Hex_(v){var bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,v,Utilities.Charset.UTF_8);return bytes.map(function(byte){var n=byte<0?byte+256:byte;return('0'+n.toString(16)).slice(-2);}).join('');}
function json_(body){return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);}
