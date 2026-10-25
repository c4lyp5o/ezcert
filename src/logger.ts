import deadslog, { type LogLevel } from "deadslog";

const LOG_LEVELS: LogLevel[] = [
	"trace",
	"debug",
	"info",
	"success",
	"warn",
	"error",
	"fatal",
];
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_LOG_FILES = 5;

const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;
const logFilePath = process.env.LOG_FILE_PATH;

// LOG_LEVEL=silent turns logging off entirely (used by the test suite)
const silent = process.env.LOG_LEVEL === "silent";

export const logger = deadslog({
	minLevel: envLevel && LOG_LEVELS.includes(envLevel) ? envLevel : "info",
	consoleOutput: { enabled: !silent, coloredCoding: true },
	fileOutput: {
		enabled: !silent && !!logFilePath,
		logFilePath: logFilePath ?? null,
		rotate: true,
		maxLogSize: MAX_LOG_SIZE,
		maxLogFiles: MAX_LOG_FILES,
		onMaxLogFilesReached: "archiveOld",
	},
	formatter: (level, message) =>
		`[${new Date().toISOString()}] [${level}] ${message}`,
});

/** "jane.doe@example.com" → "ja***@example.com": enough to correlate, not enough to leak. */
export const maskEmail = (email: string) => {
	const [local, domain] = email.split("@");
	return domain ? `${local.slice(0, 2)}***@${domain}` : "***";
};

export default logger;
