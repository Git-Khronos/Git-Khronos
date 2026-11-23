import { CSP_NONCE } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { StartupComponent } from './app/startup.component';

// Tauri adds a per-response nonce to the initial HTML styles. Once a nonce is
// present in style-src, browsers ignore unsafe-inline for style elements. Give
// Angular that same nonce so runtime component (including lazy) styles can load.
const styleNonce = document.querySelector<HTMLStyleElement>('style[nonce]')?.nonce ?? null;

bootstrapApplication(StartupComponent, {
  providers: [{ provide: CSP_NONCE, useValue: styleNonce }],
}).catch((error: unknown) => console.error(error));
