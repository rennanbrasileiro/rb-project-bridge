'use strict';
const fs=require('node:fs');
const required=['electron/main.cjs','electron/preload.cjs','renderer/index.html','renderer/app.js','electron/services/base44-service.cjs','electron/services/github-service.cjs','electron/services/migration-service.cjs','.github/workflows/build.yml'];
for(const file of required){if(!fs.existsSync(file)){console.error(`Missing required file: ${file}`);process.exit(1);}}
console.log(`Smoke check passed: ${required.length} required files found.`);
