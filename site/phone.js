(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const countries = [
    ['KR','82'],['JP','81'],['CN','86'],['TW','886'],['HK','852'],['US','1'],['CA','1'],
    ['TH','66'],['PH','63'],['ID','62'],['MY','60'],['SG','65'],['VN','84'],['IN','91'],
    ['AU','61'],['NZ','64'],['GB','44'],['FR','33'],['DE','49'],['ES','34'],['IT','39'],
    ['NL','31'],['CH','41'],['SE','46'],['NO','47'],['DK','45'],['FI','358'],['PL','48'],
    ['TR','90'],['AE','971'],['SA','966'],['BR','55'],['MX','52'],['ZA','27']
  ];
  const dialMap = Object.fromEntries(countries);
  const copy = {
    ko:{choose:'국적을 선택하세요',otherCountry:'기타 국가/지역',domestic:'한국 휴대전화 (010)',national:'국적 국가번호 사용',other:'다른 국가/지역 번호',natHint:'해외 국적이어도 한국 010 휴대전화를 사용하는 경우 선택할 수 있습니다.',domHint:'국적과 관계없이 한국에서 사용하는 010 휴대전화 번호를 입력하세요.',intHint:'국가번호는 자동 입력됩니다. 국가번호 뒤 번호만 입력해 주세요.',otherHint:'사용할 국가/지역 번호를 직접 입력해 주세요.',dial:'국가/지역 번호'},
    ja:{choose:'国籍を選択してください',otherCountry:'その他の国・地域',domestic:'韓国の携帯番号 (010)',national:'国籍の国番号を使用',other:'別の国・地域番号',natHint:'外国籍でも韓国010番号を使用する場合は選択できます。',domHint:'韓国010番号を入力してください。',intHint:'国番号は自動入力されます。残りの番号を入力してください。',otherHint:'利用する国・地域番号を入力してください。',dial:'国・地域番号'},
    en:{choose:'Select nationality',otherCountry:'Other country/region',domestic:'Korean mobile number (010)',national:'Use nationality country code',other:'Use another country/region code',natHint:'Foreign nationals using a Korean 010 number may choose the Korean mobile option.',domHint:'Enter the Korean 010 mobile number regardless of nationality.',intHint:'The country code is filled automatically. Enter the remaining number.',otherHint:'Enter the country/region calling code you use.',dial:'Country/region code'},
    'zh-TW':{choose:'請選擇國籍',otherCountry:'其他國家／地區',domestic:'韓國手機號碼 (010)',national:'使用國籍國碼',other:'使用其他國家／地區國碼',natHint:'外國籍若使用韓國010號碼，也可選擇韓國手機。',domHint:'請輸入韓國010手機號碼。',intHint:'國碼會自動帶入，請輸入其後的號碼。',otherHint:'請輸入使用中的國家／地區國碼。',dial:'國家／地區國碼'},
    'zh-CN':{choose:'请选择国籍',otherCountry:'其他国家／地区',domestic:'韩国手机号 (010)',national:'使用国籍国家代码',other:'使用其他国家／地区代码',natHint:'外国国籍如使用韩国010号码，也可选择韩国手机。',domHint:'请输入韩国010手机号。',intHint:'国家代码会自动填入，请输入其后的号码。',otherHint:'请输入使用中的国家／地区代码。',dial:'国家／地区代码'}
  };
  const text = () => copy[$('lang').value] || copy.en;
  function countryName(iso) {
    try { return new Intl.DisplayNames([$ ('lang').value], {type:'region'}).of(iso) || iso; }
    catch { return iso; }
  }
  function fillCountries() {
    const old = $('nationality').value;
    $('nationality').textContent = '';
    const first = document.createElement('option');
    first.value = ''; first.textContent = text().choose; $('nationality').appendChild(first);
    countries.map(([iso,dial]) => ({iso,dial,name:countryName(iso)})).sort((a,b) => a.name.localeCompare(b.name)).forEach((item) => {
      const o = document.createElement('option'); o.value = item.iso; o.textContent = item.name; $('nationality').appendChild(o);
    });
    const other = document.createElement('option'); other.value = 'OTHER'; other.textContent = text().otherCountry; $('nationality').appendChild(other);
    if ([...$('nationality').options].some((o) => o.value === old)) $('nationality').value = old;
  }
  function fillModes() {
    const old = $('phoneMode').value;
    $('phoneMode').innerHTML = '<option value="domestic">'+text().domestic+'</option><option value="national">'+text().national+'</option><option value="other">'+text().other+'</option>';
    if (old) $('phoneMode').value = old;
  }
  function selectedDial() { return dialMap[$('nationality').value] || ''; }
  function syncPhone() {
    const mode = $('phoneMode').value;
    let local = $('phoneLocal').value.trim();
    if (!local) { $('phone').value = ''; return; }
    if (mode === 'domestic') {
      local = local.replace(/^010[-\s]?/, '');
      $('phone').value = ('010-' + local).replace(/--+/g, '-');
      return;
    }
    let prefix = mode === 'national' ? selectedDial() : $('otherDialCode').value.trim().replace(/^\+/, '').replace(/\D/g, '');
    $('phone').value = prefix ? ('+' + prefix + ' ' + local) : local;
  }
  function updateUI() {
    const mode = $('phoneMode').value;
    $('otherCodeWrap').classList.toggle('hidden', mode !== 'other');
    $('otherDialLabel').textContent = text().dial;
    $('nationalityHint').textContent = text().natHint;
    if (mode === 'domestic') { $('dialPrefix').textContent = '010'; $('phoneHint').textContent = text().domHint; }
    else if (mode === 'national') { $('dialPrefix').textContent = selectedDial() ? ('+' + selectedDial()) : '+'; $('phoneHint').textContent = text().intHint; }
    else { const c = $('otherDialCode').value.trim() || '+'; $('dialPrefix').textContent = c.startsWith('+') ? c : ('+' + c); $('phoneHint').textContent = text().otherHint; }
    syncPhone();
  }
  function defaultMode() {
    const iso = $('nationality').value;
    $('phoneMode').value = !iso || iso === 'KR' ? 'domestic' : iso === 'OTHER' ? 'other' : 'national';
    updateUI();
  }
  function translate() {
    const iso = $('nationality').value, mode = $('phoneMode').value;
    fillCountries(); fillModes();
    if (iso) $('nationality').value = iso;
    if (mode) $('phoneMode').value = mode;
    updateUI();
  }
  $('nationality').addEventListener('change', defaultMode);
  $('phoneMode').addEventListener('change', updateUI);
  $('phoneLocal').addEventListener('input', syncPhone);
  $('otherDialCode').addEventListener('input', updateUI);
  window.addEventListener('mc-language-change', translate);
  fillCountries(); fillModes(); $('phoneMode').value = 'domestic'; updateUI();
})();