import 'dotenv/config';
console.log('cwd=', process.cwd());
console.log('GEE_SERVICE_ACCOUNT_KEY present=', typeof process.env.GEE_SERVICE_ACCOUNT_KEY !== 'undefined');
console.log('GEE_SERVICE_ACCOUNT_KEY len=', process.env.GEE_SERVICE_ACCOUNT_KEY?.length ?? 'undefined');
console.log('startsWith VOTRE=', process.env.GEE_SERVICE_ACCOUNT_KEY?.trim().startsWith('VOTRE_'));
console.log('includes BEGIN PRIVATE KEY=', process.env.GEE_SERVICE_ACCOUNT_KEY?.includes('-----BEGIN PRIVATE KEY-----'));
console.log('prefix=', process.env.GEE_SERVICE_ACCOUNT_KEY?.slice(0, 80));
