const { shopifyApi, LATEST_API_VERSION } = require('@shopify/shopify-api');
require('@shopify/shopify-api/adapters/node');
const dotenv = require('dotenv');
const { MemorySessionStorage } = require('@shopify/shopify-app-session-storage-memory');

dotenv.config();

const HOST = process.env.HOST || ''; // ex.: https://abc123.ngrok-free.app
const HOSTNAME = HOST.replace(/^https?:\/\//, ''); // shopifyApi espera sem protocolo

const shopify = shopifyApi({
  apiKey: process.env.SHOPIFY_API_KEY,          // do .env
  apiSecretKey: process.env.SHOPIFY_API_SECRET, // do .env
  scopes: (process.env.SHOPIFY_SCOPES || 'read_products').split(','),
  hostName: HOSTNAME,
  apiVersion: LATEST_API_VERSION,               // usa a versão estável atual
  isEmbeddedApp: false,                         // mude p/ true se for app embed
  sessionStorage: new MemorySessionStorage(),   // só p/ desenvolvimento
});

module.exports = { shopify };
