/* Limited Mythic NFT Box (Solana Devnet while testing): info, mint and recovery for the event dialog.
   The server builds one transaction (1 SOL payment + the box NFT) and signs it as mint authority;
   this page reviews it, the player's wallet signs it, and it is sent. Nothing else can be inside it. */
(() => {
  const sdk = window.ShinobiSolana, DEVNET = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', PENDING = 'shinobi-mythic-box-v1';
  const PROGRAMS = { system: '11111111111111111111111111111111', token22: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', ata: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', memo: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const read = () => { try { return JSON.parse(localStorage.getItem(PENDING) || 'null'); } catch { return null; } };
  const write = v => { try { v ? localStorage.setItem(PENDING, JSON.stringify(v)) : localStorage.removeItem(PENDING); } catch {} };
  const account = () => window.RyoPayments?.state?.account || window.BetaWallet?.state?.account || null;
  const base58 = bytes => { let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let out = ''; const a = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; while (n) { out = a[Number(n % 58n)] + out; n /= 58n; } for (const b of bytes) { if (b) break; out = '1' + out; } return out; };
  const fromBase64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));

  // Only the expected instructions: one SOL payment from the player, the NFT mint into the player's
  // own token account, and the box memo. Anything else (or a different payer or amount) is refused.
  function review(tx, { owner, price, mint }) {
    const player = new sdk.PublicKey(owner);
    if (!tx.feePayer?.equals(player)) throw Error('This box transaction is not paid by your wallet.');
    let paid = 0n, memo = false, minted = false;
    const ata = sdk.getAssociatedTokenAddressSync(new sdk.PublicKey(mint), player, false, new sdk.PublicKey(PROGRAMS.token22)).toBase58();
    for (const ix of tx.instructions) {
      const program = ix.programId.toBase58();
      if (!Object.values(PROGRAMS).includes(program)) throw Error('Unexpected program in the box transaction.');
      if (program === PROGRAMS.system) {
        const kind = sdk.SystemInstruction.decodeInstructionType(ix);
        if (kind === 'Transfer') { const t = sdk.SystemInstruction.decodeTransfer(ix); if (!t.fromPubkey.equals(player)) throw Error('Unexpected SOL transfer.'); paid += BigInt(t.lamports); }
        else if (kind === 'Create') { const c = sdk.SystemInstruction.decodeCreateAccount(ix); if (c.newAccountPubkey.toBase58() !== mint || c.programId.toBase58() !== PROGRAMS.token22) throw Error('Unexpected account in the box transaction.'); }
        else throw Error('Unexpected SOL instruction.');
      }
      if (program === PROGRAMS.memo) memo = new TextDecoder().decode(ix.data).startsWith('shinobi-box-v1:');
      if (program === PROGRAMS.token22 && ix.data[0] === 7) minted = ix.keys[1]?.pubkey.toBase58() === ata; // MintTo → your account
    }
    if (paid !== BigInt(Math.round(price * 1e9))) throw Error('The box price in the transaction does not match.');
    if (!memo || !minted) throw Error('The box transaction does not mint the NFT to your wallet.');
  }
  // Default wallet adapter: the connected Phantom/Solflare signs; the page sends to Solana Devnet.
  const adapter = {
    async signAndSend(wire, expect) {
      const kind = window.BetaWallet?.state?.wallet;
      const provider = kind === 'solflare' ? window.solflare : (window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null));
      if (!provider?.signTransaction) throw Error('Connect Phantom or Solflare to mint.');
      const connection = new sdk.Connection(window.ShinobiBetaConfig?.rpcUrl || 'https://api.devnet.solana.com', 'confirmed');
      if (await connection.getGenesisHash() !== DEVNET) throw Error('Your RPC is not Solana Devnet. Nothing was sent.');
      const tx = sdk.Transaction.from(fromBase64(wire)); review(tx, expect);
      const before = tx.serializeMessage(), signed = await provider.signTransaction(tx);
      const after = signed.serializeMessage();
      if (before.length !== after.length || before.some((b, i) => b !== after[i])) throw Error('The wallet changed the box transaction. Nothing was sent.');
      const mine = signed.signatures.find(s => s.publicKey.toBase58() === expect.owner)?.signature;
      if (!mine) throw Error('The wallet did not sign the box transaction.');
      const signature = base58(mine);
      await connection.sendRawTransaction(signed.serialize(), { preflightCommitment: 'confirmed' });
      return signature;
    }
  };
  const api = (action, body) => { if (!window.RyoPayments?.box) throw Error('Sign in to see the Mythic Box.'); return RyoPayments.box(action, body); };
  // Poll until the server sees the transaction finalized (or expired).
  async function settle(requestId, signature, onStep) {
    for (let i = 0; i < 45; i++) {
      const data = await api('box-confirm', { requestId, signature });
      if (data.mint.status !== 'pending') { write(null); return data; }
      onStep?.('confirming'); await sleep(i < 5 ? 2000 : 4000);
    }
    throw Error('Still confirming on Solana Devnet. Your box is safe: reopen the event to finish.');
  }
  window.MythicBox = {
    wallet: adapter, review,
    info: () => api('box-info', {}),
    pending: () => { const p = read(); return p && p.account === account() ? p : null; },
    async mint(onStep) {
      const owner = account(); if (!owner) throw Error('Sign in with your wallet to mint.');
      let pending = this.pending();
      if (!pending) { pending = { account: owner, requestId: 'box-' + crypto.randomUUID() }; write(pending); }
      if (pending.signature) return settle(pending.requestId, pending.signature, onStep);
      let data;
      try { data = await api('box-mint', { requestId: pending.requestId }); }
      catch (e) { write(null); throw e; }
      if (data.mint.status !== 'pending') { write(null); return data; }
      if (!data.mint.wire) { write(null); throw Error('That box reservation expired. Try again.'); }
      onStep?.('signing');
      let signature;
      // A cancelled signature keeps the reservation: trying again signs the same transaction.
      signature = await this.wallet.signAndSend(data.mint.wire, { owner, price: data.mint.price, mint: data.mint.mint });
      write({ ...pending, signature });
      onStep?.('confirming');
      return settle(pending.requestId, signature, onStep);
    },
    async resume(onStep) { const p = this.pending(); return p?.signature ? settle(p.requestId, p.signature, onStep) : null; }
  };
})();
