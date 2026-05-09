import { describe, it, expect, beforeAll } from "vitest";
import { encodeAbiParameters, parseAbiParameters, type Hex } from "viem";
import {
  CantonClient,
  type CreatedEvent,
  type DisclosedContract,
  type CantonEvmType2Params,
  findCreated,
  firstCreated,
  deriveDepositAddress,
  deriveResponseVerificationPublicKey,
  signMpcResponse,
  toSpkiPublicKey,
  DAR_PATH,
  Signer,
  Vault,
  PendingDeposit,
  SignBidirectionalEvent,
  SignatureRespondedEvent,
  RespondBidirectionalEvent,
  Erc20Holding,
} from "canton-sig";
import { computeOperatorsHash } from "./helpers/e2e-setup.js";

const VAULT_ID = "test-vault";
const canton = new CantonClient();

const SIGNER_TEMPLATE = Signer.templateId;
const VAULT_TEMPLATE = Vault.templateId;
const PENDING_DEPOSIT_TEMPLATE = PendingDeposit.templateId;
const SIGN_EVENT_TEMPLATE = SignBidirectionalEvent.templateId;
const SIG_RESPONDED_TEMPLATE = SignatureRespondedEvent.templateId;
const RESPOND_BIDIR_TEMPLATE = RespondBidirectionalEvent.templateId;
const ERC20_HOLDING = Erc20Holding.templateId;

const MPC_ROOT_PRIVATE_KEY =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as Hex;
const MPC_ROOT_PUBLIC_KEY =
  "04bb50e2d89a4ed70663d080659fe0ad4b9bc3e06c17a227433966cb59ceee020decddbf6e00192011648d13b1c00af770c0c1bb609d4d3a5c98a43772e0e18ef4";

const KEY_VERSION = 1;
const ALGO = "ECDSA";
const DEST = "ethereum";
const ERC20_TRANSFER_SELECTOR = "a9059cbb";

function buildSampleEvmParams(vaultAddress: Hex): CantonEvmType2Params {
  const encodedArgs = encodeAbiParameters(parseAbiParameters("address, uint256"), [
    vaultAddress,
    100_000_000n,
  ]).slice(2);

  return {
    to: "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    calldata: `${ERC20_TRANSFER_SELECTOR}${encodedArgs}`,
    accessList: [],
    value: "0".repeat(64),
    nonce: "0".repeat(64),
    gasLimit: "0".repeat(64),
    maxFeePerGas: "0".repeat(64),
    maxPriorityFeePerGas: "0".repeat(64),
    chainId: "0".repeat(62) + "01",
  };
}

function hasContract(contracts: CreatedEvent[], cid: string): boolean {
  return contracts.some((c) => c.contractId === cid);
}

async function assertVisibility(
  templateId: string,
  contractId: string,
  visible: string[],
  notVisible: string[],
) {
  const checks = [...visible, ...notVisible].map(async (party) => {
    const contracts = await canton.getActiveContracts([party], templateId);
    return { party, found: hasContract(contracts, contractId) };
  });
  const results = await Promise.all(checks);
  for (const { party, found } of results) {
    if (visible.includes(party)) {
      expect(found, `${party} should see contract`).toBe(true);
    } else {
      expect(found, `${party} should NOT see contract`).toBe(false);
    }
  }
}

describe("ledger visibility + permission model", () => {
  const RUN_ID = Math.random().toString(36).slice(2, 8);
  const SIGNETWORK_USER = `signetwork-user-${RUN_ID}`;
  const OPERATOR_USER = `operator-user-${RUN_ID}`;
  const REQUESTER_USER = `requester-user-${RUN_ID}`;
  let sigNetwork: string;
  let operator: string;
  let requester: string;
  let signerCid: string;
  let vaultCid: string;
  let signerDisclosure: DisclosedContract;
  let vaultDisclosure: DisclosedContract;
  let vaultAddress: Hex;
  let predecessorId: string;

  beforeAll(async () => {
    await canton.uploadDar(DAR_PATH);

    sigNetwork = await canton.allocateParty(`SigNetPerm_${RUN_ID}`);
    operator = await canton.allocateParty(`OperatorPerm_${RUN_ID}`);
    requester = await canton.allocateParty(`RequesterPerm_${RUN_ID}`);

    await canton.createUser(SIGNETWORK_USER, sigNetwork);
    await canton.createUser(OPERATOR_USER, operator);
    await canton.createUser(REQUESTER_USER, requester);

    // predecessorId is operatorsHash; vaultId is folded into path by the Vault.
    predecessorId = computeOperatorsHash([operator]);
    vaultAddress = deriveDepositAddress(MPC_ROOT_PUBLIC_KEY, predecessorId, `${VAULT_ID},root`);

    // Create Signer (signatory: sigNetwork)
    const signerResult = await canton.createContract(
      SIGNETWORK_USER,
      [sigNetwork],
      SIGNER_TEMPLATE,
      {
        sigNetwork,
      },
    );
    signerCid = firstCreated(signerResult.transaction.events).contractId;
    signerDisclosure = await canton.getDisclosedContract([sigNetwork], SIGNER_TEMPLATE, signerCid);

    // Create Vault (signatory: operators=[operator])
    const responseVerificationPubKey = deriveResponseVerificationPublicKey(
      MPC_ROOT_PUBLIC_KEY,
      predecessorId,
      KEY_VERSION,
    );
    const mpcResponseVerifyKey = toSpkiPublicKey(responseVerificationPubKey);
    const vaultResult = await canton.createContract(OPERATOR_USER, [operator], VAULT_TEMPLATE, {
      operators: [operator],
      sigNetwork,
      evmVaultAddress: vaultAddress.slice(2).toLowerCase().padStart(64, "0"),
      mpcResponseVerifyKey,
      vaultId: VAULT_ID,
    });
    vaultCid = firstCreated(vaultResult.transaction.events).contractId;

    // Operator fetches the createdEventBlob and shares it off-chain with requesters
    vaultDisclosure = await canton.getDisclosedContract([operator], VAULT_TEMPLATE, vaultCid);
  }, 40_000);

  it("disclosure grants visibility without authorization", async () => {
    // Without disclosure, requester has no visibility into Vault
    await expect(
      canton.exerciseChoice(
        REQUESTER_USER,
        [requester],
        VAULT_TEMPLATE,
        vaultCid,
        "RequestDeposit",
        {
          requester,
          signerCid,
          path: requester,
          evmTxParams: buildSampleEvmParams(vaultAddress),
          keyVersion: KEY_VERSION,
          algo: ALGO,
          dest: DEST,
          params: "",
          outputDeserializationSchema: '[{"name":"","type":"bool"}]',
          respondSerializationSchema: '[{"name":"","type":"bool"}]',
        },
      ),
    ).rejects.toThrow();

    // With disclosure, requester can exercise RequestDeposit via the disclosed Vault.
    // (Vault contract is the disclosed entity; SignBidirectionalEvent is created internally
    //  through Signer.SignBidirectional → SignRequest.Execute, which the disclosed Signer
    //  enables. Both disclosures are required.)
    const depositResult = await canton.exerciseChoice(
      REQUESTER_USER,
      [requester],
      VAULT_TEMPLATE,
      vaultCid,
      "RequestDeposit",
      {
        requester,
        signerCid,
        path: requester,
        evmTxParams: buildSampleEvmParams(vaultAddress),
        keyVersion: KEY_VERSION,
        algo: ALGO,
        dest: DEST,
        params: "",
        outputDeserializationSchema: '[{"name":"","type":"bool"}]',
        respondSerializationSchema: '[{"name":"","type":"bool"}]',
      },
      undefined,
      [vaultDisclosure, signerDisclosure],
    );
    const pendingDeposit = findCreated(depositResult.transaction.events, "PendingDeposit");
    expect(pendingDeposit.contractId).toBeDefined();
  });

  it("full lifecycle: controller permissions and observer visibility", async () => {
    // -- Signer visibility: signatory=sigNetwork
    await assertVisibility(SIGNER_TEMPLATE, signerCid, [sigNetwork], [operator, requester]);

    // -- Vault visibility: signatory=operators, observer=sigNetwork
    await assertVisibility(VAULT_TEMPLATE, vaultCid, [operator, sigNetwork], [requester]);

    // -- Step 1: RequestDeposit (controller=requester)
    const evmTxParams = buildSampleEvmParams(vaultAddress);
    const pendingResult = await canton.exerciseChoice(
      REQUESTER_USER,
      [requester],
      VAULT_TEMPLATE,
      vaultCid,
      "RequestDeposit",
      {
        requester,
        signerCid,
        path: requester,
        evmTxParams,
        keyVersion: KEY_VERSION,
        algo: ALGO,
        dest: DEST,
        params: "",
        outputDeserializationSchema: '[{"name":"","type":"bool"}]',
        respondSerializationSchema: '[{"name":"","type":"bool"}]',
      },
      undefined,
      [vaultDisclosure, signerDisclosure],
    );
    const pending = findCreated(pendingResult.transaction.events, "PendingDeposit");
    const signEvent = findCreated(pendingResult.transaction.events, "SignBidirectionalEvent");
    const signEventCid = signEvent.contractId;
    const pendingCid = pending.contractId;
    const { requestId } = pending.createArgument as PendingDeposit;

    // PendingDeposit: signatory=operators, observer=requester,sigNetwork
    await assertVisibility(
      PENDING_DEPOSIT_TEMPLATE,
      pendingCid,
      [operator, requester, sigNetwork],
      [],
    );

    // -- Step 2: Respond (controller=sigNetwork) — creates SignatureRespondedEvent
    // Requester cannot exercise sigNetwork-controlled choices
    await expect(
      canton.exerciseChoice(
        REQUESTER_USER,
        [requester],
        SIGNER_TEMPLATE,
        signerCid,
        "Respond",
        {
          signEventCid,
          requestId,
          signature: { tag: "EcdsaSig", value: { der: "00", recoveryId: 0 } },
        },
        undefined,
        [signerDisclosure],
      ),
    ).rejects.toThrow();

    const signResult = await canton.exerciseChoice(
      SIGNETWORK_USER,
      [sigNetwork],
      SIGNER_TEMPLATE,
      signerCid,
      "Respond",
      {
        signEventCid,
        requestId,
        signature: { tag: "EcdsaSig", value: { der: "00", recoveryId: 0 } },
      },
    );
    const signatureRespondedEventCid = findCreated(
      signResult.transaction.events,
      "SignatureRespondedEvent",
    ).contractId;

    // SignatureRespondedEvent: signatory=sigNetwork, observer=operators,requester
    await assertVisibility(
      SIG_RESPONDED_TEMPLATE,
      signatureRespondedEventCid,
      [sigNetwork, operator, requester],
      [],
    );

    // -- Step 3: RespondBidirectional (controller=sigNetwork) — creates RespondBidirectionalEvent
    await expect(
      canton.exerciseChoice(
        REQUESTER_USER,
        [requester],
        SIGNER_TEMPLATE,
        signerCid,
        "RespondBidirectional",
        {
          signEventCid,
          requestId,
          signature: { tag: "EcdsaSig", value: { der: "00", recoveryId: 0 } },
          serializedOutput: "0000000000000000000000000000000000000000000000000000000000000001",
        },
        undefined,
        [signerDisclosure],
      ),
    ).rejects.toThrow();

    const mpcOutput = "0000000000000000000000000000000000000000000000000000000000000001";
    const mpcSignature = await signMpcResponse(
      MPC_ROOT_PRIVATE_KEY,
      predecessorId,
      requestId,
      mpcOutput,
      KEY_VERSION,
    );
    const outcomeResult = await canton.exerciseChoice(
      SIGNETWORK_USER,
      [sigNetwork],
      SIGNER_TEMPLATE,
      signerCid,
      "RespondBidirectional",
      {
        signEventCid,
        requestId,
        serializedOutput: mpcOutput,
        signature: mpcSignature,
      },
    );
    const respondBidirectionalEventCid = findCreated(
      outcomeResult.transaction.events,
      "RespondBidirectionalEvent",
    ).contractId;

    // RespondBidirectionalEvent: signatory=sigNetwork, observer=operators,requester
    await assertVisibility(
      RESPOND_BIDIR_TEMPLATE,
      respondBidirectionalEventCid,
      [sigNetwork, operator, requester],
      [],
    );

    // -- Step 4: ClaimDeposit (controller=requester)
    // Operator cannot claim (controller is requester, not operator)
    await expect(
      canton.exerciseChoice(OPERATOR_USER, [operator], VAULT_TEMPLATE, vaultCid, "ClaimDeposit", {
        requester,
        pendingDepositCid: pendingCid,
        respondBidirectionalEventCid,
        signatureRespondedEventCid,
      }),
    ).rejects.toThrow();

    // Requester claims via disclosure
    const claimResult = await canton.exerciseChoice(
      REQUESTER_USER,
      [requester],
      VAULT_TEMPLATE,
      vaultCid,
      "ClaimDeposit",
      {
        requester,
        pendingDepositCid: pendingCid,
        respondBidirectionalEventCid,
        signatureRespondedEventCid,
      },
      undefined,
      [vaultDisclosure],
    );
    const holding = findCreated(claimResult.transaction.events, "Erc20Holding");
    const holdingArgs = holding.createArgument as Erc20Holding;
    expect(holdingArgs.owner).toBe(requester);
    expect(holdingArgs.operators).toEqual([operator]);

    // Erc20Holding: signatory=operators, observer=owner(requester) — sigNetwork NOT observer
    await assertVisibility(ERC20_HOLDING, holding.contractId, [operator, requester], [sigNetwork]);

    // Evidence contracts must be archived after claim
    const remainingPending = await canton.getActiveContracts([operator], PENDING_DEPOSIT_TEMPLATE);
    expect(hasContract(remainingPending, pendingCid)).toBe(false);
    const remainingSignEvents = await canton.getActiveContracts([requester], SIGN_EVENT_TEMPLATE);
    expect(hasContract(remainingSignEvents, signEventCid)).toBe(false);
    const remainingSig = await canton.getActiveContracts([sigNetwork], SIG_RESPONDED_TEMPLATE);
    expect(hasContract(remainingSig, signatureRespondedEventCid)).toBe(false);
    const remainingOutcome = await canton.getActiveContracts([sigNetwork], RESPOND_BIDIR_TEMPLATE);
    expect(hasContract(remainingOutcome, respondBidirectionalEventCid)).toBe(false);
  }, 60_000);
});
