import 'dotenv/config';
console.log('present=', typeof process.env.GEE_SERVICE_ACCOUNT_KEY \!== 'undefined');
console.log('length=', process.env.GEE_SERVICE_ACCOUNT_KEY ? process.env.GEE_SERVICE_ACCOUNT_KEY.length : 0);
console.log('startsWith={', process.env.GEE_SERVICE_ACCOUNT_KEY?.trim().startsWith('{'));
console.log('contains private key begin=', process.env.GEE_SERVICE_ACCOUNT_KEY?.includes('-----BEGIN PRIVATE KEY-----'));
console.log('first 200 chars=', JSON.stringify(process.env.GEE_SERVICE_ACCOUNT_KEY?.slice(0, 200)));
