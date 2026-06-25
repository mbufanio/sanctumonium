/// <reference types="vite/client" />

declare module "*.css";

interface ImportMetaEnv {
  /** Base URL of the hosted leaderboard API. Empty → localStorage demo board. */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
