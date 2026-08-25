(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const COUNTRY_CODES = ["AW","AF","AO","AI","AX","AL","AD","AE","AR","AM","AS","AQ","TF","AG","AU","AT","AZ","BI","BE","BJ","BQ","BF","BD","BG","BH","BS","BA","BL","BY","BZ","BM","BO","BR","BB","BN","BT","BV","BW","CF","CA","CC","CH","CL","CN","CI","CM","CD","CG","CK","CO","KM","CV","CR","CU","CW","CX","KY","CY","CZ","DE","DJ","DM","DK","DO","DZ","EC","EG","ER","EH","ES","EE","ET","FI","FJ","FK","FR","FO","FM","GA","GB","GE","GG","GH","GI","GN","GP","GM","GW","GQ","GR","GD","GL","GT","GF","GU","GY","HK","HM","HN","HR","HT","HU","ID","IM","IN","IO","IE","IR","IQ","IS","IL","IT","JM","JE","JO","JP","KZ","KE","KG","KH","KI","KN","KR","KW","LA","LB","LR","LY","LC","LI","LK","LS","LT","LU","LV","MO","MF","MA","MC","MD","MG","MV","MX","MH","MK","ML","MT","MM","ME","MN","MP","MZ","MR","MS","MQ","MU","MW","MY","YT","NA","NC","NE","NF","NG","NI","NU","NL","NO","NP","NR","NZ","OM","PK","PA","PN","PE","PH","PW","PG","PL","PR","KP","PT","PY","PS","PF","QA","RE","RO","RU","RW","SA","SD","SN","SG","GS","SH","SJ","SB","SL","SV","SM","SO","PM","RS","SS","ST","SR","SK","SI","SE","SZ","SX","SC","SY","TC","TD","TG","TH","TJ","TK","TM","TL","TO","TT","TN","TR","TV","TW","TZ","UG","UA","UM","UY","US","UZ","VA","VC","VE","VG","VI","VN","VU","WF","WS","YE","ZA","ZM","ZW"];
  const COPY = {
    ko: { korean:'한국인', foreign:'한국인 아님', country:'국가 선택', choose:'국가를 선택해 주세요', nationalityHint:'한국인이 아닌 경우 국가를 선택해 주세요.', koreanPhone:'한국 번호 있음', internationalPhone:'한국 번호 없음', koreanPhoneHint:'한국 휴대전화 번호를 입력해 주세요. (예: 010-1234-5678)', internationalPhoneHint:'국가번호와 지역번호를 포함해 입력해 주세요. (예: +1 212 555 1234)' },
    en: { korean:'Korean', foreign:'Not Korean', country:'Country', choose:'Select a country', nationalityHint:'Select your country if you are not Korean.', koreanPhone:'I have a Korean number', internationalPhone:'I do not have a Korean number', koreanPhoneHint:'Enter a Korean mobile number. (e.g. 010-1234-5678)', internationalPhoneHint:'Include the country and area codes. (e.g. +1 212 555 1234)' },
    ja: { korean:'韓国籍', foreign:'韓国籍ではない', country:'国を選択', choose:'国を選択してください', nationalityHint:'韓国籍でない場合は国を選択してください。', koreanPhone:'韓国の電話番号あり', internationalPhone:'韓国の電話番号なし', koreanPhoneHint:'韓国の携帯電話番号を入力してください。（例：010-1234-5678）', internationalPhoneHint:'国番号と市外局番を含めて入力してください。（例：+81 3 1234 5678）' },
    'zh-TW': { korean:'韓國籍', foreign:'非韓國籍', country:'選擇國家', choose:'請選擇國家', nationalityHint:'若非韓國籍，請選擇您的國家。', koreanPhone:'有韓國電話號碼', internationalPhone:'沒有韓國電話號碼', koreanPhoneHint:'請輸入韓國手機號碼。（例：010-1234-5678）', internationalPhoneHint:'請包含國碼與區域碼。（例：+886 2 1234 5678）' },
    'zh-CN': { korean:'韩国籍', foreign:'非韩国籍', country:'选择国家', choose:'请选择国家', nationalityHint:'如非韩国籍，请选择您的国家。', koreanPhone:'有韩国电话号码', internationalPhone:'没有韩国电话号码', koreanPhoneHint:'请输入韩国手机号。（例：010-1234-5678）', internationalPhoneHint:'请包含国家代码和区号。（例：+86 10 1234 5678）' }
  };

  const lang = () => COPY[$('lang')?.value] ? $('lang').value : 'en';
  const t = () => COPY[lang()];

  function countryName(code) {
    try {
      return new Intl.DisplayNames([lang()], { type: 'region' }).of(code) || code;
    } catch {
      return code;
    }
  }

  function fillCountries() {
    const select = $('country');
    if (!select) return;
    const previous = select.value;
    select.textContent = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = t().choose;
    select.appendChild(first);
    COUNTRY_CODES
      .filter((code) => code !== 'KR')
      .map((code) => ({ code, name: countryName(code) }))
      .sort((a, b) => a.name.localeCompare(b.name, lang()))
      .forEach((item) => {
        const option = document.createElement('option');
        option.value = item.code;
        option.textContent = item.name;
        select.appendChild(option);
      });
    if ([...select.options].some((option) => option.value === previous)) select.value = previous;
  }

  function selectedRadio(name) {
    return document.querySelector(`input[name="${name}"]:checked`)?.value || '';
  }

  function normalizeKoreanPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (!/^010\d{8}$/.test(digits)) return '';
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  function normalizeInternationalPhone(value) {
    const raw = String(value || '').trim();
    if (!raw.startsWith('+')) return '';
    const digits = raw.slice(1).replace(/\D/g, '');
    if (!/^\d{8,15}$/.test(digits)) return '';
    return `+${digits}`;
  }

  function sync() {
    const nationalityMode = selectedRadio('nationalityMode') || 'KR';
    const phoneMode = selectedRadio('phoneMode') || 'KR';
    const countryWrap = $('countryWrap');
    const koreanPhoneWrap = $('koreanPhoneWrap');
    const internationalPhoneWrap = $('internationalPhoneWrap');

    countryWrap?.classList.toggle('hidden', nationalityMode !== 'NON_KR');
    koreanPhoneWrap?.classList.toggle('hidden', phoneMode !== 'KR');
    internationalPhoneWrap?.classList.toggle('hidden', phoneMode !== 'INTL');

    const nationality = nationalityMode === 'KR' ? 'KR' : ($('country')?.value || '');
    const phone = phoneMode === 'KR'
      ? normalizeKoreanPhone($('koreanPhone')?.value)
      : normalizeInternationalPhone($('internationalPhone')?.value);

    if ($('nationality')) $('nationality').value = nationality;
    if ($('phone')) $('phone').value = phone;
    if ($('nationalityHint')) $('nationalityHint').textContent = nationalityMode === 'NON_KR' ? t().nationalityHint : '';
    if ($('phoneHint')) $('phoneHint').textContent = phoneMode === 'KR' ? t().koreanPhoneHint : t().internationalPhoneHint;

    window.dispatchEvent(new CustomEvent('attendee-fields-change'));
    return { nationality, phone, nationalityMode, phoneMode };
  }

  function translate() {
    if ($('nationalityKoreanLabel')) $('nationalityKoreanLabel').textContent = t().korean;
    if ($('nationalityForeignLabel')) $('nationalityForeignLabel').textContent = t().foreign;
    if ($('countryLabel')) $('countryLabel').textContent = t().country;
    if ($('phoneKoreanLabel')) $('phoneKoreanLabel').textContent = t().koreanPhone;
    if ($('phoneInternationalLabel')) $('phoneInternationalLabel').textContent = t().internationalPhone;
    fillCountries();
    sync();
  }

  document.querySelectorAll('input[name="nationalityMode"], input[name="phoneMode"]').forEach((input) => input.addEventListener('change', sync));
  $('country')?.addEventListener('change', sync);
  $('koreanPhone')?.addEventListener('input', sync);
  $('internationalPhone')?.addEventListener('input', sync);
  $('lang')?.addEventListener('change', () => queueMicrotask(translate));
  window.addEventListener('attendee-language-change', translate);
  window.addEventListener('mc-language-change', translate);

  window.AttendeeFields = {
    sync,
    values: () => sync(),
    valid: () => {
      const values = sync();
      return Boolean(values.nationality && values.phone);
    }
  };

  translate();
})();
