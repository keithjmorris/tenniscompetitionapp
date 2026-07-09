// build-config.js
// Runs on Vercel (via `npm run build`) to generate js/firebase-config.js
// from environment variables set in the Vercel project settings.
//
// Locally, you don't run this â€” you just copy js/firebase-config.example.js
// to js/firebase-config.js and fill in real values by hand.

const fs = require('fs');
const path = require('path');

const config = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

const missing = Object.entries(config)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length) {
  console.warn(
    `Warning: missing Firebase environment variable(s): ${missing.join(', ')}. ` +
    'Set these in Vercel > Project Settings > Environment Variables.'
  );
}

const outPath = path.join(__dirname, 'js', 'firebase-config.js');
const fileContent =
  '// Auto-generated at build time by build-config.js. Do not edit directly, and do not commit.\n' +
  `export const firebaseConfig = ${JSON.stringify(config, null, 2)};\n`;

fs.writeFileSync(outPath, fileContent);
console.log(`Generated ${outPath}`);