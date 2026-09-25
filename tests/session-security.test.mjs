import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const root = process.cwd();

async function loadSessionModule() {
	const result = await build({
		absWorkingDir: root,
		entryPoints: ["workers/lib/session.ts"],
		bundle: true,
		write: false,
		format: "esm",
		platform: "node",
		target: "es2022",
	});
	return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("rejects missing, short, and development session secrets", async () => {
	const { getSessionSecret } = await loadSessionModule();
	assert.throws(() => getSessionSecret({}), /SESSION_SECRET is not configured securely/);
	assert.throws(
		() => getSessionSecret({ SESSION_SECRET: "default_session_secret_change_me" }),
		/SESSION_SECRET is not configured securely/,
	);
	assert.throws(
		() => getSessionSecret({ SESSION_SECRET: "configured-secret" }),
		/SESSION_SECRET is not configured securely/,
	);
	assert.deepEqual(
		new TextDecoder().decode(getSessionSecret({ SESSION_SECRET: "configured-secret-012345678901234567890123" })),
		"configured-secret-012345678901234567890123",
	);
});
