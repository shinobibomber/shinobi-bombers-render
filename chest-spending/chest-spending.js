/* Direct Chest Reward Spending, checkout client (apply-chest-spending.cjs). The server quote carries a read-only `chest` offer
 * (chest-spending.cjs offer); this adds a "Pay using" choice to the existing token checkout dialog for Summon, Fusion, Dojo and
 * Training: Chest rewards (verified, unclaimed SR) or the game balance. The choice travels with the one stored purchase request
 * (RyoPayments.purchase), so a retry or a double click reuses the same request id. The server re-checks every limit and settles
 * the purchase exactly like a balance purchase; nothing is shown as paid before the server answers. */
(() => {
  'use strict';
  const fmt = n => Math.max(0, Math.floor(Number(n) || 0)).toLocaleString();
  const style = document.createElement('style');
  style.textContent = '.chest-pay{margin:10px 0;padding:10px 12px;border:1px solid #c9a35a66;border-radius:8px}.chest-pay legend{padding:0 6px;font-weight:700;letter-spacing:.04em}.chest-pay label{display:flex;gap:8px;align-items:center;margin:6px 0;cursor:pointer}.chest-pay label.off{opacity:.55;cursor:not-allowed}.chest-pay-note{margin:6px 0 0;font-size:.9em;opacity:.9}';
  const LIMITS = { chest: 'Not enough verified Chest rewards yet.', budget: "Today's approved Chest reward budget can't cover this purchase.", pool: "The funded reward pool can't cover this purchase right now.", custody: 'Custody tokens are temporarily unavailable.' };

  function decorate(dialog, q) {
    const c = q?.chest, actions = dialog?.querySelector('.checkout-actions');
    if (!c?.enabled || !actions) return;
    if (!style.isConnected) document.head.append(style);
    const total = Number(q.total) || 0, balance = Number(window.RyoPayments?.state?.balance) || 0, canChest = Number(c.spendableRyo) >= total;
    const box = document.createElement('fieldset');
    box.className = 'chest-pay';
    box.innerHTML = '<legend>Pay using</legend>'
      + '<label class="' + (canChest ? '' : 'off') + '"><input type="radio" name="chestPay" value="chest"' + (canChest ? '' : ' disabled') + '> <span><b>Chest rewards</b> (verified, unclaimed) · ' + fmt(c.spendableRyo) + ' SR usable now of ' + fmt(c.chestRyo) + ' SR</span></label>'
      + '<label><input type="radio" name="chestPay" value="balance"> <span><b>Game balance</b> (deposited / claimed SR) · ' + fmt(balance) + ' SR</span></label>'
      + '<p class="chest-pay-note" role="status"></p>';
    const note = box.querySelector('.chest-pay-note'), confirm = dialog.querySelector('#checkoutConfirm'), label = confirm?.textContent;
    const priceRow = [...dialog.querySelectorAll('dt')].find(dt => /deposited|charged/i.test(dt.textContent)), priceText = priceRow?.textContent;
    const pick = canChest && balance < total ? 'chest' : 'balance';
    box.querySelector('input[value="' + pick + '"]').checked = true;
    const update = () => {
      const v = box.querySelector('input:checked')?.value || 'balance';
      q.payWith = v;
      if (priceRow) priceRow.textContent = v === 'chest' ? 'Price · paid from Chest rewards' : priceText;
      if (v === 'chest') {
        note.textContent = 'Chest rewards after this purchase: ' + fmt(Number(c.chestRyo) - total) + ' SR. No withdrawal fee, and your claim timer is not used'
          + (Number(c.nextClaimAt) > Date.now() ? ' (next claim ' + new Date(Number(c.nextClaimAt)).toLocaleString() + ')' : '') + '. If the purchase fails, your Chest rewards are restored.';
        if (confirm) confirm.textContent = 'Pay ' + fmt(total) + ' SR from Chest';
      } else {
        note.textContent = (canChest ? '' : (LIMITS[c.limitedBy] || 'Chest rewards cannot pay this purchase right now.') + ' ') + 'Game balance after this purchase: ' + fmt(balance - total) + ' SR.';
        if (confirm && label) confirm.textContent = label;
      }
    };
    box.addEventListener('change', update);
    actions.before(box);
    update();
  }
  window.ChestSpending = { decorate };
})();
