# 此地有银三百两

一个基于 **Token Core WASM** 的 Sepolia 测试网网页钱包 Demo。

当前版本验证的是一个极简的“时间胶囊钱包”体验：用户在浏览器里生成一个本地钱包，向同一个 Sepolia 地址充值测试 ETH，然后创建定时提取订单。页面打开时，如果订单到期，会自动发起提现流程；用户完成 Passkey / WebAuthn 验证后，前端用 Token Core WASM 签名交易并广播到 Sepolia。

线上 Demo：<https://time-capsule-silver.vercel.app>

## 当前实现

- **唯一钱包**：点击“生成钱包”后，浏览器通过 `@consenlabs/tcx-wasm` 创建 TESTNET keystore，并派生一个 Sepolia 地址。
- **同地址充值**：页面展示同一个充值地址和二维码，用户向该地址充值 Sepolia ETH。
- **定时提取订单**：用户填写金额、目标地址、未来时间，生成一条本地订单。
- **冻结 / 可用展示**：页面按未完成订单金额计算冻结余额和可用余额，作为产品层面的提示。
- **每秒倒计时**：订单列表会按当前时间刷新倒计时。
- **到期自动触发**：页面处于打开状态时，订单到期会自动进入提现流程，不需要再手动点击一次。
- **Passkey / WebAuthn 确认**：如果当前浏览器成功创建了 Passkey，提现前会要求本人验证；如果环境不支持 Passkey，Demo 会降级继续运行。
- **Token Core WASM 签名**：验证通过后，前端用 `sign_tx` 签名 Sepolia ETH 转账，并通过 `eth_sendRawTransaction` 广播。
- **交易校验**：广播前会补齐 raw transaction 的 `0x` 前缀，并校验签名交易的 `from` 是否匹配当前钱包地址。
- **Toast 自动隐藏**：顶部提示会在 2 秒后自动消失，避免遮挡界面。

## 重要边界

当前版本是 **前端 Demo / 产品原型**，不是生产级合约金库。

- 没有智能合约托管资产。
- 没有链上强制锁仓。
- 没有实现每日生活费额度、最小/最大可提取额度或养老金周期释放。
- 订单记录保存在浏览器 `localStorage` 中。
- ETH 在同一个 EOA 地址里，链上不会区分“哪一笔充值属于哪一张订单”。
- “冻结 / 可用”是前端产品账本，不是链上强制余额隔离。
- “不可撤销”指当前 UI 不提供取消订单入口；它不是链上强制不可撤销。
- 页面必须打开并能访问 Sepolia RPC，才会检查到期订单并触发提现。
- 如果余额不足以覆盖订单金额和 gas，提现会失败并记录最后尝试时间，之后仍可再次尝试。

如果要实现真正不可绕过的锁仓、养老金式周期释放、每日生活费上限、继承/保险箱等能力，需要后续增加智能合约。

## 为什么使用一个钱包地址

这个 Demo 的设计目标是“一个用户 = 一个钱包”，避免把体验做成“每次埋银子都生成一个新地址”的批量地址工具。

产品关系是：

```text
唯一钱包：0xABC...
  订单 A：0.1 ETH，1 年后转给地址 X
  订单 B：0.5 ETH，10 年后转给地址 Y
  订单 C：0.02 ETH，30 天后转给地址 Z
```

用户每次想“埋一笔银子”，是创建一张定时提取订单；充值仍然进入同一个 Sepolia 钱包地址。

## Passkey 的作用

当前 Demo 中，Passkey 用于关键操作前的本人确认：

1. 生成钱包时尝试创建 Passkey；
2. 到期提现前尝试通过 Passkey 验证；
3. 验证通过后才执行 Token Core WASM 签名和广播。

注意：当前版本没有把助记词或 keystore 真正“存进 Passkey”。生产级版本更合适的方向是结合 WebAuthn PRF / hmac-secret，用 Passkey 派生稳定解密密钥，再解密本地或离线备份文件中的 keystore。

## 交易流程

```text
生成钱包
  ↓
得到唯一 Sepolia 地址
  ↓
向该地址充值测试 ETH
  ↓
创建定时提取订单：金额 + 目标地址 + 解锁时间
  ↓
订单进入冻结列表，倒计时每秒刷新
  ↓
页面打开且订单到期
  ↓
自动触发提现流程
  ↓
Passkey / WebAuthn 验证本人（支持时）
  ↓
Token Core WASM 签名 Sepolia 转账
  ↓
eth_sendRawTransaction 广播交易
  ↓
订单状态变为“已提取”并记录 txHash
```

## 技术栈

- React 19
- Vite 8
- TypeScript 6
- `@consenlabs/tcx-wasm`
- `ethers` v6
- WebAuthn / Passkey
- `qrcode`
- Sepolia RPC：`https://ethereum-sepolia-rpc.publicnode.com`

## 主要文件

```text
src/App.tsx                         主页面、钱包生成、订单、Passkey、签名转账逻辑
src/App.css                         页面样式
src/types.d.ts                      WASM 类型声明
public/this_place_has_silver.gif    项目 logo
scripts/portable.mjs                离线包打包脚本
```

## 本地运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## 生成离线包

```bash
npm run portable
```

输出文件：

```text
portable/time-capsule-silver-dist.zip
```

注意：当前 UI 里的“备份 / 离线包 / 重置”按钮因 Passkey 绑定域名暂时封印，离线包脚本主要用于开发和演示分发。

## 后续可扩展方向

这些功能目前没有放进当前版本：

- 每日/每月生活费额度；
- 养老金式周期释放；
- 超额提现等待期；
- 真正链上强制锁仓；
- 家庭保险箱 / 继承人机制；
- 多链资产支持。

它们更适合在下一版通过智能合约实现，而不是只靠前端本地订单约束。
