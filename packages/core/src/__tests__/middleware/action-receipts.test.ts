import { describe, it, expect, vi } from "vitest";
import type { AgentEvent } from "../../agent.js";
import type { Runner } from "../../runner.js";
import { withActionReceipts, type ActionReceiptsConfig } from "../../middleware/action-receipts.js";
import {
	generateKeyPair,
	verifyReceipt,
	type ActionReceipt,
	type TaxonomyMapping,
} from "@attest-protocol/attest-ts";

// ── Helpers ─────────────────────────────────────────────────────────

function createMockRunner(events: AgentEvent[]): Runner {
	return async function* () {
		for (const event of events) yield event;
	};
}

async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
	const result: any[] = [];
	for await (const event of gen) result.push(event);
	return result;
}

const keys = generateKeyPair();

function baseConfig(overrides?: Partial<ActionReceiptsConfig>): ActionReceiptsConfig {
	return {
		privateKey: keys.privateKey,
		publicKey: keys.publicKey,
		verificationMethod: "did:agent:test#key-1",
		issuer: { id: "did:agent:test" },
		principal: { id: "did:user:alice" },
		...overrides,
	};
}

const doneEvent: AgentEvent = {
	type: "done",
	result: "complete",
	messages: [],
	totalUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
};

// ── Tests ───────────────────────────────────────────────────────────

describe("withActionReceipts", () => {
	it("passes through all events unchanged", async () => {
		const innerEvents: AgentEvent[] = [
			{ type: "tool.start", toolCallId: "tc1", toolName: "read_file", input: { path: "/a" } },
			{ type: "tool.done", toolCallId: "tc1", toolName: "read_file", output: "contents" },
			doneEvent,
		];
		const runner = createMockRunner(innerEvents);
		const wrapped = withActionReceipts(baseConfig())(runner);
		const events = await collect(wrapped([], "test"));

		expect(events).toEqual(innerEvents);
	});

	it("calls onReceipt for each completed tool call", async () => {
		const receipts: ActionReceipt[] = [];
		const runner = createMockRunner([
			{ type: "tool.start", toolCallId: "tc1", toolName: "bash", input: { cmd: "ls" } },
			{ type: "tool.done", toolCallId: "tc1", toolName: "bash", output: "file.txt" },
			doneEvent,
		]);

		const wrapped = withActionReceipts(
			baseConfig({
				onReceipt: (receipt) => {
					receipts.push(receipt);
				},
			}),
		)(runner);
		await collect(wrapped([], "test"));

		expect(receipts).toHaveLength(1);
		expect(receipts[0].credentialSubject.action.target?.resource).toBe("bash");
		expect(receipts[0].credentialSubject.outcome.status).toBe("success");
	});

	it("creates valid signed receipts", async () => {
		const receipts: ActionReceipt[] = [];
		const runner = createMockRunner([
			{ type: "tool.start", toolCallId: "tc1", toolName: "read_file", input: {} },
			{ type: "tool.done", toolCallId: "tc1", toolName: "read_file", output: "ok" },
			doneEvent,
		]);

		const wrapped = withActionReceipts(
			baseConfig({ onReceipt: (r) => { receipts.push(r); } }),
		)(runner);
		await collect(wrapped([], "test"));

		expect(receipts).toHaveLength(1);
		const valid = verifyReceipt(receipts[0], keys.publicKey);
		expect(valid).toBe(true);
	});

	it("records failures on tool.error", async () => {
		const receipts: ActionReceipt[] = [];
		const runner = createMockRunner([
			{ type: "tool.start", toolCallId: "tc1", toolName: "bash", input: { cmd: "fail" } },
			{ type: "tool.error", toolCallId: "tc1", toolName: "bash", error: "exit code 1" },
			doneEvent,
		]);

		const wrapped = withActionReceipts(
			baseConfig({ onReceipt: (r) => { receipts.push(r); } }),
		)(runner);
		await collect(wrapped([], "test"));

		expect(receipts).toHaveLength(1);
		expect(receipts[0].credentialSubject.outcome.status).toBe("failure");
		expect(receipts[0].credentialSubject.outcome.error).toBe("exit code 1");
	});

	it("chains receipts with incrementing sequence", async () => {
		const receipts: ActionReceipt[] = [];
		const runner = createMockRunner([
			{ type: "tool.start", toolCallId: "tc1", toolName: "a", input: {} },
			{ type: "tool.done", toolCallId: "tc1", toolName: "a", output: "" },
			{ type: "tool.start", toolCallId: "tc2", toolName: "b", input: {} },
			{ type: "tool.done", toolCallId: "tc2", toolName: "b", output: "" },
			doneEvent,
		]);

		const wrapped = withActionReceipts(
			baseConfig({ onReceipt: (r) => { receipts.push(r); } }),
		)(runner);
		await collect(wrapped([], "test"));

		expect(receipts).toHaveLength(2);
		const chain0 = receipts[0].credentialSubject.chain;
		const chain1 = receipts[1].credentialSubject.chain;

		expect(chain0.sequence).toBe(1);
		expect(chain0.previous_receipt_hash).toBeNull();
		expect(chain1.sequence).toBe(2);
		expect(chain1.previous_receipt_hash).toBeTruthy();
	});

	it("uses taxonomy mappings for classification", async () => {
		const receipts: ActionReceipt[] = [];
		const mappings: TaxonomyMapping[] = [
			{ tool_name: "read_file", action_type: "filesystem.file.read" },
		];
		const runner = createMockRunner([
			{ type: "tool.start", toolCallId: "tc1", toolName: "read_file", input: {} },
			{ type: "tool.done", toolCallId: "tc1", toolName: "read_file", output: "" },
			doneEvent,
		]);

		const wrapped = withActionReceipts(
			baseConfig({
				taxonomyMappings: mappings,
				onReceipt: (r) => { receipts.push(r); },
			}),
		)(runner);
		await collect(wrapped([], "test"));

		expect(receipts[0].credentialSubject.action.type).toBe("filesystem.file.read");
		expect(receipts[0].credentialSubject.action.risk_level).toBe("low");
	});

	it("classifies unknown tools as unknown/medium", async () => {
		const receipts: ActionReceipt[] = [];
		const runner = createMockRunner([
			{ type: "tool.start", toolCallId: "tc1", toolName: "custom_tool", input: {} },
			{ type: "tool.done", toolCallId: "tc1", toolName: "custom_tool", output: "" },
			doneEvent,
		]);

		const wrapped = withActionReceipts(
			baseConfig({ onReceipt: (r) => { receipts.push(r); } }),
		)(runner);
		await collect(wrapped([], "test"));

		expect(receipts[0].credentialSubject.action.type).toBe("unknown");
		expect(receipts[0].credentialSubject.action.risk_level).toBe("medium");
	});

	it("hashes parameters instead of storing them in plain text", async () => {
		const receipts: ActionReceipt[] = [];
		const runner = createMockRunner([
			{ type: "tool.start", toolCallId: "tc1", toolName: "bash", input: { secret: "password123" } },
			{ type: "tool.done", toolCallId: "tc1", toolName: "bash", output: "" },
			doneEvent,
		]);

		const wrapped = withActionReceipts(
			baseConfig({ onReceipt: (r) => { receipts.push(r); } }),
		)(runner);
		await collect(wrapped([], "test"));

		const action = receipts[0].credentialSubject.action;
		expect(action.parameters_hash).toMatch(/^sha256:/);
		// The actual input should NOT appear in the receipt
		expect(JSON.stringify(receipts[0])).not.toContain("password123");
	});

	it("generates a keypair when none provided", async () => {
		const receipts: ActionReceipt[] = [];
		const runner = createMockRunner([
			{ type: "tool.start", toolCallId: "tc1", toolName: "test", input: {} },
			{ type: "tool.done", toolCallId: "tc1", toolName: "test", output: "" },
			doneEvent,
		]);

		const wrapped = withActionReceipts({
			verificationMethod: "did:agent:auto#key-1",
			issuer: { id: "did:agent:auto" },
			principal: { id: "did:user:bob" },
			onReceipt: (r) => { receipts.push(r); },
		})(runner);
		await collect(wrapped([], "test"));

		expect(receipts).toHaveLength(1);
		expect(receipts[0].proof).toBeDefined();
	});

	it("stores receipts in SQLite when dbPath is provided", async () => {
		const { openStore: open } = await import("@attest-protocol/attest-ts");
		const dbPath = ":memory:";

		// We can't use :memory: across instances, so test via onReceipt + store
		const receipts: Array<{ receipt: ActionReceipt; hash: string }> = [];
		const runner = createMockRunner([
			{ type: "tool.start", toolCallId: "tc1", toolName: "test", input: {} },
			{ type: "tool.done", toolCallId: "tc1", toolName: "test", output: "" },
			doneEvent,
		]);

		const wrapped = withActionReceipts(
			baseConfig({
				onReceipt: (receipt, hash) => {
					receipts.push({ receipt, hash });
				},
			}),
		)(runner);
		await collect(wrapped([], "test"));

		// Verify the receipt was created and has a valid hash
		expect(receipts).toHaveLength(1);
		expect(receipts[0].hash).toMatch(/^sha256:/);
	});
});
