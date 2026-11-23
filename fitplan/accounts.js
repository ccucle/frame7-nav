/* FORMDAY account UI. Passwords and recovery codes never enter record drafts. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FormdayAccounts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  let sequence = 0;
  const EMPTY = { available: null, loading: false, user: null, active: false, dirty: false, syncing: false, conflict: null, error: '', lastSyncedAt: null, selectionRequired: false, localCount: null, remoteCount: null, reauthRequired: false };
  const FIELD_NAMES = ['login-username', 'login-password', 'register-username', 'register-password', 'register-confirm', 'recover-username', 'recover-code', 'recover-password', 'recover-confirm'];
  const knownCount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const count = value => knownCount(value) ? Math.floor(value).toLocaleString('ko-KR') : '미확인';
  const records = value => knownCount(value) ? '일정 ' + count(value) + '개' : '일정 수 미확인';
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function dateText(value) {
    if (!value) return '아직 동기화하지 않았습니다';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '동기화 시간을 확인할 수 없습니다';
  }
  function mount(container, options) {
    if (!container || typeof container.querySelector !== 'function') throw new Error('계정 화면을 찾을 수 없습니다.');
    options = options || {};
    const cloud = options.cloud || null, prefix = 'fa-' + (++sequence);
    let status = { ...EMPTY }, tab = 'login', pending = '', disposed = false, localError = '', notice = '', recovery = null, reauthUser = '';
    const baselines = Object.fromEntries(FIELD_NAMES.map(name => [name, '']));
    function input(name, label, type, attributes) {
      return `<label class="fa-field" for="${prefix}-${name}"><span>${label}</span><input id="${prefix}-${name}" type="${type}" data-fa-field="${name}" ${attributes || ''}></label>`;
    }
    const usernameAttributes = 'autocomplete="username" autocapitalize="none" spellcheck="false" minlength="4" maxlength="32" placeholder="영문 소문자·숫자·._-"';
    const newPasswordAttributes = 'autocomplete="new-password" minlength="15" maxlength="128" placeholder="15~128자"';
    container.innerHTML = `<section class="fa-editor" aria-label="계정과 동기화"><div class="fa-intro"><span class="fa-mark" aria-hidden="true">F</span><div><h3>어디서든 이어지는 나의 기록</h3><p>계정에 연결해 식단과 운동 기록을 보관하세요.</p></div></div><div class="fa-connection" data-fa-node="connection" role="status"><span class="fa-connection-dot" aria-hidden="true"></span><div><strong data-fa-node="connection-title"></strong><p data-fa-node="connection-description"></p></div></div><button type="button" class="fa-text-button fa-retry" data-fa-action="retry" hidden>연결 다시 확인</button><p class="fa-error" data-fa-node="error" role="alert" hidden></p><p class="fa-notice" data-fa-node="notice" role="status" hidden></p><div class="fa-busy" data-fa-node="busy" role="status" hidden>요청을 처리하고 있습니다. 이 화면을 잠시 유지해 주세요.</div><div data-fa-node="auth"><p class="fa-reauth-note" data-fa-node="reauth-note" hidden>기기 기록은 유지됩니다. 같은 계정으로 다시 로그인해 동기화하세요.</p><div class="fa-tabs" data-fa-node="tabs" role="tablist" aria-label="계정 메뉴"><button type="button" role="tab" data-fa-action="tab" data-tab="login" aria-selected="true">로그인</button><button type="button" role="tab" data-fa-action="tab" data-tab="register" aria-selected="false">회원가입</button><button type="button" role="tab" data-fa-action="tab" data-tab="recover" aria-selected="false">계정 복구</button></div><form data-fa-form="login" novalidate>${input('login-username', '아이디', 'text', usernameAttributes)}${input('login-password', '비밀번호', 'password', 'autocomplete="current-password" minlength="15" maxlength="128" placeholder="비밀번호 입력"')}<button type="submit" class="fa-button fa-primary fa-submit" data-fa-submit="login">로그인</button></form><form data-fa-form="register" novalidate hidden>${input('register-username', '사용할 아이디', 'text', usernameAttributes)}<p class="fa-field-help">4~32자 · 영문 소문자, 숫자, 마침표, 밑줄, 하이픈을 사용할 수 있습니다.</p>${input('register-password', '비밀번호', 'password', newPasswordAttributes)}${input('register-confirm', '비밀번호 확인', 'password', 'autocomplete="new-password" minlength="15" maxlength="128" placeholder="같은 비밀번호를 한 번 더 입력"')}<p class="fa-field-help">비밀번호는 15~128자입니다. 가입하면 계정 복구에 필요한 일회성 표시 코드를 받습니다.</p><button type="submit" class="fa-button fa-primary fa-submit" data-fa-submit="register">계정 만들기</button></form><form data-fa-form="recover" novalidate hidden><div class="fa-explanation"><strong>저장해 둔 복구 코드가 필요합니다</strong><p>비밀번호를 바꾸면 기존 복구 코드는 더 이상 사용할 수 없으며 모든 기기에서 로그아웃됩니다. 새 복구 코드를 다시 보관해 주세요.</p></div>${input('recover-username', '복구할 아이디', 'text', usernameAttributes)}${input('recover-code', '복구 코드', 'password', 'autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="200" placeholder="가입 때 보관한 코드"')}${input('recover-password', '새 비밀번호', 'password', newPasswordAttributes)}${input('recover-confirm', '새 비밀번호 확인', 'password', 'autocomplete="new-password" minlength="15" maxlength="128" placeholder="새 비밀번호를 한 번 더 입력"')}<button type="submit" class="fa-button fa-primary fa-submit" data-fa-submit="recover">비밀번호 복구</button></form><p class="fa-auth-note">이메일 인증과 Google 로그인은 제공하지 않습니다. 아이디·비밀번호로 로그인하고, 비밀번호를 잊으면 복구 코드를 사용합니다.</p></div><section class="fa-recovery" data-fa-node="recovery" hidden aria-label="복구 코드 보관"><span class="fa-step">꼭 보관해 주세요</span><h4 data-fa-node="recovery-title"></h4><p>이 코드는 <strong>지금 이 화면에서만</strong> 확인할 수 있습니다. 비밀번호를 잊었을 때 계정을 되찾는 데 필요하며, 나중에 다시 표시할 수 없습니다.</p><div class="fa-code-box"><code data-fa-node="recovery-code" tabindex="0" aria-label="새 복구 코드"></code><button type="button" class="fa-button fa-secondary" data-fa-action="copy-recovery">코드 복사</button></div><p class="fa-code-help">비밀번호 관리자 등 안전한 곳에 따로 보관하고 다른 사람에게 공유하지 마세요. 코드와 비밀번호를 모두 잃으면 계정을 복구할 수 없습니다.</p><label class="fa-check"><input type="checkbox" data-fa-field="recovery-ack"><span>복구 코드를 안전한 곳에 따로 보관했습니다.</span></label><button type="button" class="fa-button fa-primary fa-submit" data-fa-action="ack-recovery" disabled>기록 선택으로 계속</button></section><section class="fa-selection" data-fa-node="selection" hidden aria-label="사용할 기록 선택"><span class="fa-step">계정 연결 · 사용할 기록 선택</span><h4><span data-fa-node="selection-username"></span>님의 기록</h4><p class="fa-section-copy">아래 개수는 일정 수입니다. 일정·내 식품·즐겨찾기·목표를 포함한 전체 기록 중 사용할 쪽을 선택하세요. 두 기록을 자동으로 합치지 않습니다.</p><div class="fa-source-card"><div><span>계정에 저장된 일정</span><strong><b data-fa-node="selection-remote-count"></b><span data-fa-node="selection-remote-unit">개</span></strong></div><button type="button" class="fa-button fa-primary" data-fa-action="select-cloud">계정 기록 사용</button></div><div class="fa-source-card"><div><span>이 기기의 일정</span><strong><b data-fa-node="selection-local-count"></b><span data-fa-node="selection-local-unit">개</span></strong></div><button type="button" class="fa-button fa-secondary" data-fa-action="select-local">이 기기 기록을 계정으로 옮기기</button></div><p class="fa-choice-warning" data-fa-node="selection-warning"></p><div class="fa-export-row"><button type="button" class="fa-text-button" data-fa-action="export">이 기기 기록 내보내기</button><button type="button" class="fa-text-button" data-fa-action="logout">로그아웃</button></div></section><section class="fa-account" data-fa-node="account" hidden aria-label="계정 동기화 상태"><div class="fa-account-heading"><span class="fa-avatar" aria-hidden="true">●</span><div><span>연결한 계정</span><h4 data-fa-node="username"></h4></div></div><dl class="fa-status-list"><div><dt>마지막 동기화</dt><dd data-fa-node="synced-at"></dd></div><div><dt>현재 상태</dt><dd data-fa-node="sync-state"></dd></div></dl><p class="fa-pending-note" data-fa-node="pending-note" hidden>이 기기의 변경 사항을 먼저 동기화한 뒤 로그아웃하세요. 동기화에 실패해도 이 기기의 기록은 유지됩니다.</p><div class="fa-account-actions"><button type="button" class="fa-button fa-primary" data-fa-action="sync">지금 동기화</button><button type="button" class="fa-button fa-secondary" data-fa-action="export">기록 내보내기</button><button type="button" class="fa-text-button fa-logout" data-fa-action="logout">로그아웃</button></div></section><section class="fa-conflict" data-fa-node="conflict" hidden aria-label="기록 충돌 해결"><span class="fa-step">동기화 확인 필요</span><h4>두 곳의 기록이 달라졌어요</h4><p class="fa-section-copy">다른 기기에서 계정 기록이 바뀌어 자동 동기화를 멈췄습니다. 필요한 기록을 먼저 내보낸 뒤 유지할 쪽을 선택하세요.</p><div class="fa-conflict-counts"><div><span>계정에 저장된 일정</span><strong><b data-fa-node="conflict-remote-count"></b><span data-fa-node="conflict-remote-unit">개</span></strong></div><div><span>이 기기의 일정</span><strong><b data-fa-node="conflict-local-count"></b><span data-fa-node="conflict-local-unit">개</span></strong></div></div><div class="fa-conflict-choice"><button type="button" class="fa-button fa-secondary" data-fa-action="resolve-cloud">계정 기록 불러오기</button><p>이 기기의 미전송 변경 사항을 계정 기록으로 대체합니다. 일정·내 식품·즐겨찾기·목표가 함께 바뀝니다.</p></div><div class="fa-conflict-choice"><button type="button" class="fa-button fa-secondary" data-fa-action="resolve-local">이 기기 기록으로 계정 갱신</button><p>계정의 일정·내 식품·즐겨찾기·목표 전체를 이 기기 기록으로 덮어씁니다. 다른 기기의 변경 사항은 합쳐지지 않습니다.</p></div><button type="button" class="fa-text-button" data-fa-action="export">먼저 이 기기 기록 내보내기</button></section><details class="fa-privacy"><summary>계정과 이 기기 기록은 어떻게 보관되나요?</summary><p>로그인하지 않고 작성한 기록과 계정 기록은 구분해서 보관합니다. 처음 연결할 때 사용할 기록을 직접 선택하며, 다른 계정에 자동으로 합치지 않습니다.</p><p>공유 기기에서는 작업을 마친 뒤 로그아웃하세요. 내보낸 파일에도 운동·식단·체중 정보가 담기므로 안전한 곳에 보관하세요.</p></details></section>`;
    const nodes = {};
    for (const name of ['connection', 'connection-title', 'connection-description', 'error', 'notice', 'busy', 'auth', 'recovery', 'recovery-title', 'recovery-code', 'selection', 'selection-username', 'selection-remote-count', 'selection-local-count', 'selection-warning', 'account', 'username', 'synced-at', 'sync-state', 'pending-note', 'conflict', 'conflict-remote-count', 'conflict-local-count', 'tabs', 'reauth-note', 'selection-remote-unit', 'selection-local-unit', 'conflict-remote-unit', 'conflict-local-unit']) nodes[name] = container.querySelector('[data-fa-node="' + name + '"]');
    const fields = Object.fromEntries([...FIELD_NAMES, 'recovery-ack'].map(name => [name, container.querySelector('[data-fa-field="' + name + '"]')]));
    const forms = Object.fromEntries(['login', 'register', 'recover'].map(name => [name, container.querySelector('[data-fa-form="' + name + '"]')]));
    const buttons = name => container.querySelectorAll('[data-fa-action="' + name + '"]');
    const text = (name, value) => { if (nodes[name]) nodes[name].textContent = value; };
    const hidden = (name, value) => { if (nodes[name]) nodes[name].hidden = !!value; };
    function hasInput() { return FIELD_NAMES.some(name => fields[name].value !== baselines[name]); }
    function isDirty() { return !disposed && (!!pending || !!(recovery && !recovery.checked) || hasInput()); }
    function draft() { return { dirty: isDirty(), recoveryPending: !!(recovery && !recovery.checked), pending: !!pending }; }
    function changed() { if (!disposed && typeof options.onChange === 'function') options.onChange(draft()); }
    function readStatus() {
      if (cloud && typeof cloud.status === 'function') {
        try { const next = cloud.status(); if (next && typeof next === 'object' && typeof next.then !== 'function') status = { ...EMPTY, ...next }; } catch (_) { /* Keep the last confirmed status. */ }
      }
    }
    function render() {
      if (disposed) return;
      const busy = !!pending || !!status.loading || !!status.syncing;
      const available = status.available === true;
      const user = status.user && typeof status.user === 'object' ? status.user : null;
      const reauth = !!status.reauthRequired && !!user;
      const authTransition = pending === 'register' || pending === 'recover';
      if (reauth) {
        tab = 'login';
        const username = typeof user.username === 'string' ? user.username : '';
        if (reauthUser !== username) {
          fields['login-username'].value = username;
          baselines['login-username'] = username;
          reauthUser = username;
        }
      } else reauthUser = '';
      let title, description, state;
      if (status.available === null || status.loading) {
        title = '계정 저장 준비 중'; description = '연결 상태를 확인하고 있습니다. 기록은 현재 브라우저에 저장됩니다.'; state = 'waiting';
      } else if (!available) {
        title = '현재 브라우저에 저장 중'; description = '계정 저장을 아직 사용할 수 없습니다. 연결이 준비되면 로그인과 동기화를 이용할 수 있습니다.'; state = 'local';
      } else if (reauth) {
        title = '계정에 다시 로그인해 주세요'; description = '기기 기록은 유지됩니다. 같은 계정으로 다시 로그인해 동기화하세요.'; state = 'warning';
      } else if (status.conflict) {
        title = '동기화할 기록을 확인해 주세요'; description = '계정과 이 기기의 기록이 달라 자동 동기화를 멈췄습니다.'; state = 'warning';
      } else if (status.syncing) {
        title = '계정에 기록을 저장하고 있습니다'; description = '동기화가 완료될 때까지 잠시 기다려 주세요.'; state = 'waiting';
      } else if (user && status.active) {
        title = status.dirty ? '이 기기의 변경 사항이 대기 중입니다' : '계정과 연결되어 있습니다';
        description = status.dirty ? '연결이 가능할 때 변경 사항을 계정에 동기화합니다.' : '운동·식단·체중 기록을 계정에 보관합니다.'; state = status.dirty ? 'waiting' : 'ready';
      } else if (user) {
        title = '계정에 로그인했습니다'; description = '사용할 기록을 선택하면 동기화를 시작합니다.'; state = 'ready';
      } else {
        title = '현재 브라우저에 저장 중'; description = '로그인하면 계정에 기록을 보관하고 다른 기기에서 이어갈 수 있습니다.'; state = 'local';
      }
      text('connection-title', title); text('connection-description', description);
      nodes.connection.dataset.state = state;
      for (const button of buttons('retry')) { button.hidden = available && !status.error; button.disabled = busy; }
      text('error', localError || (typeof status.error === 'string' ? status.error : '')); hidden('error', !localError && !status.error);
      text('notice', notice); hidden('notice', !notice);
      hidden('busy', !pending);
      hidden('auth', (!!user && !reauth) || !!recovery);
      hidden('tabs', reauth);
      hidden('reauth-note', !reauth);
      hidden('recovery', !recovery);
      hidden('selection', !user || !!status.active || !!recovery || authTransition || !!status.conflict || reauth);
      hidden('account', !user || !status.active || !!recovery);
      hidden('conflict', !user || !status.conflict || !!recovery || authTransition || reauth);
      for (const name of ['login', 'register', 'recover']) {
        forms[name].hidden = tab !== name;
        const submit = container.querySelector('[data-fa-submit="' + name + '"]');
        submit.disabled = !available || busy;
        submit.textContent = pending === name ? (name === 'login' ? '로그인 중…' : name === 'register' ? '계정을 만드는 중…' : '복구 중…') : ({ login: '로그인', register: '계정 만들기', recover: '비밀번호 복구' }[name]);
      }
      for (const button of buttons('tab')) { button.setAttribute('aria-selected', String(button.dataset.tab === tab)); button.disabled = !!pending || !!recovery || reauth; }
      // readOnly preserves focus and selection; status polling never replaces fields.
      for (const name of FIELD_NAMES) fields[name].readOnly = !!pending || (reauth && name === 'login-username');
      if (recovery) {
        text('recovery-title', recovery.kind === 'register' ? '계정을 만들었어요. 복구 코드를 보관하세요.' : '비밀번호가 변경되었어요. 새 코드를 보관하세요.');
        text('recovery-code', recovery.code);
        fields['recovery-ack'].checked = recovery.checked;
        for (const button of buttons('ack-recovery')) { button.disabled = !recovery.checked || !!pending; button.textContent = recovery.kind === 'register' ? '기록 선택으로 계속' : '로그인으로 돌아가기'; }
      }
      const username = user && typeof user.username === 'string' ? user.username : '';
      text('selection-username', username); text('username', username);
      text('selection-remote-count', count(status.remoteCount)); text('selection-local-count', count(status.localCount));
      text('conflict-remote-count', count(status.remoteCount)); text('conflict-local-count', count(status.localCount));
      for (const scope of ['selection', 'conflict']) {
        text(scope + '-remote-unit', knownCount(status.remoteCount) ? '개' : '');
        text(scope + '-local-unit', knownCount(status.localCount) ? '개' : '');
      }
      text('selection-warning', (!knownCount(status.remoteCount) ? '계정 일정 수를 아직 확인하지 못했습니다. ' : '') + '이 기기 기록을 선택하면 계정의 일정·내 식품·즐겨찾기·목표 전체를 교체합니다. 일정이 0개여도 보관한 식품과 목표가 있을 수 있습니다. 필요한 계정 기록은 먼저 불러온 뒤 내보내세요.');
      text('synced-at', dateText(status.lastSyncedAt));
      text('sync-state', reauth ? '다시 로그인해야 동기화할 수 있습니다' : status.conflict ? '어떤 기록을 유지할지 선택해야 합니다' : status.syncing ? '동기화 중' : status.error ? '동기화 확인 필요 · 기록은 이 기기에 유지됩니다' : status.dirty ? '전송할 변경 사항이 있습니다' : status.available !== true ? '연결 대기 · 이 기기 기록을 사용 중입니다' : '전송할 변경 사항이 없습니다');
      hidden('pending-note', !status.dirty && !status.conflict);
      for (const action of ['select-cloud', 'select-local', 'resolve-cloud', 'resolve-local', 'sync']) for (const button of buttons(action)) button.disabled = !available || busy || !!recovery || reauth || (action === 'sync' && !!status.conflict);
      for (const button of buttons('logout')) button.disabled = busy || !!recovery;
      for (const button of buttons('export')) button.disabled = !!pending || typeof options.onExport !== 'function';
      for (const button of buttons('copy-recovery')) button.disabled = !recovery || !!pending;
    }
    function clearFields() {
      for (const name of FIELD_NAMES) { fields[name].value = ''; baselines[name] = ''; }
    }
    function clearRecovery() {
      if (recovery) recovery.code = '';
      recovery = null; text('recovery-code', ''); fields['recovery-ack'].checked = false;
    }
    function error(message) { localError = String(message || '요청을 처리하지 못했습니다. 다시 시도해 주세요.'); render(); }
    function credentials(kind) {
      const username = fields[kind + '-username'].value.trim(), password = fields[kind + '-password'].value;
      if (!/^[a-z0-9._-]{4,32}$/.test(username)) throw new Error('아이디는 영문 소문자, 숫자, . _ -만 사용해 4~32자로 입력해 주세요.');
      if (password.length < 15 || password.length > 128) throw new Error('비밀번호는 15~128자로 입력해 주세요.');
      if (kind !== 'login' && password !== fields[kind + '-confirm'].value) throw new Error('비밀번호 확인이 일치하지 않습니다. 다시 입력해 주세요.');
      if (kind === 'recover') {
        const recoveryCode = fields['recover-code'].value.trim();
        if (!recoveryCode) throw new Error('보관한 복구 코드를 입력해 주세요.');
        return { username, recoveryCode, newPassword: password };
      }
      return { username, password };
    }
    async function run(action, task, success) {
      if (disposed || pending || status.loading || status.syncing) return;
      localError = ''; notice = ''; pending = action; render(); changed();
      try {
        const result = await task();
        if (disposed) return;
        readStatus();
        if (success) success(result);
      } catch (failure) {
        if (!disposed) {
          readStatus();
          localError = failure && typeof failure.message === 'string' ? failure.message : '요청을 처리하지 못했습니다. 입력한 내용은 유지됩니다.';
          if (action === 'logout') localError += ' 로그아웃하지 않았으며 현재 기록과 상태는 유지됩니다.';
        }
      } finally {
        if (!disposed) { pending = ''; render(); changed(); }
      }
    }
    function requireMethod(name) {
      if (!cloud || typeof cloud[name] !== 'function') throw new Error('계정 저장 기능을 아직 사용할 수 없습니다. 현재 브라우저의 기록은 유지됩니다.');
      return cloud[name].bind(cloud);
    }
    async function authenticate(kind) {
      if (pending || status.loading || status.syncing || recovery) return;
      if (status.reauthRequired && kind !== 'login') return;
      if (status.available !== true) { error('계정 연결을 확인한 뒤 다시 시도해 주세요. 기록은 현재 브라우저에 저장됩니다.'); return; }
      let args, method;
      try { args = credentials(kind); method = requireMethod(kind); } catch (failure) { error(failure.message); return; }
      await run(kind, () => method(args), result => {
        if (kind === 'login') {
          if (!status.user || status.reauthRequired) throw new Error('로그인 상태를 확인하지 못했습니다. 입력 내용은 유지됩니다. 다시 시도해 주세요.');
          clearFields(); notice = status.active ? '다시 로그인했습니다. 이 기기의 변경 사항을 동기화할 수 있습니다.' : '로그인했습니다. 사용할 기록을 선택해 주세요.';
        } else {
          if (!result || typeof result.recoveryCode !== 'string' || !result.recoveryCode) throw new Error('복구 코드 응답을 확인하지 못했습니다. 현재 계정 상태를 확인해 주세요.');
          recovery = { kind, code: result.recoveryCode, username: args.username, checked: false };
          clearFields(); notice = '';
        }
      });
      // Never retain credential arguments in a controller draft or local storage.
      if (args) { if (own(args, 'password')) args.password = ''; if (own(args, 'newPassword')) args.newPassword = ''; if (own(args, 'recoveryCode')) args.recoveryCode = ''; }
    }
    function confirmed(message) { return typeof root.confirm === 'function' && root.confirm(message); }
    function chooseSource(source, conflict) {
      if (pending || recovery || status.available !== true || status.loading || status.syncing || status.reauthRequired) return;
      const local = records(status.localCount), remote = records(status.remoteCount);
      if (conflict) {
        const message = source === 'cloud'
          ? '계정의 전체 기록을 불러오면 이 기기에서 아직 전송하지 못한 변경 사항은 사라집니다(계정 ' + remote + ' / 이 기기 ' + local + '). 일정·내 식품·즐겨찾기·목표가 모두 계정 기록으로 대체됩니다. 필요한 이 기기 기록을 먼저 내보내세요. 계정 기록으로 바꿀까요?'
          : '계정의 전체 기록을 이 기기의 기록으로 덮어씁니다(계정 ' + remote + ' / 이 기기 ' + local + '). 일정·내 식품·즐겨찾기·목표가 모두 교체됩니다. 다른 기기에서 계정에 저장한 변경 사항은 합쳐지지 않습니다. 필요한 기록을 먼저 백업했는지 확인해 주세요. 계정 기록을 갱신할까요?';
        if (!confirmed(message)) return;
      } else if (source === 'local') {
        if (!confirmed('계정의 전체 기록을 이 기기의 기록으로 교체합니다(계정 ' + remote + ' / 이 기기 ' + local + '). 일정·내 식품·즐겨찾기·목표가 모두 덮어써지며 자동으로 합치지 않습니다. 필요한 기록을 먼저 내보냈는지 확인해 주세요. 계속할까요?')) return;
      } else if (source === 'cloud' && status.dirty) {
        if (!confirmed('계정 기록을 사용하면 이 기기에서 아직 전송하지 못한 변경 사항을 대체합니다. 일정·내 식품·즐겨찾기·목표가 모두 계정 기록으로 바뀝니다. 필요한 이 기기 기록을 먼저 내보내세요. 계정 기록을 불러올까요?')) return;
      }
      const name = conflict ? 'resolveConflict' : 'selectSource';
      run(name, () => requireMethod(name)(source), () => { notice = conflict ? '선택한 기록으로 충돌을 해결했습니다.' : '선택한 기록으로 계정을 연결했습니다.'; });
    }
    function onSubmit(event) {
      const form = event.target && event.target.closest ? event.target.closest('[data-fa-form]') : null;
      if (!form || !container.contains(form)) return;
      event.preventDefault(); authenticate(form.dataset.faForm);
    }
    function onInput(event) {
      const target = event.target;
      if (!target || !target.dataset || !target.dataset.faField) return;
      if (target.dataset.faField === 'recovery-ack') {
        if (recovery) recovery.checked = !!target.checked;
        render();
      }
      changed();
    }
    function onChange(event) {
      if (event.target && event.target.dataset && event.target.dataset.faField === 'recovery-ack') onInput(event);
    }
    async function onClick(event) {
      const button = event.target && event.target.closest ? event.target.closest('[data-fa-action]') : null;
      if (!button || button.disabled || !container.contains(button)) return;
      event.preventDefault();
      const action = button.dataset.faAction;
      if (action === 'tab') { if (!pending && !recovery && !status.reauthRequired) { tab = button.dataset.tab; localError = ''; notice = ''; render(); } }
      else if (action === 'retry') run('init', () => requireMethod('init')());
      else if (action === 'select-cloud' || action === 'select-local') chooseSource(action === 'select-cloud' ? 'cloud' : 'local', false);
      else if (action === 'resolve-cloud' || action === 'resolve-local') chooseSource(action === 'resolve-cloud' ? 'cloud' : 'local', true);
      else if (action === 'sync') run('syncNow', () => requireMethod('syncNow')(), () => { notice = '동기화가 완료되었습니다.'; });
      else if (action === 'logout') run('logout', () => requireMethod('logout')(), () => { clearFields(); clearRecovery(); tab = 'login'; notice = '로그아웃했습니다. 로그인하지 않은 상태의 이 기기 기록을 사용합니다.'; });
      else if (action === 'export') {
        if (typeof options.onExport === 'function') { try { await options.onExport(); } catch (failure) { if (!disposed) error(failure && failure.message); } }
      } else if (action === 'copy-recovery' && recovery && !pending) {
        try {
          if (!root.navigator || !root.navigator.clipboard || typeof root.navigator.clipboard.writeText !== 'function') throw new Error('복사 기능을 사용할 수 없습니다. 코드를 직접 선택해 복사해 주세요.');
          await root.navigator.clipboard.writeText(recovery.code);
          if (!disposed) { notice = '복구 코드를 복사했습니다. 안전한 곳에 따로 보관해 주세요.'; render(); }
        } catch (_) { if (!disposed) error('복사 기능을 사용할 수 없습니다. 코드를 직접 선택해 복사해 주세요.'); }
      } else if (action === 'ack-recovery' && recovery && recovery.checked && !pending) {
        const kind = recovery.kind, username = recovery.username;
        clearRecovery(); localError = ''; notice = kind === 'register' ? '이제 사용할 기록을 선택해 주세요.' : '새 비밀번호로 로그인해 주세요.';
        if (kind === 'recover') { tab = 'login'; fields['login-username'].value = username; baselines['login-username'] = username; }
        readStatus(); render(); changed();
      }
    }
    function update(next) {
      if (disposed) return;
      if (next && typeof next === 'object') status = { ...EMPTY, ...next };
      else readStatus();
      render();
    }
    container.addEventListener('submit', onSubmit); container.addEventListener('input', onInput);
    container.addEventListener('change', onChange); container.addEventListener('click', onClick);
    readStatus(); render();
    return { update, isDirty, draft, destroy() {
      if (disposed) return;
      disposed = true; clearFields(); clearRecovery(); pending = ''; localError = ''; notice = '';
      container.removeEventListener('submit', onSubmit); container.removeEventListener('input', onInput);
      container.removeEventListener('change', onChange); container.removeEventListener('click', onClick);
    } };
  }
  return Object.freeze({ mount });
});
