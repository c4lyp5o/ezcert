// server/src/index.ts
import { app } from "./app";
import { assertEncryptionConfigured } from "./crypto/pii";
import { logger } from "./logger";

// Without the key, participant data can't be stored or read; fail at boot, not at first check-in
try {
	assertEncryptionConfigured();
} catch (error) {
	logger.fatal((error as Error).message);
	await logger.flush();
	process.exit(1);
}

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
