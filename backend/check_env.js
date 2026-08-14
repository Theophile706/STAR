const dotenv = require('dotenv');
const result = dotenv.config({ path: './.env' });
console.log('config error=', result.error ? result.error.message : null);
console.log('loaded GEE_SERVICE_ACCOUNT_KEY=', typeof process.env.GEE_SERVICE_ACCOUNT_KEY \!== 'undefined');
console.log('length=', process.env.GEE_SERVICE_ACCOUNT_KEY ? process.env.GEE_SERVICE_ACCOUNT_KEY.length : 0);
console.log('startsWith={', process.env.GEE_SERVICE_ACCOUNT_KEY ? process.env.GEE_SERVICE_ACCOUNT_KEY.trim().startsWith('{') : null);
console.log('contains private key begin=', process.env.GEE_SERVICE_ACCOUNT_KEY ? process.env.GEE_SERVICE_ACCOUNT_KEY.includes('-----BEGIN PRIVATE KEY-----') : null);
console.log('preview=', process.env.GEE_SERVICE_ACCOUNT_KEY ? process.env.GEE_SERVICE_ACCOUNT_KEY.slice(0, 200) : null);
