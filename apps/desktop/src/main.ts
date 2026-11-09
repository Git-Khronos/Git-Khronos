import { CSP_NONCE } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';

// Tauri adds a per-response nonce to the initial HTML styles. Once a nonce is
// present in style-src, browsers ignore unsafe-inline for style elements. Give
// Angular that same nonce so runtime component (including lazy) styles can load.
const styleNonce = document.querySelector<HTMLStyleElement>('style[nonce]')?.nonce ?? null;

bootstrapApplication(AppComponent, {
  providers: [{ provide: CSP_NONCE, useValue: styleNonce }],
}).catch((error: unknown) => console.error(error));
