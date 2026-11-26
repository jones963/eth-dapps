import React, { useEffect, useState } from 'react';
import { isAddress } from 'ethers';
import { ContractService } from './services/contractService.js';
import { TOKEN_ADDRESSES } from './utils/constants.js';

// Helper to format units
function formatUnits(rawValue, decimals, displayPlaces = 6) {
const value = BigInt(rawValue);
const scale = 10n ** BigInt(decimals);
const whole = value / scale;

const fraction = ((value % scale) * 10n ** BigInt(displayPlaces)) / scale;
const formattedFraction = fraction.toString().padStart(displayPlaces, '0').replace(/0+$/, '');
return formattedFraction ? `${whole}.${formattedFraction}` : whole.toString();
}
// Helper to parse chain ID
function parseChainId(value) {
if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
if (typeof value !== 'string') return null;
if (/^0x[0-9a-f]+$/i.test(value)) return Number.parseInt(value.slice(2), 16);
if (/^\d+$/.test(value)) return Number(value);
return null;
}
function App() {
const [walletProvider, setWalletProvider] = useState(null);
const [address, setAddress] = useState(null);
const [chainId, setChainId] = useState(null);
const [isConnecting, setIsConnecting] = useState(false);
const [connectError, setConnectError] = useState('');
const [balances, setBalances] = useState(null);
const [isLoadingBalances, setIsLoadingBalances] = useState(false);
const [balanceError, setBalanceError] = useState('');
const [balanceRefresh, setBalanceRefresh] = useState(0);
const [destinationAddress, setDestinationAddress] = useState('');
const [isSweeping, setIsSweeping] = useState(false);
const [sweepMessage, setSweepMessage] = useState('');
const [sweepNativeStatus, setSweepNativeStatus] = useState('');
const [sweepUsdtStatus, setSweepUsdtStatus] = useState('');
const isConnected = Boolean(address);
useEffect(() => {
if (!walletProvider?.on) return undefined;
const handleAccountsChanged = (accounts) => {
setAddress(Array.isArray(accounts) ? accounts[0] ?? null : null);
};
const handleChainChanged = (nextChainId) => setChainId(nextChainId);

walletProvider.on('accountsChanged', handleAccountsChanged);
walletProvider.on('chainChanged', handleChainChanged);
return () => {
walletProvider.removeListener?.('accountsChanged', handleAccountsChanged);
walletProvider.removeListener?.('chainChanged', handleChainChanged);
};
}, [walletProvider]);
const chainNumber = parseChainId(chainId);
const chainName = ({
1: 'Ethereum Mainnet',
56: 'BNB Smart Chain',
137: 'Polygon',
})[chainNumber] ?? (chainNumber ? `Chain ${chainNumber}` : 'unknown network');
const nativeSymbol = ({
1: 'ETH',
56: 'BNB',
137: 'POL'
})[chainNumber] ?? 'Native';
const usdtStandard = ({
1: 'ERC-20',
56: 'BEP-20',
137: 'ERC-20'
})[chainNumber];
const usdtDescription = isConnected
? usdtStandard
? `${usdtStandard} · ${chainName}`
: 'Not configured · ${chainName}'
: 'ERC-20 & BEP-20 · supported networks';
useEffect(() => {
if (!walletProvider || !address || !chainNumber) {
setBalances(null);
setBalanceError('');
setIsLoadingBalances(false);
return undefined;
}

let cancelled = false;
const loadBalances = async () => {
setBalances(null);
setBalanceError('');
setIsLoadingBalances(true);
const errors = [];
let nativeBalance = null;
let usdtBalance = null;
try {
const rawNativeBalance = await walletProvider.request({
method: 'eth_getBalance',
params: [address, 'latest'],
});
if (typeof rawNativeBalance !== 'string') {
throw new Error('The wallet returned an invalid native balance.');
}
nativeBalance = formatUnits(rawNativeBalance, 18);
} catch (error) {
errors.push(`Native balance unavailable: ${error instanceof Error ? error.message :
String(error)}`);
}
const tokenAddress = TOKEN_ADDRESSES[chainNumber]?.usdt;
if (tokenAddress) {
try {
const encodedAddress = address.slice(2).toLowerCase().padStart(64, '0');
const [rawTokenBalance, rawDecimals] = await Promise.all([
walletProvider.request({
method: 'eth_call',
params: [{ to: tokenAddress, data: `0x70a08231${encodedAddress}` }, 'latest'],
}),
walletProvider.request({
method: 'eth_call',
params: [{ to: tokenAddress, data: '0x313ce567' }, 'latest'],
}),
]);
if (typeof rawTokenBalance !== 'string' || typeof rawDecimals !== 'string') {
throw new Error('The token contract returned an invalid balance response.');

}
const decimals = Number(BigInt(rawDecimals));
if (!Number.isInteger(decimals) || decimals > 36) {
throw new Error('The token contract returned invalid decimal precision.');
}
usdtBalance = formatUnits(rawTokenBalance, decimals);
} catch (error) {
errors.push(`USDT balance unavailable: ${error instanceof Error ? error.message :
String(error)}`);
}
}
if (!cancelled) {
setBalances({ native: nativeBalance, usdt: usdtBalance });
setBalanceError(errors.join(' '));
setIsLoadingBalances(false);
}
};
loadBalances();
return () => {
cancelled = true;
};
}, [walletProvider, address, chainNumber, balanceRefresh]);
const connectWallet = async () => {
setConnectError('');
const provider = window.ethereum;
if (!provider?.request) {
setConnectError('No injected browser wallet found. Install or enable a compatible wallet.');
return;
}
setIsConnecting(true);
try {
const accounts = await provider.request({ method: 'eth_requestAccounts' });
const nextChainId = await provider.request({ method: 'eth_chainId' });
if (!Array.isArray(accounts) || typeof accounts[0] !== 'string') {
throw new Error('The wallet did not return an account.');

}
setWalletProvider(provider);
setAddress(accounts[0]);
setChainId(nextChainId);
} catch (error) {
setConnectError(error instanceof Error ? error.message : String(error));
} finally {
setIsConnecting(false);
}
};
const disconnectWallet = () => {
setWalletProvider(null);
setAddress(null);
setChainId(null);
setDestinationAddress('');
setConnectError('');
};
const getSweepDestination = () => {
const destination = destinationAddress.trim();
if (!isAddress(destination)) {
throw new Error('Enter a valid EVM destination address before sweeping.');
}
if (destination.toLowerCase() === address?.toLowerCase()) {
throw new Error('The destination must be different from the connected wallet.');
}
return destination;
};
const sendAndConfirm = async (transaction, setStatus) => {
const txHash = await walletProvider.request({
method: 'eth_sendTransaction',
params: [transaction],
});
if (typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
throw new Error('The wallet did not return a valid transaction hash.');
}
setStatus(`Transaction submitted: ${txHash}. Waiting for confirmation...`);

const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
const receipt = await walletProvider.request({
method: 'eth_getTransactionReceipt',
params: [txHash],
});
if (receipt) {
if (receipt.status === '0x0' || receipt.status === '0x00') {
throw new Error(`Transaction reverted: ${txHash}`);
}
setBalanceRefresh((revision) => revision + 1);
return txHash;
}
await new Promise((resolve) => setTimeout(resolve, 2000));
}

setStatus(`Transaction is still pending: ${txHash}. No success was reported.`);
return null;
};
const getUsdtBalance = async (tokenAddress) => {
const encodedAddress = address.slice(2).toLowerCase().padStart(64, '0');
const rawBalance = await walletProvider.request({
method: 'eth_call',
params: [{ to: tokenAddress, data: `0x70a08231${encodedAddress}` }, 'latest'],
});
if (typeof rawBalance !== 'string') {
throw new Error('The token contract returned an invalid balance.');
}
return BigInt(rawBalance);
};
const getNativeSweepTransaction = async (destination) => {
const [rawBalance, rawGasPrice] = await Promise.all([
walletProvider.request({ method: 'eth_getBalance', params: [address, 'latest'] }),
walletProvider.request({ method: 'eth_gasPrice' }),
]);
if (typeof rawBalance !== 'string' || typeof rawGasPrice !== 'string') {
throw new Error('The wallet returned invalid native balance or gas price data.');
}
if (BigInt(rawBalance) === 0n) return null;
const gasLimit = 21_000n;
const feeReserve = BigInt(rawGasPrice) * gasLimit * 2n;
const amount = BigInt(rawBalance) - feeReserve;
if (amount <= 0n) {
throw new Error('There is not enough native balance to cover the transfer and gas.');
}
return {
from: address,
to: destination,
value: `0x${amount.toString(16)}`,
gas: `0x${gasLimit.toString(16)}`,
};
};
const handleSweepNative = async () => {
if (!walletProvider || !address) return;
setIsSweeping(true);
setSweepNativeStatus('');
setSweepMessage('');
try {
const destination = getSweepDestination();
const transaction = await getNativeSweepTransaction(destination);
if (!transaction) throw new Error('No native balance is available to sweep.');
const txHash = await sendAndConfirm(transaction, setSweepNativeStatus);
if (txHash) setSweepNativeStatus(`Confirmed: ${txHash}`);
} catch (error) {
setSweepNativeStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
} finally {
setIsSweeping(false);
}
};
const handleSweepUSDT = async () => {
if (!walletProvider || !address) return;
setIsSweeping(true);
setSweepUsdtStatus('');
setSweepMessage('');
try {
const destination = getSweepDestination();
const tokenAddress = TOKEN_ADDRESSES[chainNumber]?.usdt;
if (!tokenAddress) throw new Error('USDT is not configured for this network.');
const amount = await getUsdtBalance(tokenAddress);
if (amount <= 0n) throw new Error('No USDT balance is available to sweep.');
const data = ContractService.encodeUSDTTransfer(destination, amount);
const txHash = await sendAndConfirm({
from: address,
to: tokenAddress,
data,
gas: '0x186A0',
}, setSweepUsdtStatus);
if (txHash) setSweepUsdtStatus(`Confirmed: ${txHash}`);
} catch (error) {
setSweepUsdtStatus(`Error: ${error instanceof Error ? error.message : String(error)}`);
} finally {
setIsSweeping(false);
}
};
const handleSweepAll = async () => {
if (!walletProvider || !address) return;
setIsSweeping(true);
setSweepMessage('Sweeping all assets...');
setSweepNativeStatus('');
setSweepUsdtStatus('');
try {
const destination = getSweepDestination();
let didSweep = false;
const tokenAddress = TOKEN_ADDRESSES[chainNumber]?.usdt;
if (tokenAddress) {
const amount = await getUsdtBalance(tokenAddress);
if (amount > 0n) {
setSweepUsdtStatus('Sweeping USDT...');
const data = ContractService.encodeUSDTTransfer(destination, amount);
const txHash = await sendAndConfirm({
from: address,
to: tokenAddress,
data,
gas: '0x186A0',
}, setSweepUsdtStatus);
if (!txHash) return;
setSweepUsdtStatus(`Confirmed: ${txHash}`);
didSweep = true;
} else {
setSweepUsdtStatus('No USDT to sweep.');
}
} else {
setSweepUsdtStatus('USDT is not configured for this network.');
}

const nativeTransaction = await getNativeSweepTransaction(destination);
if (nativeTransaction) {
setSweepNativeStatus('Sweeping native...');
const nativeTxHash = await sendAndConfirm(nativeTransaction, setSweepNativeStatus);
if (!nativeTxHash) return;
setSweepNativeStatus(`Confirmed: ${nativeTxHash}`);
didSweep = true;
} else {
setSweepNativeStatus('No native balance to sweep.');
}
setSweepMessage(didSweep
? 'Available assets swept and transactions confirmed.'
: 'No assets with a positive balance were found to sweep.');
} catch (error) {
setSweepMessage(`Error: ${error instanceof Error ? error.message : String(error)}`);
} finally {
setIsSweeping(false);
}
};
return (
<main className="app-shell">
<header className="topbar">
<a className="brand" href="/" aria-label="Multi-chain Wallet Dashboard home">
<span className="brand-mark" aria-hidden="true">E</span>
<span>Multi-chain Wallet Dashboard</span>
</a>
<span className="preview-badge">
<span className="status-dot" />
Transfers require approval
</span>

</header>
<div className="dashboard">
<section className="intro">
<div>
<p className="eyebrow">Portfolio dashboard</p>
<h1>Manage your assets</h1>
<p className="intro-copy">
Review supported networks and token balances in one place.
</p>
</div>
{isConnected ? (
<button className="connect-button" type="button" onClick={disconnectWallet}>
Disconnect app
</button>
) : (
<button
className="connect-button"
type="button"
disabled={isConnecting}
onClick={connectWallet}
>
{isConnecting ? 'Connecting...' : 'Connect wallet'}
</button>
)}
</section>
{isConnected && (
<section className="connection-status" role="status">
<span className="status-dot" />
<span>
Connected to {chainName} · <code>{address}</code>
</span>
</section>
)}
{connectError && (
<p className="connection-error" role="alert">
Wallet connection failed: {connectError}
</p>
)}

<section className="balance-card" aria-labelledby="balance-title">
<div className="balance-heading">
<div>
<p className="eyebrow">Wallet overview</p>
<h2 id="balance-title">Native balance</h2>
</div>
<span className="balance-icon" aria-hidden="true">◎</span>
</div>
<p className="balance-value">
  {isLoadingBalances ? 'Loading...' : balances?.native ?? '—'} <span>{nativeSymbol}</span>
</p>
<p className="muted-copy">
  {balanceError || (isConnected
    ? 'Balances are read from the selected network. Transfers require wallet approval.'
    : 'Connect a wallet to load native and USDT balances. Transfers require wallet approval.')}
            </p>

            {/* Native Sweep Button */}
            {isConnected && balances?.native && parseFloat(balances.native) > 0 && (
              <button
                className="sweep-button small"
                type="button"
                onClick={handleSweepNative}
                disabled={isSweeping}
              >
                Sweep {nativeSymbol}
              </button>
            )}
            {sweepNativeStatus && <p className="sweep-message">{sweepNativeStatus}</p>}
          </section>

          <section className="assets-section" aria-labelledby="assets-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Supported networks and tokens</p>
                <h2 id="assets-title">Your assets</h2>
              </div>
              <span className="asset-count">{isConnected ? chainName : '3 supported networks'}</span>
            </div>

            {isConnected && (
              <label className="destination-field">
                <span>Sweep destination</span>
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck="false"
                  placeholder="0x..."
                  value={destinationAddress}
                  onChange={(event) => setDestinationAddress(event.target.value)}
                  aria-label="Sweep destination address"
                />
                <small>MetaMask will ask you to approve each transaction.</small>
              </label>
            )}

            <div className="asset-list">
              <div className="asset-row">
                <span className="asset-icon usdt">$</span>
                <span className="asset-name">
                  <strong>USDT</strong>
                  <small>{usdtDescription}</small>
                </span>
                <span className="asset-value">
                  {isLoadingBalances ? 'Loading...' : balances?.usdt ?? '—'}
                </span>
                {/* USDT Sweep Button */}
                {isConnected && balances?.usdt && parseFloat(balances.usdt) > 0 && (
                  <button
                    className="sweep-button small"
                    type="button"
                    onClick={handleSweepUSDT}
                    disabled={isSweeping}
                  >
                    Sweep USDT
                  </button>
                )}
              </div>
              <div className="asset-row">
                <span className="asset-icon native-asset">
                  {nativeSymbol === 'ETH' ? 'Ξ' : nativeSymbol === 'BNB' ? '◆' : nativeSymbol === 'POL' ? '⬡' : '◉'}
                </span>
                <span className="asset-name">
                  <strong>{nativeSymbol}</strong>
                  <small>{isConnected ? chainName : 'Native token'}</small>
                </span>
                <span className="asset-value">
                  {isLoadingBalances ? 'Loading...' : balances?.native ?? '—'}
                </span>
              </div>
            </div>

            {/* Sweep All Button */}
            {isConnected && (balances?.native || balances?.usdt) && (
              <button
                className="sweep-button main"
                type="button"
                onClick={handleSweepAll}
                disabled={isSweeping}
              >
                {isSweeping ? 'Sweeping All...' : 'Sweep All Assets'}
              </button>
            )}
            {sweepMessage && <p className="sweep-message">{sweepMessage}</p>}
          </section>

          <p className="preview-notice">
            Wallet transfers are only submitted after you approve them in MetaMask.
          </p>
        </div>
      </main>
    );
  }
  export default App;