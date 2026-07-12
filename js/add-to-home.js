// add-to-home.js
// Shows a one-time "Add to Home Screen" prompt on mobile browsers, with
// platform-specific instructions, after a short delay. Skips entirely on
// desktop, if the site is already installed/running standalone, or if the
// visitor dismissed it before (remembered in localStorage, per device).

const DISMISS_KEY = 'courtsheet_a2hs_dismissed';
const SHOW_DELAY_MS = 5000;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function detectPlatform() {
  const ua = navigator.userAgent || '';
  // iPadOS reports itself as a Mac by default, so also check for a
  // touch-capable "MacIntel" device, which only a real Mac would never be.
  const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isIOS = /iPhone|iPod/.test(ua) || isIPad;
  const isAndroid = /Android/.test(ua);
  if (isIOS) return 'ios';
  if (isAndroid) return 'android';
  return null;
}

function buildBanner(platform) {
  const steps = platform === 'ios'
    ? [
        'Tap the <strong>&bull;&bull;&bull;</strong> icon at the top of Safari',
        'Tap <strong>Share</strong>',
        'Scroll down and tap <strong>Add to Home Screen</strong>'
      ]
    : [
        'Tap the <strong>&#8942;</strong> menu icon (top right of Chrome)',
        'Tap <strong>Add to home screen</strong>',
        'Tap <strong>Add</strong> to confirm'
      ];

  const wrap = document.createElement('div');
  wrap.className = 'a2hs-banner';
  wrap.innerHTML = `
    <div class="a2hs-banner__card">
      <button type="button" class="a2hs-banner__close" aria-label="Dismiss">&times;</button>
      <div class="a2hs-banner__title">Add Court Sheet to your Home Screen</div>
      <p class="a2hs-banner__lead">For one-tap access next time:</p>
      <ol class="a2hs-banner__steps">
        ${steps.map(s => `<li>${s}</li>`).join('')}
      </ol>
    </div>
  `;
  wrap.querySelector('.a2hs-banner__close').addEventListener('click', () => {
    try { localStorage.setItem(DISMISS_KEY, 'yes'); } catch (e) { /* ignore */ }
    wrap.remove();
  });
  return wrap;
}

function init() {
  if (isStandalone()) return;

  try {
    if (localStorage.getItem(DISMISS_KEY) === 'yes') return;
  } catch (e) {
    return; // localStorage unavailable (e.g. private browsing) - skip quietly
  }

  const platform = detectPlatform();
  if (!platform) return; // desktop: no home screen prompt needed

  setTimeout(() => {
    document.body.appendChild(buildBanner(platform));
  }, SHOW_DELAY_MS);
}

init();
