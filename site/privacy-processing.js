(()=>{
  'use strict';
  const PRIVACY={
    ko:`<dl class="privacy-grid"><dt>수집·이용 목적</dt><dd>방청 당첨자 확인, 본인 확인 및 방청 안내</dd><dt>수집 항목</dt><dd>Muniverse 가입 이메일·닉네임, 이름, 국적, 생년월일, 연락처, 방청 안내용 이메일</dd><dt>보유·이용 기간</dt><dd>방청자 확인 및 안내 완료 후 지체 없이 파기합니다.</dd><dt>동의 거부 및 불이익</dt><dd>동의를 거부할 수 있으나, 동의하지 않을 경우 당첨자 확인 및 방청 등록이 제한됩니다.</dd></dl>`,
    en:`<dl class="privacy-grid"><dt>Purpose of collection and use</dt><dd>Winner verification, identity verification, and audience attendance guidance</dd><dt>Information collected</dt><dd>Muniverse account email and nickname, full name, nationality, date of birth, phone number, and email for attendance notices</dd><dt>Retention period</dt><dd>Personal information will be deleted without delay after attendee verification and attendance guidance are completed.</dd><dt>Right to refuse and consequences</dt><dd>You may refuse consent, but winner verification and attendee registration may be unavailable if you do not consent.</dd></dl>`,
    ja:`<dl class="privacy-grid"><dt>取得・利用目的</dt><dd>観覧当選者の確認、本人確認および観覧案内</dd><dt>取得項目</dt><dd>Muniverse登録メールアドレス・ニックネーム、氏名、国籍、生年月日、電話番号、観覧案内用メールアドレス</dd><dt>保有・利用期間</dt><dd>観覧者確認および案内の完了後、遅滞なく削除します。</dd><dt>同意を拒否する権利と不利益</dt><dd>同意を拒否できますが、同意しない場合は当選確認および観覧登録が制限されます。</dd></dl>`,
    'zh-TW':`<dl class="privacy-grid"><dt>蒐集與利用目的</dt><dd>確認觀眾中獎資格、本人確認及觀眾活動通知</dd><dt>蒐集項目</dt><dd>Muniverse 註冊信箱與暱稱、姓名、國籍、出生日期、聯絡電話、觀眾通知用電子郵件</dd><dt>保存與利用期間</dt><dd>觀眾身分確認及通知完成後，將立即刪除。</dd><dt>拒絕同意及其影響</dt><dd>您可拒絕同意，但若不同意，可能無法進行中獎確認及觀眾登記。</dd></dl>`,
    'zh-CN':`<dl class="privacy-grid"><dt>收集与使用目的</dt><dd>确认观众中奖资格、本人核验及观众活动通知</dd><dt>收集项目</dt><dd>Muniverse 注册邮箱与昵称、姓名、国籍、出生日期、联系电话、观众通知用电子邮箱</dd><dt>保存与使用期限</dt><dd>观众身份确认及通知完成后，将及时删除。</dd><dt>拒绝同意及其影响</dt><dd>您可以拒绝同意，但若不同意，可能无法进行中奖确认及观众登记。</dd></dl>`
  };
  for(const [lang,html] of Object.entries(PRIVACY)){
    if(window.MC_COPY&&window.MC_COPY[lang]) window.MC_COPY[lang].privacy=html;
  }
})();