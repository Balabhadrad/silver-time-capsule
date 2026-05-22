import { useEffect, useMemo, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Copy, Download, EyeOff, Fingerprint, KeyRound, LockKeyhole, PackageOpen, Plus, RefreshCw, Send, ShieldCheck, Wallet, X } from 'lucide-react'
import { ethers } from 'ethers'
import './App.css'

type SilverOrder = {
  id: string
  amountEth: string
  recipient: string
  unlockAt: string
  createdAt: string
  txHash?: string
  lastAttempt?: string
  status: 'sealed' | 'sent'
}

type SilverVault = {
  address: string
  keystoreJson: string
  demoVaultKey: string
  credentialId?: string
  createdAt: string
  orders: SilverOrder[]
}

type TcxModule = typeof import('@consenlabs/tcx-wasm/tcx_wasm.js')

const STORAGE_KEY = 'silver300.vault.v3'
const OLD_STORAGE_KEYS = ['silver300.orders.v2', 'silver300.timeCapsule.v1']
const SEPOLIA_CHAIN_ID = 11155111
const RPC_URL = 'https://ethereum-sepolia-rpc.publicnode.com'
const GAS_LIMIT = 21_000n

function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromB64url(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

function randomToken(size = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(size)))
}

function short(address?: string) {
  if (!address) return '—'
  return `${address.slice(0, 8)}…${address.slice(-6)}`
}

function maskAddress(address: string) {
  return `${address.slice(0, 6)}••••••••••••••••••${address.slice(-4)}`
}

function formatEth(value: bigint) {
  return Number(ethers.formatEther(value)).toFixed(5)
}

function parseOrderEth(amountEth: string) {
  try { return ethers.parseEther(amountEth || '0') } catch { return 0n }
}

function formatCountdown(targetIso: string, nowMs: number) {
  const target = new Date(targetIso).getTime()
  const diff = Math.max(0, target - nowMs)
  if (diff <= 0) return '已到时间，可执行提现'
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  const year = 365 * day
  const years = Math.floor(diff / year)
  const days = Math.floor((diff % year) / day)
  const hours = Math.floor((diff % day) / hour)
  const minutes = Math.floor((diff % hour) / minute)
  const seconds = Math.floor((diff % minute) / 1000)
  if (years > 0) return `还剩 ${years} 年 ${days} 天 ${hours} 小时后执行提现`
  if (days > 0) return `还剩 ${days} 天 ${hours} 小时 ${minutes} 分后执行提现`
  if (hours > 0) return `还剩 ${hours} 小时 ${minutes} 分后执行提现`
  if (minutes > 0) return `还剩 ${minutes} 分 ${seconds} 秒后执行提现`
  return `还剩 ${seconds} 秒后执行提现`
}

function explainError(error: unknown) {
  if (error instanceof Error) return error.message
  try { return JSON.stringify(error) } catch { return String(error) }
}

function withHexPrefix(value: string) {
  const trimmed = value.trim()
  return trimmed.startsWith('0x') || trimmed.startsWith('0X') ? `0x${trimmed.slice(2)}` : `0x${trimmed}`
}

async function loadTcx(): Promise<TcxModule> {
  const tcx = await import('@consenlabs/tcx-wasm/tcx_wasm.js')
  await tcx.default()
  return tcx
}

async function createPasskey() {
  if (!('credentials' in navigator) || !window.PublicKeyCredential) return undefined
  const userId = crypto.getRandomValues(new Uint8Array(16))
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: '此地有银三百两' },
      user: { id: userId, name: 'silver-capsule@demo', displayName: 'Time Capsule Owner' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
      timeout: 60_000,
      attestation: 'none',
    },
  }) as PublicKeyCredential | null
  return credential ? b64url(new Uint8Array(credential.rawId)) : undefined
}

async function verifyPasskey(credentialId?: string) {
  if (!credentialId) return true
  await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ id: fromB64url(credentialId), type: 'public-key' }],
      userVerification: 'required',
      timeout: 60_000,
    },
  })
  return true
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return b64url(new Uint8Array(digest))
}

function loadVault(): SilverVault | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try { return JSON.parse(raw) as SilverVault } catch { return null }
}

function saveVault(vault: SilverVault) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vault))
}

function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function BuryLogo({ animated = false, className = '' }: { animated?: boolean; className?: string }) {
  return (
    <img
      className={`bury-logo gif-logo ${animated ? 'is-digging' : ''} ${className}`}
      src="/this_place_has_silver.gif"
      width="627"
      height="627"
      alt="此地有银三百两动态 logo"
      loading="eager"
      decoding="async"
    />
  )
}

function LoadingOverlay({ label }: { label: string }) {
  return (
    <div className="loading-backdrop">
      <div className="loading-card">
        <BuryLogo className="loading-logo" animated />
        <strong>{label}</strong>
        <span>嘘……银子正在下土</span>
      </div>
    </div>
  )
}
function ExplainerModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop">
      <section className="modal-card intro-modal">
        <BuryLogo className="modal-logo" animated />
        <h2>这是此地有银三百两</h2>
        <p>当其他钱包都在提醒你备份助记词，它的助记词却连你都防着。</p>
        <p>AI 飞速发展、到处都是安全漏洞的今天，黑客拿不到助记词，绑匪也拿不到。</p>
        <p>这里只能设置未来时间的提现，而且不可撤销。</p>
        <p className="slogan">此地有银三百两。为自己埋点养老金，为孩子存点压岁钱，再也不用拍断大腿高呼卖飞了。现在就为家人埋下一颗时间胶囊吧。</p>
        <button className="primary full" onClick={onClose}>进入钱包</button>
      </section>
    </div>
  )
}

function DepositModal({ address, qr, balanceText, onClose, onRefresh, onCopyAddress }: { address: string; qr: string; balanceText: string; onClose: () => void; onRefresh: () => void; onCopyAddress: () => void }) {
  return (
    <div className="modal-backdrop">
      <section className="modal-card deposit-modal">
        <button className="icon-button close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        <div className="modal-icon"><Wallet /></div>
        <h2>充值到唯一钱包</h2>
        <p>扫码或复制地址充值 Sepolia ETH。之后可以创建不可撤销的定时提取。</p>
        <div className="deposit-balance"><span>当前余额</span><b>{balanceText} ETH</b></div>
        {qr && <img className="qr big" src={qr} alt="Sepolia 充值二维码" />}
        <code>{address}</code>
        <div className="row-actions stretch">
          <button onClick={onCopyAddress}><Copy size={16} /> 复制地址</button>
          <button onClick={onRefresh}><RefreshCw size={16} /> 刷新余额</button>
        </div>
      </section>
    </div>
  )
}

function App() {
  const [vault, setVault] = useState<SilverVault | null>(() => loadVault())
  const [recipient, setRecipient] = useState('')
  const [amountEth, setAmountEth] = useState('0.01')
  const [unlockAt, setUnlockAt] = useState(() => new Date(Date.now() + 10 * 60_000).toISOString().slice(0, 16))
  const [balance, setBalance] = useState<bigint>(0n)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('欢迎回来')

  const [showModal, setShowModal] = useState(() => !localStorage.getItem('silver300.modal.ok'))
  const [showDeposit, setShowDeposit] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [loadingLabel, setLoadingLabel] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())
  const inFlightOrderIds = useRef(new Set<string>())
  const attemptedRef = useRef<Set<string>>(new Set())
  const provider = useMemo(() => new ethers.JsonRpcProvider(RPC_URL, SEPOLIA_CHAIN_ID), [])
  const orders = vault?.orders ?? []
  const frozenBalance = useMemo(() => orders.filter((order) => order.status !== 'sent').reduce((sum, order) => sum + parseOrderEth(order.amountEth), 0n), [orders])
  const availableBalance = balance > frozenBalance ? balance - frozenBalance : 0n
  const fundingGap = frozenBalance > balance ? frozenBalance - balance : 0n
  const depositUri = vault ? `ethereum:${vault.address}@${SEPOLIA_CHAIN_ID}` : ''

  // Auto-hide every toast after 2 seconds so it never blocks the wallet UI.
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2000)
    return () => window.clearTimeout(timer)
  }, [notice])

  function updateVault(next: SilverVault) {
    setVault(next)
    saveVault(next)
  }

  async function refreshBalance(address = vault?.address) {
    if (!address) return
    setBalance(await provider.getBalance(address))
  }

  async function copyText(text: string, message: string) {
    await navigator.clipboard.writeText(text)
    setNotice(message)
  }

  async function refreshBalanceWithLoading(address = vault?.address) {
    if (!address) return
    setLoadingLabel('正在挖开地看看余额')
    try {
      await refreshBalance(address)
      setNotice('余额已刷新')
    } finally {
      setLoadingLabel('')
    }
  }

  async function createVault(): Promise<SilverVault> {
    const tcx = await loadTcx()
    let credentialId: string | undefined
    try { credentialId = await createPasskey() } catch { credentialId = undefined }
    const demoVaultKey = randomToken(32)
    const keystoreJson = tcx.create_keystore(JSON.stringify({ password: demoVaultKey, network: 'TESTNET' }))
    const accounts = JSON.parse(tcx.derive_accounts(JSON.stringify({
      keystoreJson,
      key: demoVaultKey,
      derivations: [{ chain: 'ETHEREUM', derivationPath: "m/44'/60'/0'/0/0", chainId: String(SEPOLIA_CHAIN_ID), network: 'TESTNET' }],
    }))) as Array<{ address: string }>
    const address = accounts[0]?.address
    if (!address) throw new Error('Token Core 没有返回 Sepolia 地址')
    const next: SilverVault = { address, keystoreJson, demoVaultKey, credentialId, createdAt: new Date().toISOString(), orders: [] }
    updateVault(next)
    await refreshBalance(address)
    setNotice('银子埋好了')
    return next
  }

  async function handleCreateVault() {
    setBusy(true)
    setLoadingLabel('正在偷偷挖坑埋银子')
    try {
      await createVault()
    } catch (error) {
      setNotice(explainError(error))
    } finally {
      setLoadingLabel('')
      setBusy(false)
    }
  }

  async function createOrder() {
    if (!ethers.isAddress(recipient)) {
      setNotice('请填写有效的 Sepolia 提取地址')
      return
    }
    if (new Date(unlockAt).getTime() <= Date.now()) {
      setNotice('提取时间必须在未来')
      return
    }
    const parsedAmount = parseOrderEth(amountEth)
    if (parsedAmount <= 0n) {
      setNotice('请填写冻结金额')
      return
    }
    if (balance < frozenBalance + parsedAmount) {
      setNotice(`余额不够，不能生成订单。还差 ${formatEth(frozenBalance + parsedAmount - balance)} ETH`)
      return
    }
    setBusy(true)
    try {
      if (!vault) {
        setNotice('请先生成唯一钱包')
        return
      }
      const nextOrder: SilverOrder = {
        id: crypto.randomUUID(),
        amountEth,
        recipient,
        unlockAt: new Date(unlockAt).toISOString(),
        createdAt: new Date().toISOString(),
        status: 'sealed',
      }
      const next = { ...vault, orders: [nextOrder, ...vault.orders] }
      updateVault(next)
      setRecipient('')
      setNotice('已冻结：到点自动提取，不可撤销')
      await refreshBalance(next.address)
    } catch (error) {
      setNotice(explainError(error))
    } finally {
      setBusy(false)
    }
  }

  async function attemptTransfer(order: SilverOrder) {
    if (!vault) return
    const isMature = Date.now() >= new Date(order.unlockAt).getTime()
    if (!isMature) {
      setNotice('未到时间，不能撤销')
      return
    }
    if (inFlightOrderIds.current.has(order.id)) return
    inFlightOrderIds.current.add(order.id)
    setBusy(true)
    try {
      await verifyPasskey(vault.credentialId)
      const tcx = await loadTcx()
      const currentBalance = await provider.getBalance(vault.address)
      const fee = await provider.getFeeData()
      const gasPrice = fee.gasPrice ?? ethers.parseUnits('2', 'gwei')
      const cost = gasPrice * GAS_LIMIT
      const value = ethers.parseEther(order.amountEth || '0')
      if (currentBalance <= cost || currentBalance < value + cost) {
        setNotice('余额不足，待下次再执行')
        return
      }
      const nonce = await provider.getTransactionCount(vault.address, 'pending')
      const signed = JSON.parse(tcx.sign_tx(JSON.stringify({
        keystoreJson: vault.keystoreJson,
        key: vault.demoVaultKey,
        chain: 'ETHEREUM',
        derivationPath: "m/44'/60'/0'/0/0",
        input: { nonce: String(nonce), gasPrice: String(gasPrice), gasLimit: String(GAS_LIMIT), to: order.recipient, value: String(value), chainId: String(SEPOLIA_CHAIN_ID) },
      }))) as { signature: string; txHash?: string }
      const rawTx = withHexPrefix(signed.signature)
      if (!rawTx.startsWith('0x')) throw new Error('签名交易缺少 0x 前缀')
      const parsedTx = ethers.Transaction.from(rawTx)
      if (parsedTx.from && parsedTx.from.toLowerCase() !== vault.address.toLowerCase()) {
        throw new Error(`签名地址不匹配：${short(parsedTx.from)} ≠ ${short(vault.address)}`)
      }
      const txHash = await provider.send('eth_sendRawTransaction', [rawTx]) as string
      const next = { ...vault, orders: vault.orders.map((item) => item.id === order.id ? { ...item, txHash, lastAttempt: new Date().toISOString(), status: 'sent' as const } : item) }
      updateVault(next)
      setNotice(`已提取：${txHash}`)
      await refreshBalance(vault.address)
    } catch (error) {
      const next = { ...vault, orders: vault.orders.map((item) => item.id === order.id ? { ...item, lastAttempt: new Date().toISOString() } : item) }
      updateVault(next)
      setNotice(`提取未完成：${explainError(error)}`)
    } finally {
      inFlightOrderIds.current.delete(order.id)
      setBusy(false)
    }
  }

  async function exportBackup() {
    if (!vault) {
      setNotice('还没有钱包可以备份')
      return
    }
    setBusy(true)
    try {
      await verifyPasskey(vault.credentialId)
      const payload = { app: '此地有银三百两', version: 5, network: 'sepolia', exportedAt: new Date().toISOString(), vault }
      const fingerprint = await sha256(JSON.stringify(payload))
      downloadJson(`silver300-backup-${new Date().toISOString().slice(0, 10)}.json`, { ...payload, fingerprint })
      setNotice('备份已导出')
    } catch (error) {
      setNotice(`备份取消：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }

  function resetDemo() {
    localStorage.removeItem(STORAGE_KEY)
    OLD_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key))
    setVault(null)
    setBalance(0n)
    setNotice('已清空')
  }

  useEffect(() => { if (vault?.address) refreshBalance(vault.address) }, [])
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    for (const order of orders) {
      const mature = nowMs >= new Date(order.unlockAt).getTime()
      if (order.status === 'sent' || !mature || attemptedRef.current.has(order.id)) continue
      attemptedRef.current.add(order.id)
      void attemptTransfer(order)
    }
  }, [orders, nowMs])
  useEffect(() => {
    if (!depositUri) {
      setQrDataUrl('')
      return
    }
    QRCode.toDataURL(depositUri, { width: 520, margin: 1, color: { dark: '#0b1d33', light: '#ffffff' } }).then(setQrDataUrl).catch(() => setQrDataUrl(''))
  }, [depositUri])

  return (
    <main>
      {notice && <section className="top-toast">{notice}</section>}
      {loadingLabel && <LoadingOverlay label={loadingLabel} />}
      {showModal && <ExplainerModal onClose={() => { localStorage.setItem('silver300.modal.ok', '1'); setShowModal(false) }} />}
      {showDeposit && vault && <DepositModal address={vault.address} qr={qrDataUrl} balanceText={formatEth(balance)} onClose={() => setShowDeposit(false)} onRefresh={() => refreshBalanceWithLoading(vault.address)} onCopyAddress={() => copyText(vault.address, '地址已复制')} />}

      <section className="hero compact-hero">
        <div className="brand"><BuryLogo animated /> 此地有银三百两</div>
        <h1>此地有银三百两</h1>
        <p>所有人都看不到助记词。这个钱包只允许预设定未来的提现。不可撤销。</p>
      </section>

      <section className="card wallet-card">
        <div className="wallet-top">
          <div className="orb"><LockKeyhole /></div>
          <div>
            <p className="eyebrow">唯一钱包</p>
            <h2>{vault ? short(vault.address) : '未生成'}</h2>
          </div>
        </div>
        <div className="balance-row">
          <div><span>总余额</span><b>{formatEth(balance)}</b></div>
          <div><span>冻结</span><b>{formatEth(frozenBalance)}</b></div>
          <div><span>可用</span><b>{formatEth(availableBalance)}</b></div>
        </div>
        {fundingGap > 0n && <p className="gap-line">还需充值 {formatEth(fundingGap)} ETH</p>}
        {!vault ? (
          <button className="primary full" onClick={handleCreateVault} disabled={busy}><KeyRound /> 生成钱包</button>
        ) : (
          <div className="action-grid">
            <button className="primary" onClick={() => setShowDeposit(true)}><Wallet /> 充值</button>
            <button onClick={() => refreshBalanceWithLoading(vault.address)}><RefreshCw /> 刷新</button>
          </div>
        )}
      </section>

      {vault && <section className="card form-card simple-form">
        <h2><Plus /> 定时提取</h2>
        <input value={amountEth} onChange={(e) => setAmountEth(e.target.value)} placeholder="金额 ETH" inputMode="decimal" />
        <input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="未来提取地址 0x..." />
        <input type="datetime-local" value={unlockAt} onChange={(e) => setUnlockAt(e.target.value)} />
        <button className="primary full" onClick={createOrder} disabled={busy}><Fingerprint /> 冻结并定时提取</button>
      </section>}

      <section className="grid orders">
        {orders.map((order) => {
          const mature = nowMs >= new Date(order.unlockAt).getTime()
          const countdown = formatCountdown(order.unlockAt, nowMs)
          return (
            <article className="card order" key={order.id}>
              <div className="order-head">
                <div>
                  <p className="eyebrow">#{order.id.slice(0, 8)}</p>
                  <h2>{order.amountEth} ETH</h2>
                </div>
                <span className={order.status === 'sent' ? 'pill ok-bg' : mature ? 'pill warn-bg' : 'pill'}>{order.status === 'sent' ? '已提取' : mature ? '可执行' : '冻结中'}</span>
              </div>
              <h3 className="break"><EyeOff size={15} /> {maskAddress(order.recipient)}</h3>
              <div className="mini-grid">
                <div><span>时间</span><b>{new Date(order.unlockAt).toLocaleString()}</b></div>
                <div><span>倒计时</span><b>{order.status === 'sent' ? '已完成' : countdown}</b></div>
              </div>
              <p className="rule-line">不可撤销。到点后会自动唤起 Passkey 验证，通过后广播 Sepolia 提现交易。</p>
              <button className="primary full" onClick={() => attemptTransfer(order)} disabled={busy || order.status === 'sent' || !mature}><Send /> {mature ? '再次执行提现' : countdown}</button>
            </article>
          )
        })}
      </section>

      {vault && <div className="utility-bar disabled-tools">
        <button onClick={exportBackup} disabled title="Passkey 绑定域名，暂不开放"><Download /> 备份</button>
        <button onClick={() => setNotice('Passkey 绑定域名，离线包先封印')} disabled title="Passkey 绑定域名，暂不开放"><PackageOpen /> 离线包</button>
        <button onClick={resetDemo} disabled title="Passkey 绑定域名，暂不开放"><ShieldCheck /> 重置</button>
        <small>Passkey 绑定域名，这些功能先封印。</small>
      </div>}

    </main>
  )
}

export default App
