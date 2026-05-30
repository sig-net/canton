/**
 * Type-safe Canton JSON Ledger API v2 client.
 *
 * Uses {@link https://openapi-ts.dev/openapi-fetch/ openapi-fetch} with generated
 * OpenAPI types for compile-time request/response validation against the Canton
 * {@link https://docs.digitalasset.com/build/3.4/explanations/json-api/index.html JSON Ledger API v2}.
 *
 * All JSON endpoints use the typed `client` instance. Binary endpoints (DAR upload)
 * use raw `fetch` since openapi-fetch only handles JSON bodies.
 *
 * @module
 */

import createClient from "openapi-fetch";
import type { paths, components } from "../../generated/api/ledger-api.js";

/** Default base URL for the Canton JSON Ledger API. */
const DEFAULT_BASE_URL = "http://localhost:7575";

/** A single contract creation event returned inside a transaction. */
export type CreatedEvent = components["schemas"]["CreatedEvent"];
/** A ledger event — a {@link CreatedEvent}, an ArchivedEvent, or an ExercisedEvent. */
export type Event = components["schemas"]["Event"];
/** A single user right record from the user-management API. */
export type UserRight = components["schemas"]["Right"];
/** A ledger command (CreateCommand, ExerciseCommand, etc.) sent to the participant. */
type Command = components["schemas"]["Command"];
/** A disclosed contract payload for command submission. */
export type DisclosedContract = components["schemas"]["DisclosedContract"];
/** Response from `POST /v2/commands/submit-and-wait-for-transaction`. */
export type TransactionResponse = components["schemas"]["JsSubmitAndWaitForTransactionResponse"];
/** A single update item from the `POST /v2/updates` response. */
export type JsGetUpdatesResponse = components["schemas"]["JsGetUpdatesResponse"];

/** Throw on openapi-fetch error envelopes; otherwise unwrap the typed `data`. */
function unwrap<T>(op: string, result: { data?: T; error?: unknown }): T {
  if (result.error !== undefined) {
    throw new Error(`${op} failed: ${JSON.stringify(result.error)}`);
  }
  if (result.data === undefined) {
    throw new Error(`${op}: server returned no data`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Pure utility functions (no client dependency)
// ---------------------------------------------------------------------------

/**
 * Build a `CanActAs` right payload for a party.
 *
 * @param party - Fully-qualified party identifier.
 * @returns A {@link UserRight} granting `CanActAs` for the party.
 */
export function canActAsRight(party: string): UserRight {
  return { kind: { CanActAs: { value: { party } } } };
}

/**
 * Build a `CanReadAs` right payload for a party.
 *
 * @param party - Fully-qualified party identifier.
 * @returns A {@link UserRight} granting `CanReadAs` for the party.
 */
export function canReadAsRight(party: string): UserRight {
  return { kind: { CanReadAs: { value: { party } } } };
}

// ---------------------------------------------------------------------------
// CantonClient class
// ---------------------------------------------------------------------------

/** A contract from the active set paired with its synchronizer assignment. */
type ActiveContractEntry = {
  createdEvent: CreatedEvent;
  synchronizerId: string;
};

export class CantonClient {
  readonly baseUrl: string;
  private client: ReturnType<typeof createClient<paths>>;

  constructor(baseUrl = DEFAULT_BASE_URL) {
    this.baseUrl = baseUrl;
    this.client = createClient<paths>({ baseUrl });
  }

  // ---------------------------------------------------------------------------
  // Party & User management
  // ---------------------------------------------------------------------------

  /**
   * Allocate a new party on the Canton participant via `POST /v2/parties`.
   *
   * The participant generates a unique party identifier using `hint` as a
   * human-readable prefix (e.g. `"alice"` → `"alice::12209d…"`).
   * If the party already exists, falls back to listing all parties and
   * matching by the hint prefix.
   *
   * @param hint - Human-readable party-id prefix (e.g. `"alice"`).
   * @returns The fully-qualified party identifier.
   * @throws If allocation fails and no existing party matches.
   *
   * @see {@link https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html | POST /v2/parties}
   */
  async allocateParty(hint: string): Promise<string> {
    const result = await this.client.POST("/v2/parties", {
      body: {
        partyIdHint: hint,
        identityProviderId: "",
        synchronizerId: "",
        userId: "",
      },
    });
    if (result.error !== undefined) {
      const msg = JSON.stringify(result.error);
      if (msg.includes("Party already exists")) {
        const existing = await this.findPartyByHint(hint);
        if (existing) return existing;
      }
      throw new Error(`allocateParty failed: ${msg}`);
    }
    const party = result.data.partyDetails?.party;
    if (!party) throw new Error("allocateParty: unexpected empty response");
    return party;
  }

  /**
   * Search for an existing party whose identifier starts with `hint::`.
   *
   * Uses `GET /v2/parties` to list all known parties and prefix-matches.
   *
   * @param hint - The party-id prefix to search for.
   * @returns The full party identifier, or `undefined` if not found.
   */
  private async findPartyByHint(hint: string): Promise<string | undefined> {
    const { data } = await this.client.GET("/v2/parties");
    const match = data?.partyDetails?.find((p) => p.party.startsWith(`${hint}::`));
    return match?.party ?? undefined;
  }

  /**
   * Create a ledger API user with `CanActAs` and `CanReadAs` rights via `POST /v2/users`.
   *
   * Each party in `[primaryParty, ...additionalParties]` is granted both
   * `CanActAs` and `CanReadAs` rights. If the user already exists
   * (`USER_ALREADY_EXISTS`), the requested rights are granted to the existing user.
   *
   * @param userId - Unique user identifier (e.g. `"alice-user"`).
   * @param primaryParty - The user's primary party (fully-qualified).
   * @param additionalParties - Extra parties the user can act/read as.
   * @throws If user creation fails for reasons other than duplication.
   *
   * @see {@link https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html | POST /v2/users}
   */
  async createUser(
    userId: string,
    primaryParty: string,
    additionalParties: string[] = [],
  ): Promise<void> {
    const allParties = [primaryParty, ...additionalParties];
    const rights = allParties.flatMap((party): UserRight[] => [
      canActAsRight(party),
      canReadAsRight(party),
    ]);
    return this.createUserWithRights(userId, primaryParty, rights);
  }

  /**
   * Create a user with an explicit rights set via `POST /v2/users`.
   *
   * Use this when tests need strict least-privilege setups, e.g. a user that can
   * `CanActAs(requester)` and `CanReadAs(issuer)` but cannot `CanActAs(issuer)`.
   *
   * If the user already exists (`USER_ALREADY_EXISTS`), the requested rights are
   * granted to that existing user.
   *
   * @param userId - Unique user identifier (e.g. `"alice-user"`).
   * @param primaryParty - The user's primary party (fully-qualified).
   * @param rights - Array of {@link UserRight}s to grant (e.g. `CanActAs`, `CanReadAs`).
   * @throws If user creation fails for reasons other than duplication.
   *
   * @see {@link https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html | POST /v2/users}
   */
  async createUserWithRights(
    userId: string,
    primaryParty: string,
    rights: UserRight[],
  ): Promise<void> {
    const { error } = await this.client.POST("/v2/users", {
      body: {
        user: {
          id: userId,
          primaryParty,
          isDeactivated: false,
          identityProviderId: "",
        },
        rights,
      } as components["schemas"]["CreateUserRequest"],
    });
    if (error === undefined) return;
    const msg = JSON.stringify(error);
    if (msg.includes("USER_ALREADY_EXISTS")) {
      await this.grantUserRights(userId, rights);
      return;
    }
    throw new Error(`createUser failed: ${msg}`);
  }

  /**
   * Grant rights to an existing user via `POST /v2/users/{user-id}/rights`.
   *
   * The endpoint is idempotent for rights already present and reports only the
   * newly granted subset.
   */
  async grantUserRights(userId: string, rights: UserRight[]): Promise<UserRight[]> {
    const data = unwrap(
      "grantUserRights",
      await this.client.POST("/v2/users/{user-id}/rights", {
        params: { path: { "user-id": userId } },
        body: {
          userId,
          rights,
          identityProviderId: "",
        } as components["schemas"]["GrantUserRightsRequest"],
      }),
    );
    return data.newlyGrantedRights ?? [];
  }

  /**
   * List all rights currently granted to a user via `GET /v2/users/{user-id}/rights`.
   *
   * @param userId - The user whose rights to list.
   * @returns Array of {@link UserRight}s currently granted.
   * @throws On communication or server errors.
   *
   * @see {@link https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html | GET /v2/users/\{user-id\}/rights}
   */
  async listUserRights(userId: string): Promise<UserRight[]> {
    const data = unwrap(
      "listUserRights",
      await this.client.GET("/v2/users/{user-id}/rights", {
        params: { path: { "user-id": userId } },
      }),
    );
    return data.rights ?? [];
  }

  // ---------------------------------------------------------------------------
  // DAR upload — binary, kept as raw fetch (openapi-fetch is for JSON)
  // ---------------------------------------------------------------------------

  /**
   * Upload a DAR (Daml Archive) file to the participant via `POST /v2/dars`.
   *
   * Sends the file as raw bytes with `Content-Type: application/octet-stream`.
   * Uses native `fetch` instead of openapi-fetch because this endpoint accepts
   * binary — not JSON — request bodies. The `vetAllPackages=true` query param
   * ensures all packages in the DAR are vetted for use on upload.
   *
   * Silently succeeds when:
   * - The exact package version is already uploaded (`KNOWN_PACKAGE_VERSION`).
   * - The DAR is an incompatible upgrade (`NOT_VALID_UPGRADE_PACKAGE`).
   *
   * @param darPath - Absolute filesystem path to the `.dar` file.
   * @throws If the upload fails for reasons other than the above.
   *
   * @see {@link https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html | POST /v2/dars}
   */
  async uploadDar(darPath: string): Promise<void> {
    const fs = await import("node:fs");
    const darBytes = fs.readFileSync(darPath);
    const maxAttempts = 20;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await fetch(`${this.baseUrl}/v2/dars?vetAllPackages=true`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: darBytes,
      });
      if (res.ok) return;

      const text = await res.text();
      if (text.includes("KNOWN_PACKAGE_VERSION")) return;
      if (text.includes("NOT_VALID_UPGRADE_PACKAGE")) return;

      // Sandbox JSON API can come up before a synchronizer is fully connected.
      if (
        text.includes("PACKAGE_SERVICE_CANNOT_AUTODETECT_SYNCHRONIZER") &&
        attempt < maxAttempts
      ) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      throw new Error(`Upload DAR failed: ${res.status} ${text}`);
    }

    throw new Error(`Upload DAR failed after ${maxAttempts} attempts`);
  }

  // ---------------------------------------------------------------------------
  // Command submission
  // ---------------------------------------------------------------------------

  /**
   * Submit commands and synchronously wait for the resulting transaction
   * via `POST /v2/commands/submit-and-wait-for-transaction`.
   *
   * Wraps the provided commands in a {@link Command} array with a random
   * `commandId`, then blocks until the participant confirms the transaction.
   *
   * @param userId - Ledger API user submitting the commands.
   * @param actAs  - Parties the user is acting as (authorization scope).
   * @param commands - Array of ledger {@link Command}s: `CreateCommand`,
   *   `ExerciseCommand`, `CreateAndExerciseCommand`, or `ExerciseByKeyCommand`.
   *   See {@link https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html | JSON Ledger API OpenAPI reference}.
   * @param readAs  - Parties the user is reading as (defaults to `actAs`).
   * @param disclosedContracts - Disclosed contracts to include in the submission.
   * @returns The confirmed transaction including all resulting events.
   * @throws On command rejection or ledger errors (400 / `JsCantonError`).
   *
   * @see {@link https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html | POST /v2/commands/submit-and-wait-for-transaction}
   */
  private async submitAndWait(
    userId: string,
    actAs: string[],
    commands: Command[],
    readAs?: string[],
    disclosedContracts?: DisclosedContract[],
  ): Promise<TransactionResponse> {
    return unwrap(
      "submitAndWait",
      await this.client.POST("/v2/commands/submit-and-wait-for-transaction", {
        body: {
          commands: {
            commands,
            commandId: crypto.randomUUID(),
            userId,
            actAs,
            readAs: readAs ?? actAs,
            disclosedContracts,
          },
        } as components["schemas"]["JsSubmitAndWaitForTransactionRequest"],
      }),
    );
  }

  /**
   * Create a single contract on the ledger.
   *
   * Convenience wrapper around {@link submitAndWait} that builds a
   * `CreateCommand` from the given template ID and payload.
   *
   * @param userId    - Ledger API user submitting the command.
   * @param actAs     - Parties the user is acting as.
   * @param templateId - Fully-qualified Daml template identifier
   *   (e.g. `"Erc20Vault:Erc20Holding"`).
   * @param payload   - Template argument fields matching the Daml record.
   * @returns Transaction containing the {@link CreatedEvent} for the new contract.
   */
  async createContract(
    userId: string,
    actAs: string[],
    templateId: string,
    payload: Record<string, unknown>,
  ): Promise<TransactionResponse> {
    return this.submitAndWait(userId, actAs, [
      { CreateCommand: { templateId, createArguments: payload } },
    ]);
  }

  /**
   * Exercise a choice on an existing contract.
   *
   * Convenience wrapper around {@link submitAndWait} that builds an
   * `ExerciseCommand` targeting a specific contract by ID.
   *
   * @param userId         - Ledger API user submitting the command.
   * @param actAs          - Parties the user is acting as.
   * @param templateId     - Fully-qualified Daml template identifier.
   * @param contractId     - Contract ID of the target contract.
   * @param choice         - Name of the choice to exercise (e.g. `"Transfer"`).
   * @param choiceArgument - Choice argument fields matching the Daml record.
   * @param readAs - Parties the user is reading as (defaults to `actAs`).
   * @param disclosedContracts - Disclosed contracts to include in the submission.
   * @returns Transaction containing all events produced by the choice.
   */
  async exerciseChoice(
    userId: string,
    actAs: string[],
    templateId: string,
    contractId: string,
    choice: string,
    choiceArgument: Record<string, unknown>,
    readAs?: string[],
    disclosedContracts?: DisclosedContract[],
  ): Promise<TransactionResponse> {
    return this.submitAndWait(
      userId,
      actAs,
      [{ ExerciseCommand: { templateId, contractId, choice, choiceArgument } }],
      readAs,
      disclosedContracts,
    );
  }

  // ---------------------------------------------------------------------------
  // Ledger state & updates
  // ---------------------------------------------------------------------------

  /**
   * Get the current ledger end offset via `GET /v2/state/ledger-end`.
   *
   * The offset is a monotonically increasing number representing the latest
   * committed transaction position. Useful as the `beginExclusive` boundary
   * for {@link getUpdates} to avoid replaying historical transactions.
   *
   * @returns The current ledger-end offset.
   * @throws On communication errors.
   *
   * @see {@link https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html | GET /v2/state/ledger-end}
   */
  async getLedgerEnd(): Promise<number> {
    return unwrap("getLedgerEnd", await this.client.GET("/v2/state/ledger-end")).offset;
  }

  /**
   * Fetch ledger updates since a given offset via `POST /v2/updates`.
   *
   * This is a blocking HTTP call — the server holds the connection open
   * until either new updates arrive or `idleTimeoutMs` elapses. Suitable for
   * small result sets; the server returns `413 Content Too Large` if the
   * response exceeds its `http-list-max-elements-limit` configuration.
   *
   * For continuous streaming prefer the WebSocket transport in
   * {@link ../ledger-stream.ts | createLedgerStream}.
   *
   * @param beginExclusive - Offset to start from (exclusive). Use
   *   {@link getLedgerEnd} to get the current position.
   * @param parties - Parties whose visible updates should be included.
   * @param idleTimeoutMs - Server-side idle timeout in ms before the
   *   connection closes with an empty batch (default `2000`).
   * @returns Array of update items (transactions, reassignments, topology transactions, or offset checkpoints).
   * @throws On communication or server errors.
   *
   * @see {@link https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html | POST /v2/updates}
   */
  async getUpdates(
    beginExclusive: number,
    parties: string[],
    idleTimeoutMs = 2000,
  ): Promise<JsGetUpdatesResponse[]> {
    return unwrap(
      "getUpdates",
      await this.client.POST("/v2/updates", {
        params: { query: { stream_idle_timeout_ms: idleTimeoutMs } },
        body: {
          beginExclusive,
          // Use updateFormat (Canton 3.4+) — legacy filter/verbose removed in 3.5
          verbose: true, // required by TS types for backwards compat, ignored when updateFormat is set
          updateFormat: {
            includeTransactions: {
              transactionShape: "TRANSACTION_SHAPE_ACS_DELTA",
              eventFormat: {
                filtersByParty: Object.fromEntries(parties.map((p) => [p, {}])),
                verbose: true,
              },
            },
          },
        },
      }),
    );
  }

  /**
   * Shared implementation for querying active contracts via
   * `POST /v2/state/active-contracts`.
   *
   * Returns the {@link CreatedEvent} together with its `synchronizerId` so
   * callers that need the full {@link DisclosedContract} shape (which requires
   * `synchronizerId`) can build it without a redundant API call.
   *
   * @param parties - Parties whose visible contracts should be included.
   * @param templateId - Fully-qualified Daml template identifier.
   * @param includeCreatedEventBlob - Whether to request the opaque
   *   `createdEventBlob` on each {@link CreatedEvent}.
   * @returns Matching active contracts with their synchronizer IDs.
   */
  private async fetchActiveContracts(
    parties: string[],
    templateId: string,
    includeCreatedEventBlob: boolean,
  ): Promise<ActiveContractEntry[]> {
    const ledgerEnd = await this.getLedgerEnd();

    const partyFilter: components["schemas"]["Filters"] = {
      cumulative: [
        {
          identifierFilter: { TemplateFilter: { value: { templateId, includeCreatedEventBlob } } },
        },
      ],
    };

    const data = unwrap(
      "fetchActiveContracts",
      await this.client.POST("/v2/state/active-contracts", {
        body: {
          activeAtOffset: ledgerEnd,
          eventFormat: {
            filtersByParty: Object.fromEntries(parties.map((p) => [p, partyFilter])),
            verbose: true,
          },
        } as components["schemas"]["GetActiveContractsRequest"],
      }),
    );

    return data.flatMap((item) =>
      "JsActiveContract" in item.contractEntry
        ? [
            {
              createdEvent: item.contractEntry.JsActiveContract.createdEvent,
              synchronizerId: item.contractEntry.JsActiveContract.synchronizerId,
            },
          ]
        : [],
    );
  }

  /**
   * Query active contracts filtered by template ID via `POST /v2/state/active-contracts`.
   *
   * Returns all active (non-archived) contracts matching the given `templateId`
   * that are visible to at least one of the specified `parties`.
   *
   * @param parties - Parties whose visible contracts should be included.
   * @param templateId - Fully-qualified Daml template identifier
   *   (e.g. `"Erc20Vault:Erc20Holding"`).
   * @param includeCreatedEventBlob - Whether to include the `createdEventBlob`
   *   in each result (default `false`). Set to `true` when building
   *   {@link DisclosedContract} payloads.
   * @returns Array of {@link CreatedEvent}s for matching active contracts.
   * @throws On communication or server errors.
   *
   * @see {@link https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html | POST /v2/state/active-contracts}
   */
  async getActiveContracts(
    parties: string[],
    templateId: string,
    includeCreatedEventBlob = false,
  ): Promise<CreatedEvent[]> {
    const entries = await this.fetchActiveContracts(parties, templateId, includeCreatedEventBlob);
    return entries.map((e) => e.createdEvent);
  }

  /**
   * Fetch a disclosed-contract payload for a specific active contract.
   *
   * Finds a contract by ID within the active set and returns the structure
   * expected in command `disclosedContracts`.
   *
   * @param parties - Parties whose visible contracts should be searched.
   * @param templateId - Fully-qualified Daml template identifier
   *   (e.g. `"Erc20Vault:Erc20Holding"`).
   * @param contractId - Contract ID of the target contract.
   * @returns A {@link DisclosedContract} payload ready for command submission.
   * @throws If the contract is not found or is missing its `createdEventBlob`.
   *
   * @see {@link https://docs.digitalasset.com/build/3.4/reference/json-api/openapi.html | POST /v2/state/active-contracts}
   */
  async getDisclosedContract(
    parties: string[],
    templateId: string,
    contractId: string,
  ): Promise<DisclosedContract> {
    const entries = await this.fetchActiveContracts(parties, templateId, true);
    const entry = entries.find((e) => e.createdEvent.contractId === contractId);
    if (!entry) {
      throw new Error(
        `getDisclosedContract: contract ${contractId} (${templateId}) not found in active set`,
      );
    }
    const { createdEvent, synchronizerId } = entry;
    if (!createdEvent.createdEventBlob) {
      throw new Error(`getDisclosedContract: contract ${contractId} is missing createdEventBlob`);
    }
    return {
      templateId: createdEvent.templateId,
      contractId: createdEvent.contractId,
      createdEventBlob: createdEvent.createdEventBlob,
      synchronizerId,
    };
  }
}
