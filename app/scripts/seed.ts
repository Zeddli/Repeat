import { deployDemo } from './deploy.js';
await deployDemo({ local: process.argv.includes('--local') });
