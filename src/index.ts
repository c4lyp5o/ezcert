// server/src/index.ts
import { app } from "./app";
import { assertEncryptionConfigured } from "./crypto/pii";
import { logger } from "./logger";

// Without the key, participant data can't be stored or read; fail at boot, not at first check-in.
// No top-level await in this file: PM2's Bun wrapper loads it with require(), which rejects async modules.
function encryptionReady(): boolean {
	try {
		assertEncryptionConfigured();
		return true;
	} catch (error) {
		logger.fatal((error as Error).message);
		void logger.flush().finally(() => process.exit(1));
		return false;
	}
}

if (encryptionReady()) {
	const PORT = process.env.PORT || 5000;

	process.on("unhandledRejection", (reason) =>
		logger.error("Unhandled promise rejection", reason),
	);

	// Largest legitimate body is a 10MB PPTX upload; reject anything bigger before parsing
	const MAX_REQUEST_BODY_BYTES = 12 * 1024 * 1024;

	app.listen({ port: PORT, maxRequestBodySize: MAX_REQUEST_BODY_BYTES });

	logger.success(
		`🦊 Backend running at ${app.server?.url} (${process.env.NODE_ENV ?? "development"})`,
	);
}
