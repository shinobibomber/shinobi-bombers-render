# Run locally only. Never paste the resulting secret into chat or source control.
# This creates a NEW dedicated authority; do not run to replace an existing configured authority.
$ErrorActionPreference = 'Stop'
$founderProject = Split-Path -Parent $PSScriptRoot
$founderCode = @'
const {createRequire}=require('node:module');
const path=require('node:path');
const req=createRequire(path.join(process.argv[1],'app','package.json'));
const kp=req('@solana/web3.js').Keypair.generate();
process.stdout.write(JSON.stringify({publicKey:kp.publicKey.toBase58(),secret:JSON.stringify([...kp.secretKey])}));
'@
$founderRaw = & node -e $founderCode $founderProject 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Key generation failed; run the local app build first.' }
$founderKey = $founderRaw | ConvertFrom-Json
Set-Clipboard -Value $founderKey.secret
Write-Host ('Dedicated mint authority PUBLIC address: ' + $founderKey.publicKey)
Write-Host 'Secret copied to clipboard only. In the live Render service Environment page, add FOUNDERS_MINT_AUTHORITY_SECRET and paste its value.'
Write-Host 'Keep all sale switches off. Save the environment change, then clear the clipboard with Set-Clipboard -Value "".'
Write-Host 'Never paste the value into chat. Report only the public address and that it was saved.'
$founderKey = $null
$founderRaw = $null
