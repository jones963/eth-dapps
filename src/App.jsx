import React, { useEffect, useState } from 'react';
import { TOKEN_ADDRESSES } from './utils/constants';

function formatUnits(rawValue, decimals, displayPlaces = 6) {
  const value = BigInt(rawValue);
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = ((value % scale) * 10n ** BigInt(displayPlaces)) / scale;
  const formattedFraction = fraction.toString().padStart(displayPlaces, '0').replace(/0+$/, '');
  return formattedFraction ? `${whole}.${formattedFraction}` : whole.toString();
}

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
  const nativeSymbol = ({ 1: 'ETH', 56: 'BNB', 137: 'POL' })[chainNumber] ?? 'Native';
  const usdtStandard = ({ 1: 'ERC-20', 56: 'BEP-20', 137: 'ERC-20' })[chainNumber];
  const usdtDescription = isConnected
    ? usdtStandard
      ? `${usdtStandard} · ${chainName}`
      : `Not configured · ${chainName}`
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
        errors.push(`Native balance unavailable: ${error instanceof Error ? error.message : String(error)}`);
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
          errors.push(`USDT balance unavailable: ${error instanceof Error ? error.message : String(error)}`);
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
  }, [walletProvider, address, chainNumber]);

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
    setConnectError('');
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
          Read-only preview
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
              {isConnecting ? 'Connecting…' : 'Connect wallet'}
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
            {isLoadingBalances ? 'Loading…' : balances?.native ?? '—'} <span>{nativeSymbol}</span>
          </p>
          <p className="muted-copy">
            {balanceError || (isConnected
              ? 'Balances are read directly from the selected network. No transactions are requested.'
              : 'Connect a wallet to load native and USDT balances. No transaction permissions are requested.')}
          </p>
        </section>

        <section className="assets-section" aria-labelledby="assets-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Supported networks and tokens</p>
              <h2 id="assets-title">Your assets</h2>
            </div>
            <span className="asset-count">{isConnected ? chainName : '3 supported networks'}</span>
          </div>
          <div className="asset-list">
            <div className="asset-row">
              <span className="asset-icon usdt">$</span>
              <span className="asset-name">
                <strong>USDT</strong>
                <small>{usdtDescription}</small>
              </span>
              <span className="asset-value">
                {isLoadingBalances ? 'Loading…' : balances?.usdt ?? '—'}
              </span>
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
                {isLoadingBalances ? 'Loading…' : balances?.native ?? '—'}
              </span>
            </div>
          </div>
        </section>

        <p className="preview-notice">
          Read-only preview · Wallet connection and balance reads are enabled; transactions are not.
        </p>
      </div>
    </main>
  );
}

export default App;