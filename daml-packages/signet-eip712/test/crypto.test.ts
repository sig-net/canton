import { describe, it, expect } from "vitest";
import {
  computeRequestId,
  computeResponseHash,
  hashEvmType2Params,
  type CantonEvmType2Params,
} from "canton-sig";

const sampleEvmType2Params: CantonEvmType2Params = {
  chainId: "0000000000000000000000000000000000000000000000000000000000aa36a7",
  nonce: "0000000000000000000000000000000000000000000000000000000000000001",
  maxPriorityFeePerGas: "000000000000000000000000000000000000000000000000000000003b9aca00",
  maxFeePerGas: "00000000000000000000000000000000000000000000000000000001dcd65000",
  gasLimit: "000000000000000000000000000000000000000000000000000000000000c350",
  to: "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  value: "0000000000000000000000000000000000000000000000000000000000000000",
  calldata:
    "a9059cbb" +
    "000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045" +
    "0000000000000000000000000000000000000000000000000000000005f5e100",
  accessList: [],
};

const sampleEthTransferParams: CantonEvmType2Params = {
  ...sampleEvmType2Params,
  nonce: "0000000000000000000000000000000000000000000000000000000000000002",
  gasLimit: "0000000000000000000000000000000000000000000000000000000000005208",
  to: "1111111111111111111111111111111111111111",
  value: "00000000000000000000000000000000000000000000000000038d7ea4c68000",
  calldata: "",
};

const sampleAccessListParams: CantonEvmType2Params = {
  ...sampleEvmType2Params,
  accessList: [
    {
      address: "2222222222222222222222222222222222222222",
      storageKeys: [
        "0000000000000000000000000000000000000000000000000000000000000000",
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      ],
    },
  ],
};

const sampleContractCreationParams: CantonEvmType2Params = {
  ...sampleEvmType2Params,
  nonce: "0000000000000000000000000000000000000000000000000000000000000003",
  to: null,
  value: "0000000000000000000000000000000000000000000000000000000000000000",
  calldata: "",
};

const SENDER = "df60843384dea829feee6d7abe7e9dfef996ad71e536ee73c1af8d23e0b4070a";
const CAIP2_ID = "eip155:11155111";
const KEY_VERSION = 1;
const PATH = "m/44/60/0/0";

// ---------------------------------------------------------------------------
// Cross-language vectors (must match Daml TestRequestId.daml)
// ---------------------------------------------------------------------------
const VECTORS = {
  hashType2Sample: "0xf1ea0b772bfe36491fe76c2e6dc01500d1d450bf69de3452d7e6db0356568dbf",
  hashType2EthTransfer: "0x772a96f61e790006aea0170ce80be388d26f929ddaa670088946ee26b0103f92",
  hashType2AccessList: "0x1958cd3129ac47587cc671edcd0dbee65fa18bca4c97e6c959a30d15ba9994e9",
  hashType2ContractCreation: "0xea05c872b41f323538651c9661ebdc4404e4c934b548eb49c7f0ddbf6ba03667",
  requestIdKv0: "0xc78bad85eb84c149611f8dbc20e179e2001f0b703b8199b1a31c8feec653301d",
  requestIdKv1: "0xaf5de812ffd1408db82f32b543c1b92f973c4280d7456efa032c2ace9725e1e7",
  requestIdKv256: "0xd790759b0f32e12a2dce289a8a9caba39bfa7804dc8f39efab9480909e029457",
  requestIdEthTransfer: "0x10a0778a26f7eccfe5f3b987443ddf429a5cd246a5c0baf6c893fbdd0b66256c",
  requestIdAccessList: "0xa8b7453df8b0739b5a8ceb121ed6ffcda2230e92e703e814ca842ef3604aaadc",
  requestIdContractCreation: "0x79bf70f52ac4f67dcbfd2711bd72de792a899e4167fbdadba44bf6493d3b6ed6",
  responseHash01: "0x0344a8df5db02fe0579ff283081b60d9e6f3956594facfc6ea2befd5890366f4",
  responseHashEmpty: "0x20ee8f1366f06926e9e8771d8fb9007a8537c8dfdb6a3f8c2cfd64db19d2ec90",
};

const KNOWN_REQUEST_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

// ---------------------------------------------------------------------------
// hashEvmType2Params
// ---------------------------------------------------------------------------
describe("hashEvmType2Params", () => {
  it("matches cross-language vector for ERC20 calldata", () => {
    expect(hashEvmType2Params(sampleEvmType2Params)).toBe(VECTORS.hashType2Sample);
  });

  it("matches cross-language vector for plain ETH transfer", () => {
    expect(hashEvmType2Params(sampleEthTransferParams)).toBe(VECTORS.hashType2EthTransfer);
  });

  it("matches cross-language vector for access list", () => {
    expect(hashEvmType2Params(sampleAccessListParams)).toBe(VECTORS.hashType2AccessList);
  });

  it("matches cross-language vector for contract creation", () => {
    expect(hashEvmType2Params(sampleContractCreationParams)).toBe(
      VECTORS.hashType2ContractCreation,
    );
  });
});

// ---------------------------------------------------------------------------
// computeRequestId
// ---------------------------------------------------------------------------
describe("computeRequestId", () => {
  it("matches cross-language vector for keyVersion=1", () => {
    expect(
      computeRequestId(
        SENDER,
        { tag: "EvmType2TxParams", value: sampleEvmType2Params },
        CAIP2_ID,
        KEY_VERSION,
        PATH,
        "ECDSA",
        "ethereum",
        "",
      ),
    ).toBe(VECTORS.requestIdKv1);
  });

  it("returns a 32-byte hex hash", () => {
    const rid = computeRequestId(
      SENDER,
      { tag: "EvmType2TxParams", value: sampleEvmType2Params },
      CAIP2_ID,
      KEY_VERSION,
      PATH,
      "ECDSA",
      "ethereum",
      "",
    );
    expect(rid).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    const a = computeRequestId(
      SENDER,
      { tag: "EvmType2TxParams", value: sampleEvmType2Params },
      CAIP2_ID,
      KEY_VERSION,
      PATH,
      "ECDSA",
      "ethereum",
      "",
    );
    const b = computeRequestId(
      SENDER,
      { tag: "EvmType2TxParams", value: sampleEvmType2Params },
      CAIP2_ID,
      KEY_VERSION,
      PATH,
      "ECDSA",
      "ethereum",
      "",
    );
    expect(a).toBe(b);
  });

  it("changes with different sender (operator set)", () => {
    const a = computeRequestId(
      "operatorSetA",
      { tag: "EvmType2TxParams", value: sampleEvmType2Params },
      CAIP2_ID,
      KEY_VERSION,
      PATH,
      "ECDSA",
      "ethereum",
      "",
    );
    const b = computeRequestId(
      "operatorSetB",
      { tag: "EvmType2TxParams", value: sampleEvmType2Params },
      CAIP2_ID,
      KEY_VERSION,
      PATH,
      "ECDSA",
      "ethereum",
      "",
    );
    expect(a).not.toBe(b);
  });

  it("changes with different params", () => {
    const a = computeRequestId(
      SENDER,
      { tag: "EvmType2TxParams", value: sampleEvmType2Params },
      CAIP2_ID,
      KEY_VERSION,
      PATH,
      "ECDSA",
      "ethereum",
      "params-a",
    );
    const b = computeRequestId(
      SENDER,
      { tag: "EvmType2TxParams", value: sampleEvmType2Params },
      CAIP2_ID,
      KEY_VERSION,
      PATH,
      "ECDSA",
      "ethereum",
      "params-b",
    );
    expect(a).not.toBe(b);
  });

  it("changes with different keyVersion", () => {
    const a = computeRequestId(
      SENDER,
      { tag: "EvmType2TxParams", value: sampleEvmType2Params },
      CAIP2_ID,
      1,
      PATH,
      "ECDSA",
      "ethereum",
      "",
    );
    const b = computeRequestId(
      SENDER,
      { tag: "EvmType2TxParams", value: sampleEvmType2Params },
      CAIP2_ID,
      256,
      PATH,
      "ECDSA",
      "ethereum",
      "",
    );
    expect(a).not.toBe(b);
    expect(a).toBe(VECTORS.requestIdKv1);
    expect(b).toBe(VECTORS.requestIdKv256);
  });

  it("matches cross-language vector for keyVersion=0", () => {
    expect(
      computeRequestId(
        SENDER,
        { tag: "EvmType2TxParams", value: sampleEvmType2Params },
        CAIP2_ID,
        0,
        PATH,
        "ECDSA",
        "ethereum",
        "",
      ),
    ).toBe(VECTORS.requestIdKv0);
  });

  it("supports plain ETH transfers with empty calldata", () => {
    const a = computeRequestId(
      SENDER,
      { tag: "EvmType2TxParams", value: sampleEvmType2Params },
      CAIP2_ID,
      1,
      PATH,
      "ECDSA",
      "ethereum",
      "",
    );
    const b = computeRequestId(
      SENDER,
      { tag: "EvmType2TxParams", value: sampleEthTransferParams },
      CAIP2_ID,
      1,
      PATH,
      "ECDSA",
      "ethereum",
      "",
    );
    expect(a).not.toBe(b);
    expect(b).toBe(VECTORS.requestIdEthTransfer);
  });

  it("matches cross-language vector for access lists", () => {
    expect(
      computeRequestId(
        SENDER,
        { tag: "EvmType2TxParams", value: sampleAccessListParams },
        CAIP2_ID,
        KEY_VERSION,
        PATH,
        "ECDSA",
        "ethereum",
        "",
      ),
    ).toBe(VECTORS.requestIdAccessList);
  });

  it("matches cross-language vector for contract creation", () => {
    expect(
      computeRequestId(
        SENDER,
        { tag: "EvmType2TxParams", value: sampleContractCreationParams },
        CAIP2_ID,
        KEY_VERSION,
        PATH,
        "ECDSA",
        "ethereum",
        "",
      ),
    ).toBe(VECTORS.requestIdContractCreation);
  });
});

// ---------------------------------------------------------------------------
// computeResponseHash
// ---------------------------------------------------------------------------
describe("computeResponseHash", () => {
  it("matches cross-language vector (mpcOutput=01)", () => {
    expect(computeResponseHash(KNOWN_REQUEST_ID, "01")).toBe(VECTORS.responseHash01);
  });

  it("matches cross-language vector (empty mpcOutput)", () => {
    expect(computeResponseHash(KNOWN_REQUEST_ID, "")).toBe(VECTORS.responseHashEmpty);
  });

  it("is deterministic", () => {
    const a = computeResponseHash(KNOWN_REQUEST_ID, "01");
    const b = computeResponseHash(KNOWN_REQUEST_ID, "01");
    expect(a).toBe(b);
  });

  it("changes with different output", () => {
    const a = computeResponseHash(KNOWN_REQUEST_ID, "01");
    const b = computeResponseHash(KNOWN_REQUEST_ID, "00");
    expect(a).not.toBe(b);
  });
});
