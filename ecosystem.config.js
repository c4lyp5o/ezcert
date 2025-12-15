module.exports = {
	apps: [
		{
			name: "server",
			script: "./src/index.js",
			interpreter: "bun",
			instances: "max",
			exec_mode: "cluster",
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
