# BibleWebApp-V4

Bible Verse Display System.

Access is gated: [`index.html`](index.html) is a sign-in page, and the
application itself ships as [`app.enc`](app.enc), sealed with AES-256-GCM. The
key is released by Firebase only to an authenticated, allow-listed account.

**Edit [`src/app.html`](src/app.html), not `index.html`.** After every change:

```sh
node tools/encrypt-app.mjs     # re-seal into app.enc + manifest.json
node tools/selftest.mjs        # verify the gate can reopen it
```

Setup and administration: [SECURITY-SETUP.md](SECURITY-SETUP.md).

| | |
|---|---|
| `node tools/genkey.mjs` | create the master key (once) |
| `node tools/genkey.mjs --show` | print it again |
| `node tools/encrypt-app.mjs` | seal `src/app.html` → `app.enc` |
| `node tools/selftest.mjs` | prove `app.enc` opens with the shipped reader |
