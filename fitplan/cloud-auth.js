/* FORMDAY v0.3.2: authentication-only pilot.
 * No Firestore import, no data upload, no modification to legacy localStorage.
 * Firebase's public web config is not an administrator credential.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js';

const firebaseConfig = Object.freeze({
  apiKey: 'AIzaSyATSBbeQoLdskdkPfzP7pTep7dZPlDJX6E',
  authDomain: 'healthy-df79f.firebaseapp.com',
  projectId: 'healthy-df79f',
  appId: '1:188014722362:web:8478b91792c6e0890ae403',
  messagingSenderId: '188014722362'
});

const button = document.getElementById('fd-account-btn');
const dialog = document.getElementById('fd-account-dialog');
const loginBtn = document.getElementById('fd-login');
const logoutBtn = document.getElementById('fd-logout');
const dismissBtn = document.getElementById('fd-account-close');
const status = document.getElementById('fd-account-status');
const account = document.getElementById('fd-account-label');
const warning = document.getElementById('fd-account-warning');
let user = null;
let busy = false;
let auth = null;

function setStatus(message, error=false) {
  if (!status) return;
  status.textContent = message;
  status.dataset.error = error ? 'true' : 'false';
}
function showUser(nextUser) {
  user = nextUser;
  if (loginBtn) loginBtn.hidden = Boolean(user);
  if (logoutBtn) logoutBtn.hidden = !user;
  if (account) account.textContent = user ? (user.email || 'Google 계정 로그인됨') : '로그인하지 않았습니다';
  if (button) button.textContent = user ? '👤 계정 확인됨' : '👤 Google 로그인';
  if (warning) warning.textContent = 'Google 로그인은 계정 확인 단계입니다. 운동·식단·체중 기록은 여전히 이 브라우저에만 저장됩니다. Firestore 자동 동기화와 계정별 기록 분리는 아직 적용되지 않았습니다. 다른 계정으로 로그인해도 이 브라우저의 기존 기록은 사라지거나 계정별로 분리되지 않습니다. 공용 기기에서는 사용하지 마세요.';
  if (!busy) setStatus(user ? '로그인 계정이 확인되었습니다. 아직 클라우드로 전송한 기록은 없습니다.' : 'Google 로그인으로 계정을 확인할 수 있습니다. 기존 기록은 변경되지 않습니다.');
}
function errorText(error) {
  const code = error && error.code;
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '로그인이 취소되었습니다. 기록은 변경되지 않았습니다.';
  if (code === 'auth/popup-blocked') return '로그인 팝업이 차단됐습니다. Safari 또는 브라우저의 팝업 허용 설정을 확인해 주세요.';
  if (code === 'auth/unauthorized-domain') return '이 사이트가 Firebase 승인된 도메인에 등록되어 있는지 확인해 주세요.';
  if (code === 'auth/operation-not-allowed') return 'Firebase Authentication에서 Google 로그인 제공업체가 사용 설정되어 있는지 확인해 주세요.';
  if (code === 'auth/network-request-failed') return '네트워크 연결을 확인해 주세요. 로컬 기록은 유지됩니다.';
  return '로그인을 완료하지 못했습니다. 기존 브라우저 기록은 그대로 유지됩니다.';
}
function lock(next) {
  busy = next;
  if (loginBtn) loginBtn.disabled = next;
  if (logoutBtn) logoutBtn.disabled = next;
}
function open() {
  if (dialog && typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
}
if (button && dialog && loginBtn && logoutBtn && dismissBtn && status && account) {
  button.disabled = true;
  button.addEventListener('click', open);
  dismissBtn.addEventListener('click', () => dialog.close());
  loginBtn.addEventListener('click', async () => {
    if (!auth || busy) return;
    lock(true);
    setStatus('Google 로그인 창에서 계정을 선택해 주세요.');
    try {
      await setPersistence(auth, browserLocalPersistence);
      await signInWithPopup(auth, new GoogleAuthProvider());
      setStatus('로그인 완료. 운동·식단·체중 기록은 아직 이 브라우저에만 저장됩니다.');
    } catch (error) {
      setStatus(errorText(error), true);
    } finally { lock(false); }
  });
  logoutBtn.addEventListener('click', async () => {
    if (!auth || busy) return;
    lock(true);
    try {
      await signOut(auth);
      setStatus('Google 계정에서 로그아웃했습니다. 이 브라우저의 기존 기록은 그대로 남아 있습니다.');
    } catch (error) {
      setStatus('로그아웃에 실패했습니다. 네트워크 연결을 확인해 주세요.', true);
    } finally { lock(false); }
  });
  try {
    const firebaseApp = initializeApp(firebaseConfig, 'formday-auth');
    auth = getAuth(firebaseApp);
    onAuthStateChanged(auth, showUser, () => setStatus('계정 로그인 상태를 확인할 수 없습니다. 브라우저 기록은 유지됩니다.', true));
    button.disabled = false;
    showUser(auth.currentUser);
  } catch (error) {
    setStatus('Firebase 로그인 초기화에 실패했습니다. 브라우저 기록과 기존 사용 기능은 그대로 유지됩니다.', true);
    button.disabled = true;
  }
}
