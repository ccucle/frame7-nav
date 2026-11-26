// Initial page navigation only. Switching back to a running workout never restarts the opening.
(() => {
  const dialog = document.getElementById('fd-opening');
  const navigation = performance.getEntriesByType('navigation')[0];
  if (!dialog || typeof dialog.showModal !== 'function' ||
      navigation?.type === 'reload' || navigation?.type === 'back_forward') return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const artwork = dialog.querySelector('img');
  const status = dialog.querySelector('[role="status"]');
  const timers = [];
  let introFinished = false;
  let settled = dialog.dataset.authSettled === 'true';
  let exiting = false;

  function close() {
    timers.forEach(clearTimeout);
    window.removeEventListener('pagehide', close);
    dialog.removeEventListener('fd-auth-settled', onAuthSettled);
    document.removeEventListener('error', onResourceError, true);
    if (dialog.open) dialog.close();
    dialog.remove();
  }

  function update() {
    if (!introFinished || exiting) return;
    if (!settled) {
      status.hidden = false;
      return;
    }
    exiting = true;
    status.hidden = true;
    if (reducedMotion) {
      close();
    } else {
      dialog.classList.add('fd-opening-leave');
      timers.push(setTimeout(close, 220));
    }
  }

  function onAuthSettled() {
    settled = true;
    update();
  }

  function onResourceError(event) {
    // A failed module dependency cannot reach Firebase's initial observer.
    if (event.target?.id === 'fd-auth-module') onAuthSettled();
  }

  dialog.addEventListener('fd-auth-settled', onAuthSettled);
  document.addEventListener('error', onResourceError, true);
  window.addEventListener('pagehide', close, {once: true});
  dialog.addEventListener('cancel', close, {once: true});
  artwork.addEventListener('error', close, {once: true});
  artwork.src = reducedMotion ? artwork.dataset.still : artwork.dataset.motion;
  dialog.showModal();
  timers.push(setTimeout(() => {
    introFinished = true;
    update();
  }, reducedMotion ? 200 : 1800));
  // The local-first app stays usable even if the remote SDK never responds.
  timers.push(setTimeout(onAuthSettled, 8000));
})();
