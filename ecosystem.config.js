module.exports = {
	apps: [
		{
			name: "server",
			script: "./src/index.js",
			interpreter: "bun",
			// One process: PM2 cluster mode is unreliable with Bun, and the in-memory
			// rate limiter is per process, so more instances would loosen the limits.
			instances: 1,
			exec_mode: "fork",
			autorestart: true,
			watch: false,
			env: {
				NODE_ENV: "development",
				PORT: 5000,
			},
			env_production: {
				NODE_ENV: "production",
				PORT: 5000,
			},
		},
	],
};
