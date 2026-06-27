module.exports = {
  apps: [
    {
      name: 'uma-bot',
      script: 'dist/index.js',
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
      },
      // Restart on unhandled errors
      error_file: 'data/logs/pm2-error.log',
      out_file: 'data/logs/pm2-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
