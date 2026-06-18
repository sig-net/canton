# Uniswap V3 Swap — Token Exchange via MPC Vault

## Overview

Extend the vault to **swap ERC-20 tokens via Uniswap V3** on Sepolia. The user's
`Erc20Holding` for token A is consumed, the vault calls `exactInputSingle()` on the
SwapRouter02, and a new `Erc20Holding` for token B is created on Canton with the
actual output amount from the swap.

**Why Uniswap V3:** V2, V3, and V4 all deployed on Sepolia. V3 has the best balance
of maturity, liquidity, and documentation. Active pools for WETH/USDC and UNI/WETH.

## Sepolia Addresses

| Contract              | Address                                      |
| --------------------- | -------------------------------------------- |
| SwapRouter02          | `0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E` |
| UniswapV3Factory      | `0x0227628f3F023bb0B980b67D528571c95c6DaC1c` |
| QuoterV2              | `0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3` |
| Permit2               | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| WETH                  | `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14` |
| USDC (Circle testnet) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| UNI                   | `0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984` |

### Fee Tiers

| Fee     | Basis Points | Tick Spacing | Best For             |
| ------- | ------------ | ------------ | -------------------- |
| `500`   | 0.05%        | 10           | Stable pairs         |
| `3000`  | 0.30%        | 60           | Standard (WETH/USDC) |
| `10000` | 1.00%        | 200          | Exotic/volatile      |

## Sequence Diagram

```
 User              Canton                MPC Service         Sepolia
  |                  |                       |                  |
  |  RequestEvmApprove(tokenIn, Router, max) |                  |
  |----------------->|                       |                  |
  |                  | PendingEvmTx(approve)  |                  |
  |                  |---------------------->|                  |
  |                  |                       | sign + submit    |
  |                  |                       |----------------->|
  |                  |                       | sigs             |
  |                  |<----------------------|                  |
  |  ClaimEvmApprove |                       |                  |
  |----------------->| (verify, archive)     |                  |
  |                  |                       |                  |
  |  RequestUniswapSwap(holdingCid, params)  |                  |
  |----------------->|                       |                  |
  |                  | archive Erc20Holding  |                  |
  |                  | PendingEvmTx(swap)     |                  |
  |                  |---------------------->|                  |
  |                  |                       | sign + submit    |
  |                  |                       |----------------->|
  |                  |                       | signature        |
  |                  |<----------------------|                  |
  |                  |                       | outcome sig      |
  |                  |<----------------------|                  |
  |  ClaimUniswapSwap|                       |                  |
  |----------------->| verify outcome        |                  |
  |                  | decode amountOut      |                  |
  |                  | create Erc20Holding   |                  |
  |  <-- Erc20Holding(tokenOut, amountOut)   |                  |
```

## EVM Functions

### 1. ERC-20 `approve` (one-time per token, reuses `RequestEvmApprove`)

```
function approve(address spender, uint256 amount) returns (bool)
selector: 0x095ea7b3
```

Same as Aave proposal — see `aave-v3-yield.md` for the calldata layout.
`spender` = SwapRouter02 address.

### 2. SwapRouter02 `exactInputSingle`

```
function exactInputSingle(ExactInputSingleParams calldata params)
    external payable returns (uint256 amountOut)

struct ExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint24  fee;
    address recipient;
    uint256 amountIn;
    uint256 amountOutMinimum;
    uint160 sqrtPriceLimitX96;
}
```

**Selector:** `0x04e45aaf`

**`EvmType2TransactionParams` calldata layout (example: swap 0.01 WETH → USDC, 0.3% fee):**

| Field / slot    | Value                                                                          |
| --------------- | ------------------------------------------------------------------------------ |
| `to`            | Router `3bfa4769fb09eefc5a80d6e87c3b9c650f7ae48e`                              |
| selector source | `"exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))"` |
| arg slot 0      | tokenIn (WETH), left-padded 32 bytes                                           |
| arg slot 1      | tokenOut (USDC), left-padded 32 bytes                                          |
| arg slot 2      | fee = `0bb8` (3000), left-padded 32 bytes                                      |
| arg slot 3      | recipient = vault address, left-padded 32 bytes                                |
| arg slot 4      | amountIn, left-padded 32 bytes                                                 |
| arg slot 5      | amountOutMinimum = `00..00` (0 initially; set real value in prod)              |
| arg slot 6      | sqrtPriceLimitX96 = `00..00` (0 = no limit)                                    |
| `value`         | `00..00` (32 bytes zero — not sending ETH)                                     |

**Schema:** `outputDeserializationSchema = [{"name":"amountOut","type":"uint256"}]`
**Schema:** `respondSerializationSchema = [{"name":"amountOut","type":"uint256"}]`

**Note on `functionSignature`:** The struct is ABI-encoded as a tuple. viem's
`toFunctionSelector()` correctly computes the 4-byte selector from the tuple
signature. The `args` array contains each struct field as a separate 32-byte slot,
matching standard ABI encoding for tuple parameters.

## Daml Contract Changes

### New TxSource Type

```daml
-- new type — current code anchors flows in separate PendingDeposit/PendingWithdrawal templates
data TxSource
  = DepositSource (ContractId DepositAuthorization)
  | WithdrawalSource (ContractId Erc20Holding)
  | ApproveSource                                    -- from aave proposal
  | AaveSupplySource (ContractId Erc20Holding)       -- from aave proposal
  | AaveWithdrawSource (ContractId Erc20Holding)     -- from aave proposal
  | SwapSource (ContractId Erc20Holding)             -- NEW
```

### New Choices on Vault

`RequestEvmApprove` and `ClaimEvmApprove` are shared with the Aave proposal — see
`aave-v3-yield.md`.

#### RequestUniswapSwap (nonconsuming)

```daml
nonconsuming choice RequestUniswapSwap : ContractId PendingEvmTx
  with
    requester        : Party
    signerCid        : ContractId Signer
    holdingCid       : ContractId Erc20Holding
    tokenOut         : BytesHex    -- output token address
    fee              : BytesHex    -- Uniswap fee tier (e.g., 0bb8 = 3000)
    amountOutMinimum : BytesHex    -- slippage protection
    evmTxParams      : EvmType2TransactionParams
    -- plus keyVersion/algo/dest/params, schema strings, and the CC fee args,
    -- as in RequestDeposit/RequestWithdrawal
  controller requester
  do
    holding <- fetch holdingCid

    assertMsg "owner mismatch" $ holding.owner == requester
    assertMsg "operators mismatch" $ sameOperatorSet holding.operators operators
    assertMsg "must be exactInputSingle" $
      abiSelectorMatches
        "exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))"
        evmTxParams.calldata

    -- validate calldata slots match holding
    let argSlots = abiStripSelector evmTxParams.calldata
    assertMsg "tokenIn must match holding contract" $
      abiDecodeAddress argSlots 0 == holding.erc20Address
    assertMsg "amountIn must match holding amount" $
      abiDecodeUint argSlots 4 == holding.amount

    archive holdingCid

    -- Signer.RequestSignature charges the CC fee, sets sender = operators hash,
    -- and emits the SignBidirectionalEvent the MPC watches
    let requestPath = vaultId <> ",root"
    signEventCid <- exercise signerCid RequestSignature with
      txParams = EvmType2TxParams evmTxParams; path = requestPath; ..
    signEvent <- fetch signEventCid
    let requestId = requestIdFromSignEvent signEvent

    create PendingEvmTx with
      source = SwapSource holdingCid
      path = requestPath
      outputDeserializationSchema =
        "[{\"name\":\"amountOut\",\"type\":\"uint256\"}]"
      respondSerializationSchema =
        "[{\"name\":\"amountOut\",\"type\":\"uint256\"}]"
      ..
```

#### ClaimUniswapSwap (nonconsuming)

```daml
nonconsuming choice ClaimUniswapSwap
    : Optional (ContractId Erc20Holding)
  with
    requester                    : Party
    pendingCid                   : ContractId PendingEvmTx
    respondBidirectionalEventCid : ContractId RespondBidirectionalEvent
    signatureRespondedEventCid   : ContractId SignatureRespondedEvent
  controller requester
  do
    pending <- fetch pendingCid
    outcome <- fetch respondBidirectionalEventCid

    -- verify MPC signature
    assertMsg "requestId mismatch" $ pending.requestId == outcome.requestId
    let responseHash = computeResponseHash pending.requestId outcome.serializedOutput
    assertMsg "invalid MPC signature" $
      secp256k1WithEcdsaOnly (signatureDer outcome.signature) responseHash
        mpcResponseVerifyKey

    archive pendingCid
    exercise respondBidirectionalEventCid Consume_RespondBidirectional with actor = requester
    exercise signatureRespondedEventCid Consume_SignatureResponded with actor = requester
    exercise pending.signEventCid Consume_SignBidirectional with actor = requester

    let argSlots = abiStripSelector pending.evmTxParams.calldata
    if abiHasErrorPrefix outcome.serializedOutput then do
      -- swap failed — refund original holding
      refundCid <- create Erc20Holding with
        operators
        owner = requester
        erc20Address = abiDecodeAddress argSlots 0
        amount = abiDecodeUint argSlots 4
      pure (Some refundCid)
    else do
      -- swap succeeded — create holding for output token
      holdingCid <- create Erc20Holding with
        operators
        owner = requester
        erc20Address = abiDecodeAddress argSlots 1
        amount = abiDecodeUint outcome.serializedOutput 0
      pure (Some holdingCid)
```

### Validation Notes

**Slippage protection:** `amountOutMinimum` is passed in calldata arg slot 5. For
now, set to `0` (accept any output). In production, the user should compute this
off-chain using QuoterV2 and set a meaningful minimum.

**tokenOut validation:** The Daml contract validates `tokenIn` matches the holding's
`erc20Address` and `amountIn` matches `holding.amount`. The `tokenOut` is trusted
from the user's request — the vault doesn't need to validate it since Uniswap will
revert if the pool doesn't exist.

**Full amount swap:** The entire `Erc20Holding` amount is swapped. Partial swaps
would require splitting the holding first (future extension).

## MPC Service Changes

**None.** Same as the Aave proposal — the existing pipeline handles any
`SignBidirectionalEvent` generically.

## E2E Test Plan

### Test: `uniswap-swap-e2e.test.ts`

**Setup (beforeAll, 60s):**

1. `setupVault()` — allocate parties, upload DAR, create Vault
2. Fund vault address with WETH on Sepolia:
   - Send ETH to vault address
   - Call `WETH.deposit{value: 0.01 ether}()` via MPC (or fund directly from faucet)
3. Start MPC server
4. Execute `RequestEvmApprove` for WETH → SwapRouter02 (max uint256)
5. Wait for MPC to sign + submit approve tx
6. Exercise `ClaimEvmApprove`

**Test 1: Swap WETH → USDC (300s):**

1. Create `Erc20Holding` for WETH (via deposit flow or direct create)
2. Build `EvmType2TransactionParams` calldata for `exactInputSingle`:
   - tokenIn = WETH, tokenOut = USDC, fee = 3000
   - amountIn = holding amount, amountOutMinimum = 0
3. Exercise `RequestUniswapSwap`
4. Wait for MPC to sign + submit swap tx
5. Exercise `ClaimUniswapSwap`
6. Assert: new `Erc20Holding` created for USDC
7. Assert: `amountOut > 0`
8. Assert: `erc20Address` == USDC address
9. Verify on Sepolia: vault WETH balance decreased, USDC balance increased

**Test 2: Swap failure — non-existent pool (300s):**

1. Create `Erc20Holding` for WETH
2. Attempt swap with invalid tokenOut (or zero-liquidity pool)
3. MPC submits tx → Sepolia reverts
4. Exercise `ClaimUniswapSwap`
5. Assert: refund `Erc20Holding` created (original token + amount restored)

### Env Variables (additions)

```
UNISWAP_ROUTER_ADDRESS=0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E
WETH_ADDRESS=0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14
```

## Composability with Aave

Both proposals share `RequestEvmApprove` / `ClaimEvmApprove`. A user could:

1. Deposit USDC → `Erc20Holding(USDC)`
2. Swap USDC → WETH via Uniswap → `Erc20Holding(WETH)`
3. Supply WETH to Aave → `AavePosition(WETH)`
4. Withdraw WETH + yield from Aave → `Erc20Holding(WETH, amount+yield)`
5. Swap WETH → USDC via Uniswap → `Erc20Holding(USDC)`
6. Withdraw USDC to external wallet

This demonstrates the vault as a **general-purpose DeFi execution layer** — Canton
tracks ownership and authorization, the MPC service signs arbitrary EVM calls, and
Sepolia executes them.
