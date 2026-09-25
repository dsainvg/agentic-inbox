import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

async function loadModule() {
	const result = await build({
		absWorkingDir: process.cwd(),
		entryPoints: ["workers/lib/attachments.ts"],
		bundle: true,
		write: false,
		format: "esm",
		platform: "node",
		target: "es2022",
	});
	return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

function fakeDb() {
	const statements = [];
	return {
		statements,
		prepare(sql) {
			return {
				bind(...args) {
					statements.push({ sql, args });
					return { run: async () => undefined, all: async () => ({ results: [] }), first: async () => null };
				},
			};
		},
	};
}

test("uses Appwrite Storage when R2 is not bound", async () => {
	const { storeAttachments } = await loadModule();
	const previousFetch = globalThis.fetch;
	let request;
	globalThis.fetch = async (input, init) => {
		request = { input: String(input), init };
		return new Response(null, { status: 201 });
	};
	const db = fakeDb();
	try {
		const result = await storeAttachments({
			DB: db,
			APPWRITE_ENDPOINT: "https://appwrite.example/v1/",
			APPWRITE_PROJECT_ID: "project",
			APPWRITE_API_KEY: "server-key",
			APPWRITE_BUCKET_ID: "bucket",
		}, "a@example.com", "email-1", [{ filename: "note.txt", mimeType: "text/plain", content: new TextEncoder().encode("hello").buffer }]);
		assert.equal(result.length, 1);
		assert.equal(result[0].scanStatus, "available");
		assert.equal(request.input, "https://appwrite.example/v1/storage/buckets/bucket/files");
		assert.equal(request.init.headers["X-Appwrite-Project"], "project");
		assert.equal(request.init.headers["X-Appwrite-Key"], "server-key");
	} finally {
		globalThis.fetch = previousFetch;
	}
});

test("keeps mail storage usable when no attachment backend is configured", async () => {
	const { storeAttachments } = await loadModule();
	const result = await storeAttachments({ DB: fakeDb() }, "a@example.com", "email-1", [{ filename: "note.txt", mimeType: "text/plain", content: new TextEncoder().encode("hello").buffer }]);
	assert.deepEqual(result, []);
});
