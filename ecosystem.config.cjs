module.exports = {
  apps: [{
    name: 'challenge-api',
    script: './server.js',
    cwd: '/root/challenge-api',
    instances: 4,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      WORKERS: 4
    },
    error_file: '/tmp/api-error.log',
    out_file: '/tmp/api-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    max_memory_restart: '500M'
  }]
};
