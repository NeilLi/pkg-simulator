/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DB_PROXY_URL?: string;
  // Add other Vite environment variables here as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
