import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Dev server settings
const host = '0.0.0.0'
const port = 5173

// Certificate lookup order:
// 1) DEV_HTTPS_CERT and DEV_HTTPS_KEY environment variables (absolute paths)
// 2) ./certs/dev-cert.pem and ./certs/dev-key.pem inside project
// 3) fallback to `https: true` (will use an ephemeral/self-signed cert and may be untrusted)

function loadCerts(){
  const envCert = process.env.DEV_HTTPS_CERT;
  const envKey = process.env.DEV_HTTPS_KEY;
  if(envCert && envKey && fs.existsSync(envCert) && fs.existsSync(envKey)){
    return { cert: fs.readFileSync(envCert), key: fs.readFileSync(envKey) };
  }
  const certDir = path.resolve(process.cwd(),'certs');
  const certPath = path.join(certDir,'dev-cert.pem');
  const keyPath = path.join(certDir,'dev-key.pem');
  if(fs.existsSync(certPath) && fs.existsSync(keyPath)){
    return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
  }
  // no certs found
  return null;
}

const certs = loadCerts();
let httpsOption = certs ? certs : true;
let extraPlugins = [react()];
if(!certs){
  // fallback: enable basicSsl plugin to generate a development certificate automatically
  try{
    extraPlugins.push(basicSsl());
    console.warn('[vite.config.js] No local dev certificates found — using @vitejs/plugin-basic-ssl fallback.');
    httpsOption = true;
  }catch(err){
    console.warn('\n[vite.config.js] No local dev certificates and plugin-basic-ssl failed.\nFalling back to https:true which may be untrusted in browsers.\n');
    httpsOption = true;
  }
}

export default defineConfig({
  plugins: extraPlugins,
  server: {
    host,
    port,
    https: httpsOption,
    // allow external access on LAN
    strictPort: false,
  }
})
