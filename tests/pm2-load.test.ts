import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// PM2 starts the app with `require(<script>)` (pm2/lib/ProcessContainerForkBun.js), not as an ES
// module entry. Bun refuses to require() a module whose top-level await really suspends, and the
// container crash-looped on exactly that. Load the entry the way PM2 does, in a separate process.
//
// It must be a real script file calling require(), like PM2's wrapper: `bun -e "require(...)"`
// takes a different path and does not reproduce the failure.
//
// The await only "really suspends" while a connection is being made, so this needs a database that
// answers. A tiny fake Postgres (startup + simple queries) does that without a real server.

const u32 = (n: number) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const message = (type: string, body: Buffer = Buffer.alloc(0)) =>
	Buffer.concat([Buffer.from(type), u32(body.length + 4), body]);
const READY = message("Z", Buffer.from("I"));

function fakePostgres() {
	return Bun.listen<{ started: boolean }>({
		hostname: "127.0.0.1",
		port: 0,
		socket: {
			open(socket) {
				socket.data = { started: false };
			},
			data(socket, chunk) {
				if (!socket.data.started) {
					socket.data.started = true; // StartupMessage -> AuthenticationOk + ReadyForQuery
					socket.write(Buffer.concat([message("R", u32(0)), READY]));
				} else if (chunk[0] === 0x51 /* Q: simple query */) {
					socket.write(Buffer.concat([message("C", Buffer.from("SELECT 1\0")), READY]));
				} else if (chunk[0] === 0x58 /* X: terminate */) {
					socket.end();
				}
			},
		},
	});
}

test("src/index.ts can be loaded with require(), as PM2 does", async () => {
	const server = fakePostgres();
	const entry = join(import.meta.dir, "..", "src", "index.ts");
	const dir = mkdtempSync(join(tmpdir(), "ezcert-pm2-"));
	const wrapper = join(dir, "wrapper.cjs");
	writeFileSync(wrapper, "require(process.env.pm_exec_path);"); // what ProcessContainerForkBun.js does
	const proc = Bun.spawn(["bun", wrapper], {
		env: {
			...process.env,
			pm_exec_path: entry,
			NODE_ENV: "development",
			LOG_LEVEL: "info",
			DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
			POSTGRES_URL: `postgres://u:p@127.0.0.1:${server.port}/none`,
			DB_SSL: "disable",
			PORT: "0",
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	let output = "";
	const read = async (stream: ReadableStream<Uint8Array>) => {
		for await (const chunk of stream) output += new TextDecoder().decode(chunk);
	};
	void read(proc.stdout);
	void read(proc.stderr);

	try {
		const deadline = Date.now() + 15000;
		while (Date.now() < deadline && !/Backend running|async module|Failed to connect/.test(output))
			await Bun.sleep(50);
		expect(output).not.toContain("require() async module");
		expect(output).toContain("Connected to Postgres");
		expect(output).toContain("Backend running");
	} finally {
		proc.kill();
		await proc.exited;
		server.stop(true);
		rmSync(dir, { recursive: true, force: true });
	}
}, 30000);
