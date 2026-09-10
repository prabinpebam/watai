const required = [
  'COSMOS_ENDPOINT',
  'COSMOS_DATABASE',
  'STORAGE_ACCOUNT',
  'MEDIA_CONTAINER',
] as const;

if (process.env.WATAI_INTEGRATION_TARGET !== 'isolated-stage') {
  throw new Error('Set WATAI_INTEGRATION_TARGET=isolated-stage for cloud integration tests.');
}

for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`Missing required integration setting: ${name}`);
}

if (process.env.COSMOS_DATABASE === 'watai') {
  throw new Error('Cloud integration tests cannot target the production/default Cosmos database.');
}

if (process.env.MEDIA_CONTAINER === 'media') {
  throw new Error('Cloud integration tests cannot target the production/default media container.');
}