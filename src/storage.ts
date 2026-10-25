import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

// Local-disk storage for uploaded assets. Mount UPLOAD_DIR as a persistent volume in Docker.
// Keep the interface small so an S3-backed implementation can replace it later.
export interface Storage {
	put(key: string, data: Uint8Array): Promise<void>;
	get(key: string): Promise<Buffer | null>;
	remove(key: string): Promise<void>;
}

const ROOT = resolve(process.env.UPLOAD_DIR || "./uploads");

// Keys are generated server-side as "<tenantId>/<uuid>.<ext>"; anything else is rejected
const KEY_PATTERN = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg)$/;

const pathFor = (key: string) => {
	const path = resolve(ROOT, key);
	if (!KEY_PATTERN.test(key) || !path.startsWith(ROOT + sep)) {
		throw new Error(`Invalid storage key: ${key}`);
	}
	return path;
};

export const storageKey = (tenantId: string, ext: "png" | "jpg") =>
	`${tenantId}/${crypto.randomUUID()}.${ext}`;

export const storage: Storage = {
	async put(key, data) {
		const path = pathFor(key);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, data);
	},
	async get(key) {
		try {
			return await readFile(pathFor(key));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
			throw error;
		}
	},
	async remove(key) {
		await rm(pathFor(key), { force: true });
	},
};
