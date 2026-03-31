import type { ModelMessage } from "ai";
import type { AgentEvent } from "../agent.js";
import type { Middleware } from "../runner.js";

import {
	type ActionReceipt,
	type ClassificationResult,
	type Issuer,
	type Principal,
	type TaxonomyMapping,
	classifyToolCall,
	createReceipt,
	generateKeyPair,
	hashReceipt,
	openStore,
	sha256,
	signReceipt,
} from "@attest-protocol/attest-ts";

/**
 * Configuration for the action-receipts middleware.
 */
export interface ActionReceiptsConfig {
	/** Ed25519 PEM-encoded private key. If omitted a keypair is generated. */
	privateKey?: string;
	/** Public key (returned when a keypair is generated). */
	publicKey?: string;
	/** DID verification method, e.g. "did:agent:my-agent#key-1". */
	verificationMethod: string;
	/** Agent identity. */
	issuer: Issuer;
	/** Human / org that authorized the session. */
	principal: Principal;
	/** Path to SQLite database. Use ":memory:" for in-memory. Omit to skip storage. */
	dbPath?: string;
	/** Taxonomy mappings (from loadTaxonomyConfig). */
	taxonomyMappings?: TaxonomyMapping[];
	/** Optional callback fired after each receipt is created. */
	onReceipt?: (receipt: ActionReceipt, receiptHash: string) => void | Promise<void>;
}

interface PendingToolCall {
	toolName: string;
	input: unknown;
	startedAt: string;
}

/**
 * Middleware that emits cryptographically signed Action Receipts
 * for every tool call in the agent pipeline.
 *
 * Receipts follow the Attest Protocol (W3C Verifiable Credential format)
 * with Ed25519 signatures and SHA-256 hash chaining.
 */
export function withActionReceipts(config: ActionReceiptsConfig): Middleware {
	const keys = config.privateKey
		? { privateKey: config.privateKey, publicKey: config.publicKey ?? "" }
		: generateKeyPair();

	const store = config.dbPath ? openStore(config.dbPath) : undefined;
	const chainId = `chain_${crypto.randomUUID()}`;

	let sequence = 0;
	let previousReceiptHash: string | null = null;

	return (runner) =>
		async function* (
			history: ModelMessage[],
			input: string | ModelMessage[],
			options?: { signal?: AbortSignal },
		): AsyncGenerator<AgentEvent> {
			const pending = new Map<string, PendingToolCall>();

			for await (const event of runner(history, input, options)) {
				if (event.type === "tool.start") {
					pending.set(event.toolCallId, {
						toolName: event.toolName,
						input: event.input,
						startedAt: new Date().toISOString(),
					});
				}

				if (event.type === "tool.done" || event.type === "tool.error") {
					const call = pending.get(event.toolCallId);
					if (call) {
						pending.delete(event.toolCallId);

						const classification: ClassificationResult = classifyToolCall(
							call.toolName,
							config.taxonomyMappings,
						);

						sequence++;
						const parametersHash = call.input
							? sha256(JSON.stringify(call.input))
							: undefined;

						const unsigned = createReceipt({
							issuer: config.issuer,
							principal: config.principal,
							action: {
								type: classification.action_type,
								risk_level: classification.risk_level,
								target: { system: "openharness", resource: call.toolName },
								parameters_hash: parametersHash,
							},
							outcome:
								event.type === "tool.done"
									? { status: "success" }
									: { status: "failure", error: event.error },
							chain: {
								sequence,
								previous_receipt_hash: previousReceiptHash,
								chain_id: chainId,
							},
							actionTimestamp: call.startedAt,
						});

						const signed = signReceipt(
							unsigned,
							keys.privateKey,
							config.verificationMethod,
						);
						const receiptHash = hashReceipt(signed);

						previousReceiptHash = receiptHash;

						if (store) {
							store.insert(signed, receiptHash);
						}

						if (config.onReceipt) {
							await config.onReceipt(signed, receiptHash);
						}
					}
				}

				yield event;
			}
		};
}
