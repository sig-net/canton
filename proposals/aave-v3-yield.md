# Aave V3 Yield — Supply & Withdraw via MPC Vault

## Overview

Extend the vault to **supply ERC-20 tokens to Aave V3** on Sepolia, earning
yield on deposited assets. The user's `Erc20Holding` for the underlying token
(e.g., USDC) is consumed, the vault supplies to Aave and wraps into
**stataUSDC** (Aave's ERC-4626 static aToken), and a new `Erc20Holding` for
the shares token is created on Canton. Later, the user can redeem shares
back into underlying tokens (including accrued yield).

**Why Aave V3:** best testnet coverage on Sepolia — fully deployed, faucet
available, 9 assets supported. StataToken (ERC-4626 wrapper) is deployed on
Sepolia, giving us shares-based yield tracking.

## Design Decisions

### Per-User Derived Addresses (not shared root)

Each Canton user already has their own derived Ethereum address via the MPC
path mechanism (`path = "{sender},{userPath}"`). Instead of pooling all
tokens into a single vault root address, each user's derived address
interacts with Aave independently:

```
Alice: path = "Alice,deposit-1" → 0xABC...  (unique ETH address)
Bob:   path = "Bob,deposit-1"   → 0xDEF...  (unique ETH address)

Alice's 0xABC → supply 100 USDC → Aave tracks balanceOf(0xABC) independently
Bob's   0xDEF → supply 200 USDC → Aave tracks balanceOf(0xDEF) independently
```

**Why:** Aave tracks one balance per address. Sharing a single EOA would
require pro-rata yield accounting on Canton. Per-user addresses give natural
isolation — each user's yield is theirs, no shared balance math needed.

### Shares Model (stataUSDC, not aUSDC)

DeFi yield tokens use one of three fundamental models:

| Model                                           | Balance           | Price         | Canton-friendly?                      |
| ----------------------------------------------- | ----------------- | ------------- | ------------------------------------- |
| **Rebasing** (aUSDC, stETH)                     | Changes over time | Stays ~pegged | No — `Erc20Holding.amount` goes stale |
| **Shares / ERC-4626** (stataUSDC, wstETH, sDAI) | Fixed             | Grows         | Yes — amount is always correct        |
| **Claimable** (CRV gauges, COMP)                | Fixed             | Fixed         | Needs separate claim choice           |

We use **stataUSDC** (Aave's ERC-4626 static aToken wrapper):

- Balance stays constant — `Erc20Holding.amount` is always correct
- Yield accrues in the exchange rate, not the balance
- Standard ERC-20 — composable with Uniswap, Morpho, etc.
- Uniswap V3/V4 explicitly does not support rebasing tokens (yield is lost)

**No new templates needed.** `Erc20Holding` tracks both USDC and stataUSDC
— they're both ERC-20 tokens.

### StaticATokenLM (V1) — ERC-4626 Wrapper on Sepolia

Sepolia deploys the V1 `StaticATokenLM` (from `bgd-labs/static-a-token-v3`),
not the newer `StataTokenV2`. V1 wraps Aave's rebasing aTokens into
non-rebasing ERC-4626 shares with explicit `depositToAave`/`withdrawFromAave`
booleans.

Key functions:

- `deposit(uint256, address, uint16, bool) → uint256` — when
  `depositToAave = true`: takes raw USDC, supplies to Aave internally,
  mints shares. When `false`: takes aUSDC directly.
- `redeem(uint256, address, address, bool) → uint256` — when
  `withdrawFromAave = true`: burns shares, withdraws from Aave, returns raw
  USDC. When `false`: returns aUSDC.
- `rate()` — returns current exchange rate
- `aToken()` — returns the underlying aToken address
- `convertToAssets(shares)` — returns current USDC value including yield
- `claimRewards()` — claim Aave liquidity mining incentives
- No protocol fee for wrapping/unwrapping

**V2 note:** Mainnet uses `StataTokenV2` (from `aave-dao/aave-v3-origin`)
where the standard ERC-4626 `deposit(uint256, address)` handles raw
underlying directly (no boolean needed). If Sepolia is upgraded to V2 in
the future, switch to the 2-arg signatures.

## Sepolia Addresses

| Contract          | Address                                                  |
| ----------------- | -------------------------------------------------------- |
| Aave V3 Pool      | `0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951`             |
| USDC (test)       | `0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8`             |
| aUSDC (aToken)    | `0x16dA4541aD1807f4443d92D26044C1147406EB80`             |
| StataTokenFactory | `0xd210dFB43B694430B8d31762B5199e30c31266C8` (V1 legacy) |
| stataUSDC         | `0x8A88124522dbBF1E56352ba3DE1d9F78C143751e`             |
| stataDAI          | `0xDE46e43F46ff74A23a65EBb0580cbe3dFE684a17`             |
| stataWETH         | `0x162B500569F42D9eCe937e6a61EDfef660A12E98`             |
| Aave Faucet       | `0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D`             |

**Sepolia deploys V1 (`StaticATokenLM`), not V2 (`StataTokenV2`).** The
function signatures differ — V1 uses 4-arg `deposit`/`redeem` with a
`depositToAave`/`withdrawFromAave` boolean. See EVM Functions below.
Factory lookup: `getStaticAToken(underlying)` (NOT `getStataToken`).

## Sequence Diagram

### Approve (one-time setup)

```
 User                           Canton (VaultOrchestrator)     MPC Service                    Sepolia
 |                              |                              |                              |
 | (user already has Erc20Holding(USDC) from prior deposit)    |                              |
 |                              |                              |                              |
 | 1. RequestEvmApprove         |                              |                              |
 |    (USDC, stataToken, max)   |                              |                              |
 |----------------------------->|                              |                              |
 |                              | creates PendingEvmTx         |                              |
 |                              |   approve(stataToken, max)   |                              |
 |                              |----------------------------->|                              |
 |                              |                              | derive child key (user path) |
 |                              |                              | sign approve tx              |
 |                              |                              |----------------------------->|
 |                              |                              |       USDC.approve(stata,max)|
 |                              |                              |<-----------------------------|
 |                              | SignEvmTx                    |                              |
 |                              |<----- EcdsaSignature --------|                              |
 |                              |                              | re-simulate, extract output  |
 |                              | ProvideEvmOutcomeSig         |                              |
 |                              |<-- EvmTxOutcomeSignature ----|                              |
 |                              |                              |                              |
 | 2. ClaimEvmApprove           |                              |                              |
 |----------------------------->|                              |                              |
 |                              | verify MPC signature         |                              |
 |                              | decode bool (approve=true)   |                              |
 |                              | archive pending + sigs       |                              |
 |                              |                              |                              |
```

### Supply (USDC → stataUSDC)

```
 User                           Canton (VaultOrchestrator)     MPC Service                    Sepolia
 |                              |                              |                              |
 | 3. RequestAaveSupply         |                              |                              |
 |    (holdingCid, stataToken)  |                              |                              |
 |----------------------------->|                              |                              |
 |                              | fetch + archive              |                              |
 |                              |   Erc20Holding(USDC)         |                              |
 |                              | creates PendingEvmTx         |                              |
 |                              |   deposit(amt,addr,0,true)   |                              |
 |                              |----------------------------->|                              |
 |                              |                              | derive child key (user path) |
 |                              |                              | sign deposit tx              |
 |                              |                              |----------------------------->|
 |                              |                              |   stataToken.deposit(...)    |
 |                              |                              |     USDC → Pool.supply()     |
 |                              |                              |     aUSDC → wrap → stataUSDC |
 |                              |                              |<-----------------------------|
 |                              | SignEvmTx                    |                              |
 |                              |<----- EcdsaSignature --------|                              |
 |                              |                              | re-simulate, extract shares  |
 |                              | ProvideEvmOutcomeSig         |                              |
 |                              |<-- EvmTxOutcomeSignature ----|                              |
 |                              |     (mpcOutput = sharesOut)  |                              |
 |                              |                              |                              |
 | 4. ClaimAaveSupply           |                              |                              |
 |----------------------------->|                              |                              |
 |                              | verify MPC signature         |                              |
 |                              | decode uint256 sharesOut     |                              |
 |                              | create Erc20Holding          |                              |
 |                              |   (stataUSDC, sharesOut)     |                              |
 |<---- Erc20Holding(stataUSDC) |                              |                              |
 |                              |                              |                              |
 :   ... time passes ...        :                              :                              :
 :   stataUSDC balance unchanged:                              :                              :
 :   exchange rate grows (yield):                              :                              :
 |                              |                              |                              |
```

### Withdraw (stataUSDC → USDC + yield)

```
 User                           Canton (VaultOrchestrator)     MPC Service                    Sepolia
 |                              |                              |                              |
 | 5. RequestAaveWithdraw       |                              |                              |
 |    (holdingCid)              |                              |                              |
 |----------------------------->|                              |                              |
 |                              | fetch + archive              |                              |
 |                              |   Erc20Holding(stataUSDC)    |                              |
 |                              | creates PendingEvmTx         |                              |
 |                              |   redeem(shares,addr,addr,T) |                              |
 |                              |----------------------------->|                              |
 |                              |                              | derive child key (user path) |
 |                              |                              | sign redeem tx               |
 |                              |                              |----------------------------->|
 |                              |                              |   stataToken.redeem(...)     |
 |                              |                              |     burn stataUSDC → aUSDC   |
 |                              |                              |     Pool.withdraw() → USDC   |
 |                              |                              |     (includes accrued yield) |
 |                              |                              |<-----------------------------|
 |                              | SignEvmTx                    |                              |
 |                              |<----- EcdsaSignature --------|                              |
 |                              |                              | re-simulate, extract assets  |
 |                              | ProvideEvmOutcomeSig         |                              |
 |                              |<-- EvmTxOutcomeSignature ----|                              |
 |                              |     (mpcOutput = assetsOut)  |                              |
 |                              |                              |                              |
 | 6. CompleteAaveWithdraw      |                              |                              |
 |----------------------------->|                              |                              |
 |                              | verify MPC signature         |                              |
 |                              | decode uint256 assetsOut     |                              |
 |                              | create Erc20Holding          |                              |
 |                              |   (USDC, assetsOut)          |                              |
 |                              |   assetsOut >= original amt  |                              |
 |<---- Erc20Holding(USDC) ----|   (yield accrued!)           |                              |
 |                              |                              |                              |
```

## EVM Functions

### 1. ERC-20 `approve` (one-time per token/spender)

```
function approve(address spender, uint256 amount) returns (bool)
selector: 0x095ea7b3
```

**EvmTransactionParams:**

| Field               | Value                                                                            |
| ------------------- | -------------------------------------------------------------------------------- |
| `to`                | USDC token address                                                               |
| `functionSignature` | `"approve(address,uint256)"`                                                     |
| `args[0]`           | stataToken address, left-padded to 32 bytes                                      |
| `args[1]`           | `ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff` (max uint256) |
| `value`             | `00..00` (32 bytes zero)                                                         |

**Schema:** `outputDeserializationSchema = [{"name":"","type":"bool"}]`
**Schema:** `respondSerializationSchema = [{"name":"","type":"bool"}]`

### 2. StaticATokenLM `deposit` — V1 (USDC → stataUSDC)

```
function deposit(uint256 assets, address receiver, uint16 referralCode, bool depositToAave)
    returns (uint256 shares)
```

With `depositToAave = true`, the contract:

1. Pulls USDC from caller via `transferFrom`
2. Calls `Pool.supply(USDC, amount, address(this), referralCode)` internally
3. Wraps the resulting aUSDC into stataUSDC shares
4. Mints shares to `receiver`

**EvmTransactionParams:**

| Field               | Value                                                             |
| ------------------- | ----------------------------------------------------------------- |
| `to`                | `8a88124522dbbf1e56352ba3de1d9f78c143751e` (stataUSDC on Sepolia) |
| `functionSignature` | `"deposit(uint256,address,uint16,bool)"`                          |
| `args[0]`           | amount of USDC, left-padded to 32 bytes                           |
| `args[1]`           | receiver = user's derived address, left-padded                    |
| `args[2]`           | `00..00` (referralCode = 0)                                       |
| `args[3]`           | `00..01` (depositToAave = true)                                   |
| `value`             | `00..00` (32 bytes zero)                                          |

**Schema:** `outputDeserializationSchema = [{"name":"shares","type":"uint256"}]`
**Schema:** `respondSerializationSchema = [{"name":"shares","type":"uint256"}]`

### 3. StaticATokenLM `redeem` — V1 (stataUSDC → USDC + yield)

```
function redeem(uint256 shares, address receiver, address owner, bool withdrawFromAave)
    returns (uint256 assets)
```

With `withdrawFromAave = true`, the contract burns shares, calls
`Pool.withdraw()` internally, and returns raw USDC. No separate step.

**EvmTransactionParams:**

| Field               | Value                                                             |
| ------------------- | ----------------------------------------------------------------- |
| `to`                | `8a88124522dbbf1e56352ba3de1d9f78c143751e` (stataUSDC on Sepolia) |
| `functionSignature` | `"redeem(uint256,address,address,bool)"`                          |
| `args[0]`           | shares amount (= `Erc20Holding.amount`), 32 bytes                 |
| `args[1]`           | receiver = user's derived address, left-padded                    |
| `args[2]`           | owner = user's derived address, left-padded                       |
| `args[3]`           | `00..01` (withdrawFromAave = true)                                |
| `value`             | `00..00` (32 bytes zero)                                          |

**Schema:** `outputDeserializationSchema = [{"name":"assets","type":"uint256"}]`
**Schema:** `respondSerializationSchema = [{"name":"assets","type":"uint256"}]`

### Transaction Count Summary

| Operation                             | EVM Transactions | Details                                       |
| ------------------------------------- | ---------------- | --------------------------------------------- |
| Approve (one-time)                    | 1                | `USDC.approve(stataToken, max)`               |
| Supply                                | 1                | `stataToken.deposit(amount, addr, 0, true)`   |
| Withdraw                              | 1                | `stataToken.redeem(shares, addr, addr, true)` |
| **Total for supply + withdraw cycle** | **3**            | (approve is one-time)                         |

## Daml Contract Changes

### New TxSource Variants

```daml
data TxSource
  = DepositSource (ContractId DepositAuthorization)
  | WithdrawalSource (ContractId Erc20Holding)
  | ApproveSource                                    -- NEW
  | AaveSupplySource (ContractId Erc20Holding)       -- NEW
  | AaveWithdrawSource (ContractId Erc20Holding)     -- NEW (stataUSDC holding)
```

No `AavePosition` template. Both USDC and stataUSDC are tracked as
`Erc20Holding` with different `erc20Address` addresses.

### New Choices on VaultOrchestrator

#### RequestEvmApprove (nonconsuming, issuer-controlled)

Generic ERC-20 approval — reusable across Aave, Uniswap, and future
protocol integrations.

```daml
nonconsuming choice RequestEvmApprove : ContractId PendingEvmTx
  with
    token   : BytesHex    -- ERC-20 contract address
    spender : BytesHex    -- protocol contract to approve
    evmParams : EvmTransactionParams
  controller issuer
  do
    assertMsg "must be approve" $
      evmParams.functionSignature == "approve(address,uint256)"
    assertMsg "to must be token" $
      evmParams.to == token

    let requestPath = "root"
        predecessorId = vaultId <> show issuer
        requestId = computeRequestId
          (show issuer) evmParams caip2Id keyVersion
          requestPath algo (show spender) ""

    create PendingEvmTx with
      source = ApproveSource
      path = requestPath
      nonceCidText = ""
      outputDeserializationSchema = "[{\"name\":\"\",\"type\":\"bool\"}]"
      respondSerializationSchema = "[{\"name\":\"\",\"type\":\"bool\"}]"
      ..
```

#### ClaimEvmApprove (nonconsuming)

```daml
nonconsuming choice ClaimEvmApprove : ()
  with
    requester    : Party
    pendingCid   : ContractId PendingEvmTx
    outcomeCid   : ContractId EvmTxOutcomeSignature
    signatureCid : ContractId EcdsaSignature
  controller requester
  do
    pending <- fetch pendingCid
    outcome <- fetch outcomeCid

    assertMsg "requestId mismatch" $ pending.requestId == outcome.requestId
    let responseHash = computeResponseHash pending.requestId outcome.mpcOutput
    assertMsg "invalid MPC signature" $
      verifyEcdsaSignature mpcPublicKey responseHash outcome.signature

    assertMsg "approve failed" $ not (hasErrorPrefix outcome.mpcOutput)
    let decoded = abiDecodeBool outcome.mpcOutput 0
    assertMsg "approve returned false" decoded

    archive pendingCid
    archive outcomeCid
    archive signatureCid
```

#### RequestAaveSupply (nonconsuming)

Uses the user's deposit path (not "root") so each user has their own Aave
position via their derived address.

```daml
nonconsuming choice RequestAaveSupply : ContractId PendingEvmTx
  with
    requester     : Party
    holdingCid    : ContractId Erc20Holding
    stataToken    : BytesHex   -- stataUSDC contract address
    evmParams     : EvmTransactionParams
  controller requester
  do
    holding <- fetch holdingCid

    assertMsg "owner mismatch" $ holding.owner == requester
    assertMsg "issuer mismatch" $ holding.issuer == issuer
    assertMsg "must be deposit" $
      evmParams.functionSignature == "deposit(uint256,address,uint16,bool)"
    assertMsg "to must be stataToken" $ evmParams.to == stataToken

    -- validate amount matches holding
    let argsAmount = evmParams.args !! 0
    assertMsg "amount must match holding" $
      argsAmount == holding.amount

    archive holdingCid

    -- use the user's deposit path (per-user derived address)
    let requestPath = show requester <> "," <> "aave-supply"
        predecessorId = vaultId <> show issuer
        nonceCidText = show holdingCid
        requestId = computeRequestId
          (show requester) evmParams caip2Id keyVersion
          requestPath algo (show stataToken) nonceCidText

    create PendingEvmTx with
      source = AaveSupplySource holdingCid
      path = requestPath
      outputDeserializationSchema =
        "[{\"name\":\"shares\",\"type\":\"uint256\"}]"
      respondSerializationSchema =
        "[{\"name\":\"shares\",\"type\":\"uint256\"}]"
      ..
```

#### ClaimAaveSupply (nonconsuming)

Creates `Erc20Holding(stataUSDC, sharesAmount)` — balance stays correct
forever since shares don't rebase.

```daml
nonconsuming choice ClaimAaveSupply : ContractId Erc20Holding
  with
    requester    : Party
    pendingCid   : ContractId PendingEvmTx
    outcomeCid   : ContractId EvmTxOutcomeSignature
    signatureCid : ContractId EcdsaSignature
  controller requester
  do
    pending <- fetch pendingCid
    outcome <- fetch outcomeCid

    assertMsg "requestId mismatch" $ pending.requestId == outcome.requestId
    let responseHash = computeResponseHash pending.requestId outcome.mpcOutput
    assertMsg "invalid MPC signature" $
      verifyEcdsaSignature mpcPublicKey responseHash outcome.signature

    assertMsg "supply failed" $ not (hasErrorPrefix outcome.mpcOutput)

    -- decode shares minted (ERC-4626 deposit returns uint256 shares)
    let sharesOut = abiSlot outcome.mpcOutput 0
        stataToken = pending.evmParams.to

    archive pendingCid
    archive outcomeCid
    archive signatureCid

    create Erc20Holding with
      owner = requester
      amount = sharesOut           -- shares, not underlying — never stale
      erc20Address = stataToken   -- stataUSDC address
      ..
```

#### RequestAaveWithdraw (nonconsuming)

Consumes `Erc20Holding(stataUSDC)`, redeems all shares.

```daml
nonconsuming choice RequestAaveWithdraw : ContractId PendingEvmTx
  with
    requester   : Party
    holdingCid  : ContractId Erc20Holding
    evmParams   : EvmTransactionParams
  controller requester
  do
    holding <- fetch holdingCid

    assertMsg "owner mismatch" $ holding.owner == requester
    assertMsg "must be redeem" $
      evmParams.functionSignature == "redeem(uint256,address,address,bool)"

    -- validate shares amount matches holding
    let argsShares = evmParams.args !! 0
    assertMsg "shares must match holding" $
      argsShares == holding.amount

    archive holdingCid

    let requestPath = show requester <> "," <> "aave-supply"
        nonceCidText = show holdingCid
        stataToken = evmParams.to
        requestId = computeRequestId
          (show requester) evmParams caip2Id keyVersion
          requestPath algo (show stataToken) nonceCidText

    create PendingEvmTx with
      source = AaveWithdrawSource holdingCid
      path = requestPath
      outputDeserializationSchema =
        "[{\"name\":\"assets\",\"type\":\"uint256\"}]"
      respondSerializationSchema =
        "[{\"name\":\"assets\",\"type\":\"uint256\"}]"
      ..
```

#### CompleteAaveWithdraw (nonconsuming)

```daml
nonconsuming choice CompleteAaveWithdraw
    : Optional (ContractId Erc20Holding)
  with
    requester    : Party
    underlying   : BytesHex   -- USDC contract address
    pendingCid   : ContractId PendingEvmTx
    outcomeCid   : ContractId EvmTxOutcomeSignature
    signatureCid : ContractId EcdsaSignature
  controller requester
  do
    pending <- fetch pendingCid
    outcome <- fetch outcomeCid

    assertMsg "requestId mismatch" $ pending.requestId == outcome.requestId
    let responseHash = computeResponseHash pending.requestId outcome.mpcOutput
    assertMsg "invalid MPC signature" $
      verifyEcdsaSignature mpcPublicKey responseHash outcome.signature

    archive pendingCid
    archive outcomeCid
    archive signatureCid

    if hasErrorPrefix outcome.mpcOutput then
      pure None  -- redeem failed, no refund (shares already burned on-chain)
    else do
      -- decode actual assets returned (underlying + yield)
      let assetsOut = abiSlot outcome.mpcOutput 0

      holdingCid <- create Erc20Holding with
        owner = requester
        amount = assetsOut          -- includes accrued yield
        erc20Address = underlying  -- back to USDC
        ..
      pure (Some holdingCid)
```

## MPC Service Changes

**None.** The existing MPC service pipeline is fully generic — it processes
any `PendingEvmTx` regardless of function signature. The path-based key
derivation already works for per-user addresses.

## Composability

Because stataUSDC is a standard ERC-20 with constant balance, the user can:

1. Deposit USDC → `Erc20Holding(USDC)`
2. Supply to Aave → `Erc20Holding(stataUSDC)` (shares, balance never stale)
3. **Swap stataUSDC on Uniswap** → `Erc20Holding(WETH)` (see uniswap-v3-swap.md)
4. Redeem stataUSDC → `Erc20Holding(USDC + yield)`

This would NOT work with raw aUSDC — Uniswap V3/V4 explicitly does not
support rebasing tokens and yield would be permanently lost.

## E2E Test Plan

### Test: `aave-supply-e2e.test.ts`

**Setup (beforeAll, 60s):**

1. `setupVault()` — allocate parties, upload DAR, create VaultOrchestrator
2. Fund user's derived address with test USDC from Aave faucet
3. Start MPC server
4. Execute `RequestEvmApprove` for USDC → stataToken (max uint256)
5. Wait for MPC to sign + submit approve tx
6. Exercise `ClaimEvmApprove`

**Test 1: Supply USDC to Aave via stataToken (300s):**

1. Create `Erc20Holding(USDC)` via standard deposit flow
2. Build `EvmTransactionParams` for `stataToken.deposit(amount, addr, 0, true)`
3. Exercise `RequestAaveSupply` with holding
4. Wait for MPC to sign + submit deposit tx
5. Exercise `ClaimAaveSupply`
6. Assert: `Erc20Holding(stataUSDC)` created with shares > 0
7. Assert: `erc20Address` == stataToken address
8. Verify on Sepolia: user's derived address has stataUSDC balance > 0

**Test 2: Withdraw from Aave with yield (300s):**

1. Wait a few blocks (yield accrues in exchange rate)
2. Query `stataToken.convertToAssets(shares)` — should be > original USDC
3. Exercise `RequestAaveWithdraw` with stataUSDC holding
4. Wait for MPC to sign + submit redeem tx
5. Exercise `CompleteAaveWithdraw`
6. Assert: new `Erc20Holding(USDC)` created
7. Assert: `amount >= original supply amount` (yield accrued)
8. Verify on Sepolia: stataUSDC balance == 0, USDC balance restored + yield

### Env Variables (additions)

```
AAVE_POOL_ADDRESS=0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951
AAVE_FAUCET_ADDRESS=0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D
STATA_USDC_ADDRESS=0x8A88124522dbBF1E56352ba3DE1d9F78C143751e
```

## Open Concern: Untracked ERC-20 Approvals

### The Problem

The current `RequestEvmApprove` / `ClaimEvmApprove` flow signs and submits
an `approve()` transaction but **does not create any Canton contract to
record that the approval exists**. After `ClaimEvmApprove` archives the
pending tx and signatures, Canton has no record that the user's derived
address has granted spending permission to a DeFi protocol.

### The Core Attack: Phantom Holdings

ERC-20 `approve(spender, amount)` grants the `spender` the ability to call
`transferFrom(owner, recipient, amount)` **at any time, without the owner's
involvement**. The spender does not need the owner's private key or MPC
signature — they call `transferFrom` from their own account.

**Attack scenario (no spender allowlist):**

```
1. User has Erc20Holding(USDC, 100) on Canton
   → user's derived address 0xABC holds 100 USDC on Sepolia

2. User exercises RequestEvmApprove(USDC, spender=0xMyPersonalEOA, max)
   → MPC signs approve tx
   → 0xABC has approved 0xMyPersonalEOA to spend unlimited USDC

3. User calls USDC.transferFrom(0xABC, 0xMyPersonalEOA, 100) from their
   personal EOA on Sepolia — this is a normal Ethereum tx, no MPC needed
   → tokens leave 0xABC

4. Canton still shows Erc20Holding(USDC, 100) — PHANTOM BALANCE
   The holding is backed by nothing. Canton has no idea the tokens are gone.
```

The critical insight: **the `transferFrom` call bypasses Canton entirely**.
It's executed by the spender (not the owner), so it doesn't need the MPC
key. Canton never sees it.

**Even with protocol-only spenders (stataToken, SwapRouter02):** the risk
is lower because these contracts only call `transferFrom` inside their own
functions (deposit, swap), and they pull from `msg.sender` — meaning
someone would need the MPC key to be `msg.sender`. But the fundamental
concern remains: any approved spender can move tokens off-chain without
Canton knowing.

### Additional Risks

- **No auditability.** The issuer cannot answer "which DeFi protocols can
  currently spend User X's USDC?" — a compliance and risk management
  failure for institutional custody.
- **No policy enforcement.** Without tracking, Canton cannot validate that
  an approval was granted before allowing a supply/swap operation.
- **Protocol compromise.** If the stataToken proxy is upgraded to a
  malicious implementation (governance attack, admin key theft), the
  attacker could drain all approved balances via `transferFrom`. This has
  happened in production — Paraswap Augustus V6 (March 2024) saw users
  drained via outstanding approvals months after their last interaction.

### Mitigating Factors in This Architecture

- **Per-user derived addresses.** A compromised approval on Alice's address
  cannot affect Bob's tokens.
- **Protocol contracts pull from `msg.sender`.** stataToken's `deposit()`
  calls `transferFrom(msg.sender, ...)` — a third party calling
  `deposit()` from their own account pulls from _their_ balance, not the
  derived address. Exploiting the approval requires being `msg.sender` from
  the derived address, which requires the MPC key.
- **The approve race condition is a non-issue.** The spender is a protocol
  contract, not an adversarial EOA.

### Three Options for Making Canton Aware

#### Option 1: Track Approvals as Canton Contracts (recommended)

Add an `Erc20Approval` template that records active approvals on the ledger.

```daml
template Erc20Approval
  with
    issuer       : Party
    owner        : Party
    tokenAddress : BytesHex
    spender      : BytesHex
    amount       : BytesHex
  where
    signatory issuer
    observer owner
```

`ClaimEvmApprove` creates this contract after a successful approve tx.
Revocations (approve with amount=0) archive it. `RequestAaveSupply` and
`RequestUniswapSwap` can fetch the approval to verify it exists before
signing (defense in depth).

The `RequestEvmApprove` choice should also enforce a **spender allowlist**
— only issuer-whitelisted contract addresses (stataToken, SwapRouter02)
can be approved. This prevents users from approving arbitrary addresses.

| Pros                                                         | Cons                                                                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Full audit trail on Canton                                   | Drift: on-chain allowance decreases as protocols call `transferFrom`, Canton doesn't track remaining allowance |
| Spender allowlist in Daml                                    | Adding `Erc20Approval` + new `TxSource` variant is an incompatible DAR upgrade                                 |
| Policy enforcement before MPC signing                        |                                                                                                                |
| Matches institutional custody patterns (Fireblocks, Fordefi) |                                                                                                                |

**Drift is manageable:** Canton only needs to know _that_ an approval was
granted, not the exact remaining allowance. If the on-chain allowance is
insufficient, the DeFi call reverts and the MPC outcome reports failure.

#### Option 2: Query On-Chain Allowance at Request Time

TypeScript queries `allowance(owner, spender)` before exercising a Canton
choice and passes the value as a parameter. The Daml choice asserts the
allowance is sufficient.

| Pros                                       | Cons                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No new Daml templates                      | **Fundamentally broken**: the value is user-supplied — Canton cannot verify it. A malicious user can pass `0xFFFF...` regardless of the real allowance |
| Reflects actual on-chain state (if honest) | TOCTOU race: allowance can change between query and execution                                                                                          |
|                                            | No audit trail                                                                                                                                         |
|                                            | The check is redundant — if allowance is insufficient, the on-chain call reverts anyway                                                                |

**Not recommended.** Provides no security that on-chain execution doesn't
already provide.

#### Option 3: Eliminate Standalone Approvals via EIP-2612 `permit()`

Use `permit(owner, spender, value, deadline, v, r, s)` to combine the
approval signature with the DeFi action in a single transaction. No
lingering approval sits on-chain.

| Pros                                           | Cons                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| No lingering approvals — single-use permission | Requires extending MPC service for EIP-712 signing (non-trivial)              |
| Strongest security guarantee                   | Not all tokens support EIP-2612 (USDT does not)                               |
| One fewer EVM transaction                      | V1 `StaticATokenLM` on Sepolia may not support permit-based deposit           |
|                                                | Still needs Canton tracking for auditability — ends up adding Option 1 anyway |

**Good future optimization** for supported tokens, but not the primary
mechanism for the PoC.

### Recommendation

**Option 1** for the PoC. The MPC architecture already neutralizes direct
exploit paths, so the main value of tracking is **auditability and policy
enforcement** — both hard requirements for institutional custody. Option 3
can be layered on later as an optimization for EIP-2612 tokens.

Concrete additions needed:

- `Erc20Approval` template
- Spender allowlist (hardcoded known protocol addresses, or issuer-managed
  `AllowedSpender` contracts)
- `ClaimEvmApprove` creates/replaces `Erc20Approval`
- `RequestAaveSupply` / `RequestUniswapSwap` fetch approval as pre-check
- Consider **exact-amount approvals** instead of max uint256 for production
  (limits blast radius if a protocol is compromised)

### Cleaning Dirty Holdings (Revoking Approvals)

When a user has an active `Erc20Approval` for a token, their `Erc20Holding`
for that token is "dirty" — a third-party spender could drain the backing
tokens via `transferFrom`, making the Canton holding a phantom balance.

**Two cleaning approaches:**

| Approach                                            | How                                             | Gas Cost              | Complexity                                             |
| --------------------------------------------------- | ----------------------------------------------- | --------------------- | ------------------------------------------------------ |
| **Revoke approval** (`approve(spender, 0)`)         | One cheap storage write                         | ~46k gas              | Low — reuse existing `RequestEvmApprove` with amount=0 |
| **Transfer to new address** (fresh derivation path) | Transfer all tokens + fund new address with ETH | ~65k + ETH funding tx | High — path proliferation, multi-token fragmentation   |

**Recommendation: Revoke, not transfer.** Revoke is cheaper, simpler, and
solves the actual problem (the approval). Transfer-to-new-address creates
derivation path proliferation and fragments holdings across addresses.
Reserve address rotation for key compromise scenarios only.

**Canton enforcement pattern:**

1. `RequestEvmWithdrawal` should require that no active `Erc20Approval`
   contracts exist for the holding's token + owner. The caller passes
   `activeApprovals : [ContractId Erc20Approval]` and Canton asserts it's
   empty. If the user wants to withdraw, they must revoke all approvals
   first.
2. DeFi operations (`RequestAaveSupply`, `RequestUniswapSwap`) are allowed
   WITH active approvals — the approval is required for the operation.
3. After completing a DeFi position (e.g., Aave withdraw), the user should
   revoke the stataToken approval to return the holding to "clean" state.

### Beyond Approvals: Other Bypass Vectors

A full audit of all ways tokens can leave an EOA without the MPC signing
a transaction reveals that `approve + transferFrom` is the primary risk,
but not the only one.

#### Vectors That Can Bypass MPC

| #   | Vector                 | Mechanism                                                                                     | Risk     | Mitigation                                                                           | Learn More                                                                                                                                                                                                                                                         |
| --- | ---------------------- | --------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **ERC-20 approve**     | Approved spender calls `transferFrom` without owner's key                                     | High     | Spender allowlist + `Erc20Approval` tracking                                         | [ERC-20 Approve Pattern](https://speedrunethereum.com/guides/erc20-approve-pattern), [Unlimited Approvals Considered Harmful](https://kalis.me/unlimited-erc20-allowances/)                                                                                        |
| 2   | **EIP-2612 permit**    | Off-chain EIP-712 signature creates approval — anyone can submit the `permit()` call on-chain | High     | MPC must only sign RLP-encoded txs, never arbitrary EIP-712 messages                 | [EIP-2612 Spec](https://eips.ethereum.org/EIPS/eip-2612), [Approval Vulnerabilities (SCSFG)](https://scsfg.io/hackers/approvals/)                                                                                                                                  |
| 3   | **Permit2 (Uniswap)**  | Standing `AllowanceTransfer` lets approved spenders drain without further signatures          | High     | Never approve tokens to Permit2; use `SignatureTransfer` path with per-tx signatures | [Permit2 Overview (Uniswap)](https://docs.uniswap.org/contracts/permit2/overview), [ChainSecurity Audit](https://www.chainsecurity.com/security-audit/uniswap-permit2), [What is Permit2 (Revoke.cash)](https://revoke.cash/learn/approvals/what-is-permit2)       |
| 4   | **Token admin (USDT)** | `destroyBlackFunds(addr)` burns tokens at any blacklisted address                             | Critical | Token whitelist; accept as trust assumption                                          | [USDT Blacklisting Analysis (BlockSec)](https://blocksec.com/blog/1-26-billion-frozen-usdt-blacklisting-on-ethereum-and-tron-in-2025), [USDT Code Breakdown](https://medium.com/coinmonks/decoding-the-tether-usdt-an-in-depth-look-at-the-usdt-code-0f50c994bf81) |
| 5   | **Token admin (USDC)** | `blacklist(addr)` freezes address — tokens exist but immovable                                | High     | Same — trust assumption for centralized stablecoins                                  | [Circle USDC Source](https://github.com/circlefin/stablecoin-evm), [Tornado Cash Blacklist](https://cryptoslate.com/circle-blacklists-all-tornado-cash-eth-addresses-effectively-freezing-usdc/)                                                                   |
| 6   | **Proxy upgrade**      | Proxy admin deploys new implementation with arbitrary drain functions                         | Medium   | Monitor `Upgraded` events; prefer non-upgradeable tokens (DAI, WETH)                 | [OpenZeppelin Proxy Patterns](https://docs.openzeppelin.com/upgrades-plugins/proxies), [Proxy Security Best Practices (CertiK)](https://www.certik.com/resources/blog/FnfYrOCsy3MG9s9gixfbJ-upgradeable-proxy-contract-security-best-practices)                    |
| 7   | **ERC-777 operators**  | Default operators can move tokens for ALL holders without authorization                       | Low      | Reject ERC-777 tokens via token whitelist                                            | [EIP-777 Spec](https://eips.ethereum.org/EIPS/eip-777), [ERC-777 Reentrancy Issues](https://blog.openzeppelin.com/exploiting-uniswap-from-reentrancy-to-actual-profit)                                                                                             |
| 8   | **MPC key compromise** | Attacker signs arbitrary txs from derived address — Canton never sees them                    | Critical | MPC key security + nonce monitoring + on-chain reconciliation                        | [Trail of Bits: Breaking Aave Upgradeability](https://blog.trailofbits.com/2020/12/16/breaking-aave-upgradeability/) (analogous: key compromise in crypto systems)                                                                                                 |

#### Vectors That CANNOT Bypass MPC (EOA is safe)

| #   | Vector                                       | Why It's Safe                                                                                  | Learn More                                                                                     |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 9   | Flashloan callbacks                          | EOA has no code — callbacks are no-ops                                                         | [Aave Flashloan Docs](https://aave.com/docs/aave-v3/smart-contracts/flash-loans)               |
| 10  | Delegatecall                                 | Only contracts can execute delegatecall, not EOAs                                              | [Solidity Delegatecall](https://solidity-by-example.org/delegatecall/)                         |
| 11  | SELFDESTRUCT/CREATE2                         | Cannot deploy code at an EOA address; ERC-20 balances stored in token contract, not holder     | [EIP-684](https://eips.ethereum.org/EIPS/eip-684)                                              |
| 12  | Reentrancy                                   | EOA has no re-entrant functions                                                                | [Reentrancy Attacks (SWC)](https://swcregistry.io/docs/SWC-107/)                               |
| 13  | Storage manipulation                         | Cannot modify another contract's storage from outside                                          | [EVM Storage Layout](https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html) |
| 14  | Non-standard functions (`increaseAllowance`) | Canton uses function signature allowlist, not blocklist — anything != `transfer` is rejected   | [Weird ERC20 Tokens (d-xo)](https://github.com/d-xo/weird-erc20)                               |
| 15  | Inbound token drift                          | Tokens can arrive without MPC (not an outflow risk) — causes Canton balance < on-chain balance | [ERC-20 Spec](https://eips.ethereum.org/EIPS/eip-20)                                           |

#### Token Admin Powers (Reference)

| Token         | Freeze             | Burn/Destroy                                          | Move | Upgradeable      | Source                                                                                                            |
| ------------- | ------------------ | ----------------------------------------------------- | ---- | ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| **USDC**      | Yes (blacklist)    | No (but upgrade could add)                            | No   | Yes (proxy)      | [circlefin/stablecoin-evm](https://github.com/circlefin/stablecoin-evm)                                           |
| **USDT**      | Yes (addBlackList) | **Yes** (destroyBlackFunds — $698M destroyed in 2025) | No   | No               | [BlockSec analysis](https://blocksec.com/blog/1-26-billion-frozen-usdt-blacklisting-on-ethereum-and-tron-in-2025) |
| **DAI**       | No                 | No                                                    | No   | No               | [MakerDAO DAI docs](https://docs.makerdao.com/smart-contract-modules/dai-module/dai-detailed-documentation)       |
| **WETH**      | No                 | No                                                    | No   | No (immutable)   | [WETH9 on Etherscan](https://etherscan.io/address/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2)                     |
| **aUSDC**     | No                 | No                                                    | No   | Yes (governance) | [Aave AToken.sol](https://github.com/aave/aave-v3-core/blob/master/contracts/protocol/tokenization/AToken.sol)    |
| **stataUSDC** | No                 | No                                                    | No   | Yes (governance) | [BGD stataToken v3](https://governance.aave.com/t/bgd-statatoken-v3/11894)                                        |

#### Further Reading

- [Quantifying the Risk of Unlimited ERC-20 Approval (arXiv)](https://arxiv.org/pdf/2207.01790) — academic study of approval risks
- [Trail of Bits: Token Integration Checklist](https://secure-contracts.com/development-guidelines/token_integration.html) — security checklist for non-standard tokens
- [Convenience vs Security: Unlimited Approval (BlockSec)](https://blocksec.com/blog/tradeoff-between-convenience-and-security-unlimited-approval-in-erc-20)
- [Resolving the Multiple Withdrawal Attack on ERC20 (arXiv)](https://arxiv.org/pdf/1907.00903) — the approve race condition paper
- [Fireblocks DeFi Security Suite](https://www.fireblocks.com/platforms/defi) — how institutional custody handles DeFi approvals
- [ParaSwap Augustus V6 Post-Mortem](https://veloradex.medium.com/post-mortem-augustus-v6-vulnerability-of-march-20th-2024-5df663a4bf01) — real-world approval exploit ($1.1M drained)
- [PEPE Holder Permit2 Phishing ($1.39M)](https://decrypt.co/286076/pepe-uniswap-permit2-phishing-attack) — Permit2 signature phishing
- [Weird ERC20 Tokens Catalog (d-xo)](https://github.com/d-xo/weird-erc20) — non-standard token behaviors

### Solution: Two-Address Custody Model

The approval problem is solved by separating **DeFi execution** (untrusted,
may have approvals) from **Canton trading** (vault-backed, guaranteed).
This mirrors the CEX model and matches how every major bridge handles
custody.

#### Two Address Types

| Address                   | Name                 | Path              | Who controls            | Approvals?            | Canton trusts it?                       |
| ------------------------- | -------------------- | ----------------- | ----------------------- | --------------------- | --------------------------------------- |
| **User DeFi Address**     | Per-user derived EOA | `"{user},{path}"` | MPC (on user's behalf)  | Yes — needed for DeFi | **No** — balance may not match Canton   |
| **Vault Custody Address** | Shared root address  | `"root"`          | MPC (issuer-controlled) | **Never**             | **Yes** — sole source of `Erc20Holding` |

The vault address **never calls `approve()`**. It only executes `transfer()`
to move tokens in/out. This is the same pattern every bridge uses
(LayerZero, Wormhole, Chainlink CCIP, Axelar) — the custody contract never
grants allowances, making `transferFrom`-based drainage impossible.

#### Custody Sweep: User DeFi Address → Vault

When tokens arrive at the user's DeFi address (from Aave, Uniswap, etc.),
they are **not yet tradeable on Canton**. The user must sweep them to the
vault — exactly like the existing deposit flow:

```
 User DeFi Address              Vault                          Canton
 (0xABC, untrusted)             (0xROOT, no approvals)         (Daml ledger)
 |                              |                              |
 | stataUSDC sits here          |                              |
 | (may have approvals,         |                              |
 |  Canton can't guarantee it)  |                              |
 |                              |                              |
 | 1. RequestCustodySweep       |                              |
 |    transfer(vault, amount)   |                              |
 |----------------------------->|                              |
 |                              | tokens arrive                |
 |                              |                              |
 |                              | 2. MPC confirms tx succeeded |
 |                              |----------------------------->|
 |                              |                              | verify on-chain
 |                              |                              | create Erc20Holding
 |                              |                              |   (stataUSDC, amount)
 |                              |                              |
 |                              |                              | NOW tradeable on Canton
```

#### Full DeFi + Trading Lifecycle

```
Phase 1: DeFi (at User DeFi Address — untrusted)
  1. User withdraws USDC from vault → USDC at user's DeFi address
  2. User approves stataToken from DeFi address
  3. User supplies USDC to Aave → stataUSDC at DeFi address
     (stataUSDC is at an address with approvals — NOT safe for Canton)

Phase 2: Custody Sweep (DeFi Address → Vault)
  4. User sweeps stataUSDC to vault address (transfer, no approve needed)
  5. Canton verifies tx succeeded, creates Erc20Holding(stataUSDC)
     (NOW the balance is vault-backed — no approvals, guaranteed)

Phase 3: Canton Trading (vault-backed, safe)
  6. User can swap Erc20Holding(stataUSDC) with other users on Canton
  7. P2P trades are pure Daml ledger updates — no EVM transactions
  8. Holdings are guaranteed backed because the vault never approves anyone

Phase 4: Exit
  9. User redeems Erc20Holding → vault transfers stataUSDC to user's DeFi address
  10. User redeems stataUSDC from Aave → USDC at DeFi address
  11. User withdraws USDC to external wallet
```

#### Why This Works

- **Vault never approves** → `transferFrom`-based drainage is impossible
- **Erc20Holding is only created after verified sweep** → no phantom balances
- **Canton trading is off-chain** → P2P swaps are just Daml contract updates
- **DeFi happens at user's address** → approvals are isolated per-user
- **Existing deposit/withdrawal flow already does this** — the custody
  sweep is the same `transfer` + `ClaimEvmDeposit` pattern

#### New Choice: `RequestCustodySweep`

Transfers any ERC-20 from the user's DeFi address to the vault. Identical
to `RequestEvmDeposit` but for arbitrary tokens (not just the original
deposit token).

```daml
nonconsuming choice RequestCustodySweep : ContractId PendingEvmTx
  with
    requester    : Party
    tokenAddress : BytesHex    -- any ERC-20 (stataUSDC, WETH, etc.)
    amount       : BytesHex
    evmParams    : EvmTransactionParams
  controller requester
  do
    assertMsg "must be transfer" $
      evmParams.functionSignature == "transfer(address,uint256)"
    -- validate recipient is the vault address
    let recipient = evmParams.args !! 0
    assertMsg "must transfer to vault" $
      recipient == vaultAddress
    ...
```

After MPC confirms the transfer succeeded, `ClaimCustodySweep` creates
the `Erc20Holding` — same verification pattern as `ClaimEvmDeposit`.

#### Naming Summary

| Term                      | What it means                                                     |
| ------------------------- | ----------------------------------------------------------------- |
| **User DeFi Address**     | Per-user derived EOA for DeFi interactions. Untrusted by Canton.  |
| **Vault Custody Address** | Shared root address. No approvals ever. Source of `Erc20Holding`. |
| **Custody Sweep**         | Transfer from DeFi address → vault. Creates vault-backed holding. |
| **Erc20Holding**          | Vault-backed balance. Tradeable on Canton. Guaranteed backed.     |
| **Custody Redeem**        | Transfer from vault → DeFi address. Consumes holding.             |

#### Production Hardening (Optional)

For defense-in-depth, the vault address can be a **Safe (Gnosis Safe)**
instead of an EOA. The Safe's Guard would reject any `approve()` call at
the EVM level — even if Canton or MPC is compromised, the on-chain contract
blocks unauthorized approvals. This is what Fireblocks and Fordefi do
under the hood. For the PoC, the EOA vault with Canton-only enforcement
is sufficient.
