/**
 * CC signature-fee client support.
 *
 * Before a deposit/withdrawal can be submitted, the requester must assemble the
 * inputs that `SignRequest.Execute` charges the CC fee with (see
 * `proposals/cc-signature-fee.md` §5 + §8):
 *
 * 1. {@link getCurrentFeeDisclosure} — read the current `SignerFeeConfig` (the
 *    sigNetwork-only fee contract) from sigNetwork's fee-disclosure endpoint.
 * 2. {@link getTransferFactoryForFee} — resolve the CC `TransferFactory` and its
 *    disclosures (`AmuletRules`, `OpenMiningRound`, the factory) from the
 *    token-standard registry.
 * 3. {@link selectInputHoldings} — pick the requester's Amulet `Holding`s that
 *    cover `feeAmount`, within the token-standard input cap.
 * 4. {@link assembleFeeChoiceArgs} — fold the three into the `Execute` choice
 *    arguments; the caller attaches the collected disclosures to the submission.
 *
 * The pure pieces (selection, window check, choice-arg assembly) are exercised
 * by the oracle suite; the two IO helpers take injectable transports so their
 * request-building and response-mapping are unit-tested without a live ledger or
 * registry. The exact registry wire shape mirrors Splice's reference transfer
 * CLI (`token-standard/cli/src/commands/transfer.ts`).
 *
 * @module
 */

import { parseUnits, formatUnits } from "viem";

import { SignerFeeConfig } from "@daml.js/daml-signer-0.0.1/lib/SignerFee/module.js";
import type { CreatedEvent, DisclosedContract } from "./infra/canton-client.js";

/** Daml `Decimal` is `Numeric 10`; Canton Coin (Amulet) amounts use scale 10. */
export const CC_DECIMALS = 10;

/**
 * Upper bound on `inputHoldingCids` for a single `TransferFactory_Transfer`
 * (token-standard cap, CIP-0056). Covering a fee with more inputs than this
 * means the requester must consolidate holdings first.
 */
export const MAX_TRANSFER_INPUTS = 100;

/** Token-standard transfer-factory registry path (Splice CIP-0056). */
export const TRANSFER_FACTORY_REGISTRY_PATH =
  "/registry/transfer-instruction/v1/transfer-factory";

/** Token-standard `Holding` interface id (package-name ref) for interface queries. */
export const HOLDING_INTERFACE_ID =
  "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding";

/**
 * Token-standard `ChoiceContext` (`Splice.Api.Token.MetadataV1`) as it travels
 * over the JSON Ledger API: a `TextMap` of opaque values. The client never
 * builds one — it forwards the `choiceContextData` the registry returns into the
 * `Execute` choice's `transferContext` argument. `{ values: {} }` is the empty
 * context (matches `emptyChoiceContext`).
 */
export type TransferChoiceContext = { values: Record<string, unknown> };

/** The empty token-standard choice context. */
export const EMPTY_TRANSFER_CONTEXT: TransferChoiceContext = { values: {} };

// ---------------------------------------------------------------------------
// Decimal helpers — exact scale-10 arithmetic via viem's parse/format units
// (battle-tested reference; never float math on CC amounts).
// ---------------------------------------------------------------------------

/** Parse a Daml `Decimal` string into a scale-10 fixed-point bigint. */
function toScaled(decimal: string): bigint {
  return parseUnits(decimal as `${number}`, CC_DECIMALS);
}

/** Render a scale-10 fixed-point bigint back to a Daml `Decimal` string. */
function fromScaled(scaled: bigint): string {
  return formatUnits(scaled, CC_DECIMALS);
}

// ---------------------------------------------------------------------------
// Holding selection (pure)
// ---------------------------------------------------------------------------

/** A candidate Amulet holding the requester can spend toward the fee. */
export interface HoldingInput {
  /** Contract id of the `Holding`. */
  contractId: string;
  /** Holding amount as a Daml `Decimal` string (from the `Holding` view). */
  amount: string;
  /** Locked holdings cannot fund a transfer; excluded from selection. */
  locked?: boolean;
}

/** Minimal shape of the token-standard `Holding` interface view we read. */
interface HoldingView {
  amount: string;
  lock?: unknown; // `Optional Lock` — non-null ⇒ locked
}

/**
 * Map interface-view `CreatedEvent`s (from
 * {@link CantonClient.getInterfaceContracts} for {@link HOLDING_INTERFACE_ID})
 * into {@link HoldingInput}s for {@link selectInputHoldings}. The amount and
 * lock come from the standard `Holding` view, so concrete token templates (e.g.
 * Amulet) need no special-casing.
 *
 * @throws If an event is missing its computed Holding view amount.
 */
export function holdingInputsFromEvents(events: CreatedEvent[]): HoldingInput[] {
  return events.map((ev) => {
    const view = ev.interfaceViews?.find((v) => v.viewValue != null)?.viewValue as
      | HoldingView
      | undefined;
    if (!view?.amount) {
      throw new Error(`holdingInputsFromEvents: missing Holding view amount for ${ev.contractId}`);
    }
    return { contractId: ev.contractId, amount: view.amount, locked: view.lock != null };
  });
}

/** The chosen holdings and the total CC they cover. */
export interface HoldingSelection {
  /** Contract ids to pass as `inputHoldingCids`. */
  inputHoldingCids: string[];
  /** Sum of the selected holdings, as a Daml `Decimal` string. */
  total: string;
}

/**
 * Select the requester's holdings that cover `feeAmount`.
 *
 * Greedy largest-first, so the fewest inputs are used (keeping under the
 * {@link MAX_TRANSFER_INPUTS} cap). Locked and non-positive holdings are
 * ignored. Fail-closed: throws if the unlocked balance cannot cover the fee, or
 * if covering it would exceed the input cap — mirroring how `Execute` would
 * abort, but surfaced client-side before submission.
 *
 * @param holdings - Candidate holdings (typically the requester's Amulet ACS).
 * @param feeAmount - The CC fee to cover, as a Daml `Decimal` string.
 * @param opts.maxInputs - Override the input cap (defaults to {@link MAX_TRANSFER_INPUTS}).
 * @returns The selected contract ids and their total.
 * @throws If the fee is negative, the balance is insufficient, or the cap is exceeded.
 */
export function selectInputHoldings(
  holdings: HoldingInput[],
  feeAmount: string,
  opts: { maxInputs?: number } = {},
): HoldingSelection {
  const maxInputs = opts.maxInputs ?? MAX_TRANSFER_INPUTS;
  const target = toScaled(feeAmount);
  if (target < 0n) {
    throw new Error(`selectInputHoldings: negative fee amount ${feeAmount}`);
  }

  const spendable = holdings
    .filter((h) => !h.locked)
    .map((h) => ({ contractId: h.contractId, scaled: toScaled(h.amount) }))
    .filter((h) => h.scaled > 0n)
    .sort((a, b) => (a.scaled < b.scaled ? 1 : a.scaled > b.scaled ? -1 : 0));

  const inputHoldingCids: string[] = [];
  let acc = 0n;
  for (const h of spendable) {
    if (acc >= target) break;
    inputHoldingCids.push(h.contractId);
    acc += h.scaled;
  }

  if (acc < target) {
    throw new Error(
      `selectInputHoldings: insufficient unlocked CC — need ${feeAmount}, ` +
        `have ${fromScaled(acc)} across ${spendable.length} holding(s)`,
    );
  }
  if (inputHoldingCids.length > maxInputs) {
    throw new Error(
      `selectInputHoldings: covering ${feeAmount} needs ${inputHoldingCids.length} ` +
        `inputs, over the ${maxInputs}-input transfer cap — consolidate holdings first`,
    );
  }
  return { inputHoldingCids, total: fromScaled(acc) };
}

// ---------------------------------------------------------------------------
// Fee-config disclosure (sigNetwork-only contract, served by sigNetwork)
// ---------------------------------------------------------------------------

/**
 * Decode a `SignerFeeConfig` createArgument using the generated Daml decoder
 * (the source-of-truth schema), throwing on any shape mismatch.
 */
export function parseFeeConfig(createArgument: unknown): SignerFeeConfig {
  return SignerFeeConfig.decoder.runWithException(createArgument);
}

/**
 * Whether `cfg`'s `[validFrom, validUntil]` window contains `nowMs`
 * (inclusive). `nowMs` is injected so the check is deterministic.
 */
export function isFeeConfigInWindow(cfg: SignerFeeConfig, nowMs: number): boolean {
  return nowMs >= Date.parse(cfg.validFrom) && nowMs <= Date.parse(cfg.validUntil);
}

/**
 * The subset of {@link CantonClient} the fee-disclosure endpoint needs.
 * Declared structurally so it can be stubbed in tests.
 */
export interface FeeLedgerReader {
  getActiveContracts(
    parties: string[],
    templateId: string,
    includeCreatedEventBlob?: boolean,
  ): Promise<CreatedEvent[]>;
  getDisclosedContract(
    parties: string[],
    templateId: string,
    contractId: string,
  ): Promise<DisclosedContract>;
}

/** The current fee config plus the disclosure payload to attach to a submission. */
export interface CurrentFeeDisclosure {
  /** Decoded `SignerFeeConfig` payload (`feeAmount`, `feeReceiver`, instrument…). */
  config: SignerFeeConfig;
  /** Contract id of the chosen `SignerFeeConfig` (the `feeConfigCid` choice arg). */
  contractId: string;
  /** Disclosure payload for command submission. */
  disclosure: DisclosedContract;
}

/**
 * Resolve the current `SignerFeeConfig` disclosure, as sigNetwork's
 * fee-disclosure endpoint does (§6.4). `SignerFeeConfig` is sigNetwork-only, so
 * the requester cannot read it from its own ACS — this runs under sigNetwork's
 * read authority and hands the requester the live envelope.
 *
 * Of the active configs for `sigNetwork`, picks the in-window one; if windows
 * overlap (a pre-published next config), the highest `version` wins.
 *
 * @param reader - A {@link CantonClient} (or stub) reading as sigNetwork.
 * @param sigNetwork - The sigNetwork party whose fee config to serve.
 * @param opts.nowMs - Override "now" for the window check (defaults to `Date.now()`).
 * @param opts.templateId - Override the `SignerFeeConfig` template id.
 * @throws If no in-window config exists for `sigNetwork`.
 */
export async function getCurrentFeeDisclosure(
  reader: FeeLedgerReader,
  sigNetwork: string,
  opts: { nowMs?: number; templateId?: string } = {},
): Promise<CurrentFeeDisclosure> {
  const templateId = opts.templateId ?? SignerFeeConfig.templateId;
  const nowMs = opts.nowMs ?? Date.now();

  const events = await reader.getActiveContracts([sigNetwork], templateId, true);
  const candidates = events
    .map((ev) => ({ ev, config: parseFeeConfig(ev.createArgument) }))
    .filter(({ config }) => config.sigNetwork === sigNetwork)
    .filter(({ config }) => isFeeConfigInWindow(config, nowMs))
    .sort((a, b) => (BigInt(a.config.version) < BigInt(b.config.version) ? 1 : -1));

  const chosen = candidates[0];
  if (!chosen) {
    throw new Error(
      `getCurrentFeeDisclosure: no in-window SignerFeeConfig for ${sigNetwork} ` +
        `at ${new Date(nowMs).toISOString()}`,
    );
  }
  const disclosure = await reader.getDisclosedContract(
    [sigNetwork],
    templateId,
    chosen.ev.contractId,
  );
  return { config: chosen.config, contractId: chosen.ev.contractId, disclosure };
}

// ---------------------------------------------------------------------------
// CC TransferFactory resolution (token-standard registry)
// ---------------------------------------------------------------------------

/** The CC transfer the fee charge will perform, used to resolve the factory. */
export interface FeeTransferDetails {
  /** The requester (transfer `sender`). */
  sender: string;
  /** Fee receiver (`SignerFeeConfig.feeReceiver`). */
  feeReceiver: string;
  /** CC instrument admin/DSO party (`SignerFeeConfig.instrumentAdmin`). */
  instrumentAdmin: string;
  /** CC instrument id (`SignerFeeConfig.instrumentId`, e.g. `"Amulet"`). */
  instrumentId: string;
  /** Fee amount, as a Daml `Decimal` string (`SignerFeeConfig.feeAmount`). */
  amount: string;
  /** The selected input holdings (from {@link selectInputHoldings}). */
  inputHoldingCids: string[];
}

/** The factory cid, choice context, and disclosures the registry returns. */
export interface ResolvedTransferFactory {
  /** The CC `TransferFactory` contract id (the `transferFactoryCid` choice arg). */
  transferFactoryCid: string;
  /** Registry `choiceContextData` → the `Execute` `transferContext` argument. */
  transferContext: TransferChoiceContext;
  /** Registry disclosures (factory, `AmuletRules`, `OpenMiningRound`) for the submission. */
  disclosedContracts: DisclosedContract[];
}

/** Raw transfer-factory registry response shape (Splice token-standard OpenAPI). */
interface TransferFactoryResponse {
  factoryId: string;
  transferKind?: string;
  choiceContext: {
    disclosedContracts: DisclosedContract[];
    choiceContextData: TransferChoiceContext;
  };
}

/**
 * Resolve the CC `TransferFactory` for the fee transfer via the token-standard
 * registry (`POST {registryUrl}{@link TRANSFER_FACTORY_REGISTRY_PATH}`).
 *
 * The request body mirrors Splice's reference transfer CLI: a `Transfer` record
 * inside `choiceArguments`, with an empty starting `extraArgs.context`. The
 * registry returns the factory id and a `choiceContext` whose `choiceContextData`
 * becomes the transfer's `extraArgs.context` (here surfaced as `transferContext`)
 * and whose `disclosedContracts` (factory, `AmuletRules`, `OpenMiningRound`) must
 * be attached to the submission.
 *
 * @remarks The exact instrument-admin attribution and any per-version request
 * fields must be confirmed against the target Splice version's live registry
 * (spec §13 Q3); `fetchImpl` is injectable so the mapping is unit-tested.
 *
 * @param registryUrl - Base URL of the CC instrument's token-standard registry.
 * @param details - The fee transfer to resolve a factory for.
 * @param opts.now - "Now" for `requestedAt`/`executeBefore` (defaults to `new Date()`).
 * @param opts.executeWithinMs - `executeBefore = now + this` (default 24h).
 * @param opts.reason - Human-readable transfer reason recorded in `meta`.
 * @param opts.excludeDebugFields - Ask the registry to omit debug fields (default `true`).
 * @param opts.fetchImpl - Injectable `fetch` (defaults to the global).
 * @throws If the registry returns a non-2xx response or an unparseable body.
 */
export async function getTransferFactoryForFee(
  registryUrl: string,
  details: FeeTransferDetails,
  opts: {
    now?: Date;
    executeWithinMs?: number;
    reason?: string;
    excludeDebugFields?: boolean;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<ResolvedTransferFactory> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? new Date();
  const executeWithinMs = opts.executeWithinMs ?? 24 * 60 * 60 * 1000;
  const requestedAt = now.toISOString();
  const executeBefore = new Date(now.getTime() + executeWithinMs).toISOString();

  const body = {
    choiceArguments: {
      expectedAdmin: details.instrumentAdmin,
      transfer: {
        sender: details.sender,
        receiver: details.feeReceiver,
        amount: details.amount,
        instrumentId: { admin: details.instrumentAdmin, id: details.instrumentId },
        lock: null,
        requestedAt,
        executeBefore,
        inputHoldingCids: details.inputHoldingCids,
        meta: {
          values: {
            "splice.lfdecentralizedtrust.org/reason":
              opts.reason ?? "sigNetwork CC signature fee",
          },
        },
      },
      extraArgs: {
        context: EMPTY_TRANSFER_CONTEXT,
        meta: { values: {} },
      },
    },
    excludeDebugFields: opts.excludeDebugFields ?? true,
  };

  const url = `${registryUrl}${TRANSFER_FACTORY_REGISTRY_PATH}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `getTransferFactoryForFee: registry ${url} returned ${res.status} ${await res.text()}`,
    );
  }
  const parsed = (await res.json()) as TransferFactoryResponse;
  if (!parsed?.factoryId || !parsed.choiceContext) {
    throw new Error(
      `getTransferFactoryForFee: malformed registry response ${JSON.stringify(parsed)}`,
    );
  }
  return {
    transferFactoryCid: parsed.factoryId,
    transferContext: parsed.choiceContext.choiceContextData,
    disclosedContracts: parsed.choiceContext.disclosedContracts ?? [],
  };
}

// ---------------------------------------------------------------------------
// Choice-arg assembly (pure)
// ---------------------------------------------------------------------------

/** The fee-related arguments threaded into `RequestDeposit` / `RequestWithdrawal`. */
export interface FeeChoiceArgs {
  feeConfigCid: string;
  transferFactoryCid: string;
  inputHoldingCids: string[];
  transferContext: TransferChoiceContext;
}

/**
 * Fold the three resolved inputs into the fee choice arguments that
 * `RequestDeposit` / `RequestWithdrawal` (and `Execute`) require.
 *
 * The matching disclosures — `fee.disclosure` plus `factory.disclosedContracts`
 * — must be attached to the submission's `disclosedContracts`; combine them with
 * {@link collectFeeDisclosures}.
 */
export function assembleFeeChoiceArgs(
  fee: CurrentFeeDisclosure,
  factory: ResolvedTransferFactory,
  selection: HoldingSelection,
): FeeChoiceArgs {
  return {
    feeConfigCid: fee.contractId,
    transferFactoryCid: factory.transferFactoryCid,
    inputHoldingCids: selection.inputHoldingCids,
    transferContext: factory.transferContext,
  };
}

/**
 * Collect every disclosure a fee-bearing submission must attach: the
 * `SignerFeeConfig` envelope and the registry's factory/rules/round disclosures.
 * The requester's own holdings need no disclosure (it is their stakeholder), but
 * extra disclosures can be appended via `extra`.
 */
export function collectFeeDisclosures(
  fee: CurrentFeeDisclosure,
  factory: ResolvedTransferFactory,
  extra: DisclosedContract[] = [],
): DisclosedContract[] {
  return [fee.disclosure, ...factory.disclosedContracts, ...extra];
}
