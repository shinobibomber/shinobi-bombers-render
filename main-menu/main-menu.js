/* Preserve the supplied main-menu artwork; account values and actions stay live. */
(() => {
  async function setup() {
    await ReferenceLayout.ready;
    const home = document.getElementById('p5');
    if (home.querySelector('#exactHomeScene')) return;
    const main = document.querySelector('main');
    const bar = document.querySelector('.menu-topbar');
    const barLocation = document.createComment('shared menu toolbar');
    bar.before(barLocation);

    const scene = document.createElement('div');
    scene.id = 'exactHomeScene';
    scene.setAttribute('aria-label', 'Hidden Village main menu');
    // Keep the scene outside page transition transforms, which change the
    // containing block of fixed elements on the legacy home page.
    const screen = document.createElement('section');
    screen.id = 'exactHomeScreen';
    screen.hidden = true;
    screen.setAttribute('aria-label', 'Hidden Village');
    screen.append(scene);
    document.body.append(screen);
    const artwork = new Image(1536, 1024);
    artwork.className = 'exact-home-art';
    artwork.alt = '';
    artwork.setAttribute('aria-hidden', 'true');
    artwork.draggable = false;
    artwork.src = 'assets/design-v3/ref-home.png';
    scene.append(artwork);

    function target(parent, label, box, action, className = '') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'exact-home-target ' + className;
      button.setAttribute('aria-label', label);
      button.title = label;
      const [x, y, width, height] = box;
      Object.assign(button.style, { left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px' });
      button.addEventListener('click', action);
      parent.append(button);
      return button;
    }

    const navigation = document.createElement('nav');
    navigation.className = 'exact-home-navigation';
    navigation.setAttribute('aria-label', 'Village navigation');
    const routes = [
      ['Home', 199, 5], ['Heroes', 274, 1], ['Adventure', 342, 0],
      ['Summon', 409, 2], ['Fusion', 476, 6], ['Dojo', 543, 4],
      ['Market', 609, 4, 1], ['Boss Hunt', 688, 8], ['Codex', 754, 3]
    ];
    for (const [label, y, page, mode] of routes) {
      const button = target(navigation, label, [32, y, 212, label === 'Home' ? 68 : 64], () => go(page, mode));
      if (page === 5) button.setAttribute('aria-current', 'page');
    }
    target(navigation, 'Leaderboard — coming soon', [32, 819, 212, 64], () => notice('Leaderboard', 'The leaderboard is coming soon.'));
    target(navigation, 'Guild — coming soon', [32, 885, 212, 64], () => notice('Guild', 'Guilds are coming soon.'));
    scene.append(navigation);

    const cards = document.createElement('div');
    cards.className = 'exact-home-cards';
    for (const [label, box, page, mode] of [
      ['Adventure: enter battlefields', [274, 499, 302, 277], 0],
      ['Summoning Shrine: summon new Shinobi', [585, 499, 297, 277], 2],
      ['Dojo: train your Shinobi', [894, 499, 284, 277], 4],
      ['Heroes: manage your collection', [274, 788, 328, 172], 1],
      ['Market: trade heroes', [610, 788, 271, 172], 4, 1],
      ['Fusion: combine Shinobi', [892, 788, 286, 172], 6],
      ['Boss Hunts: challenge guardians', [1189, 788, 330, 172], 8]
    ]) target(cards, label, box, () => go(page, mode));
    scene.append(cards);
    target(scene, 'Events', [1189, 510, 330, 226], () => notice('Events', 'No active event is configured. Check back for upcoming events.'));
    target(scene, 'Open Ryo wallet', [852, 16, 166, 47], () => ShinobiBetaUI.open(), 'exact-home-wallet');

    // Reuse the existing live profile and rarity counts from the second reference.
    const profile = home.querySelector('.reference-profile');
    profile.classList.add('exact-home-profile');
    const team = document.getElementById('referenceTeam').closest('section');
    team.classList.add('exact-home-team');
    scene.append(profile, team);

    const name = document.getElementById('referencePlayerName');
    name.setAttribute('role', 'button');
    name.tabIndex = 0;
    name.setAttribute('aria-label', 'Set your Shinobi nickname');
    name.addEventListener('click', editNickname);
    name.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); editNickname(); }
    });

    const muteButton = document.getElementById('mu');
    function refreshMute() {
      muteButton.setAttribute('aria-label', mu ? 'Unmute game audio' : 'Mute game audio');
      muteButton.setAttribute('aria-pressed', String(!!mu));
    }
    muteButton.addEventListener('click', refreshMute);
    refreshMute();

    const dialog = document.createElement('dialog');
    dialog.className = 'exact-home-dialog';
    dialog.setAttribute('aria-labelledby', 'exactHomeDialogTitle');
    document.body.append(dialog);
    function notice(title, message) {
      dialog.replaceChildren();
      const heading = document.createElement('h2'); heading.id = 'exactHomeDialogTitle'; heading.textContent = title;
      const text = document.createElement('p'); text.textContent = message;
      const close = document.createElement('button'); close.type = 'button'; close.textContent = 'Close'; close.onclick = () => dialog.close();
      dialog.append(heading, text, close); dialog.showModal();
    }
    function editNickname() {
      dialog.replaceChildren();
      const heading = document.createElement('h2'); heading.id = 'exactHomeDialogTitle'; heading.textContent = 'Your Shinobi name';
      const form = document.createElement('form');
      const label = document.createElement('label'); label.textContent = 'Nickname';
      const input = document.createElement('input'); input.maxLength = 14; input.required = true; input.value = S.nick || ''; label.append(input);
      const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = 'Save';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.onclick = () => dialog.close();
      form.append(label, submit, cancel);
      form.onsubmit = event => {
        event.preventDefault();
        if (!input.value.trim()) return;
        document.getElementById('ni').value = input.value;
        nick(); save(); ReferenceLayout.refresh(); dialog.close();
      };
      dialog.append(heading, form); dialog.showModal();
    }

    const balanceMeasure = document.createElement('canvas').getContext('2d');
    let balanceText = '';
    function fitBalance() {
      const amount = document.getElementById('ry'), currency = amount?.closest('.ry');
      if (!amount || !currency) return;
      const text = amount.textContent.trim();
      currency.title = text + ' Ryo'; amount.setAttribute('aria-label', text + ' Ryo');
      if (text === balanceText) return;
      balanceText = text;
      // Fit the entire number inside the original wallet artwork. The audio
      // control has its own reserved box, so it never covers trailing digits.
      balanceMeasure.font = '700 21px Arial';
      const measured = balanceMeasure.measureText(text).width;
      scene.style.setProperty('--home-amount-font-size', Math.min(21, 21 * 84 / Math.max(1, measured)) + 'px');
    }
    new MutationObserver(() => { if (tab === 5) fitBalance(); }).observe(document.getElementById('ry'), { childList: true, characterData: true, subtree: true });
    let fingerprint = '';
    function refreshProfile() {
      if (tab !== 5) return;
      fitBalance();
      const next = JSON.stringify([S.nick, S.h.map(h => [h.id, h.r, h.on])]);
      if (next === fingerprint) return;
      fingerprint = next;
      ReferenceLayout.refresh();
    }
    function resize() {
      scene.style.setProperty('--main-menu-scale', Math.min(innerWidth / 1536, innerHeight / 1024));
    }
    function sync() {
      const active = tab === 5 && !window.LoginScreen?.active && !window.GameLoading?.active;
      document.body.classList.toggle('exact-home-active', active);
      screen.hidden = !active;
      screen.inert = !active;
      if (active) { scene.append(bar); resize(); refreshProfile(); }
      else if (bar.parentNode === scene) barLocation.after(bar);
    }
    const previousGo = go;
    go = function (...args) { const result = previousGo(...args); sync(); return result; };
    const previousHud = hud;
    hud = function (...args) { const result = previousHud(...args); refreshProfile(); return result; };
    new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', resize);
    addEventListener('shinobi-ryo-ledger', refreshProfile);
    GameLoading.ready.then(sync);
    sync();
    window.ExactMainMenu = { refresh: refreshProfile, fitBalance };
  }
  setup().catch(error => console.error('Main menu artwork could not be applied:', error));
})();
