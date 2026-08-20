# Bible Verse Display System — access control

The app is no longer a single public file. It is now three pieces:

| File | What it is | Public? |
|---|---|---|
| `index.html` | The sign-in gate. Small. Contains no scripture and no passwords. | yes, harmless |
| `app.enc` | The whole application, sealed with AES-256-GCM. | yes, unreadable |
| `src/app.html` | The real, editable application. **Never committed.** | no — local only |

Anyone can download `app.enc`. Without the key it is 15 MB of noise, and the key
is only handed out by Google's servers to an account whose password Firebase has
verified and whose user id you have put on the allow-list by hand.

---

## One-time setup

### 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and click **Add project**.
2. Name it anything (`bible-display` is fine). Google Analytics: **off**.
3. On the project home page click the **`</>`** (Web) icon to register a web app.
   Nickname it `gate`. Do **not** tick Firebase Hosting — GitHub Pages still hosts the site.
4. Firebase shows you a `firebaseConfig` block. Copy the four values into the
   `CONFIG.firebase` block near the top of the `<script type="module">` in `index.html`:

   ```js
   apiKey:     "AIza...",
   authDomain: "bible-display.firebaseapp.com",
   projectId:  "bible-display",
   appId:      "1:123...:web:abc...",
   ```

   These are **public identifiers, not secrets.** They are meant to ship in the
   page. Security comes from the rules in step 4, never from hiding these.

### 2. Turn on password sign-in and close the door behind it

1. **Build → Authentication → Get started**.
2. **Sign-in method** tab → **Email/Password** → toggle **Enable** → Save.
   Leave *Email link (passwordless sign-in)* off.
3. **Settings** tab → **User actions** → **untick "Enable create (sign-up)"** → Save.

   Step 3 is the one that matters. Without it, anyone holding the public `apiKey`
   could register themselves an account. With it, accounts exist only if you make them.

### 3. Create the accounts

**Authentication → Users → Add user.** The gate asks for a *name*, not an e-mail,
and appends `@bibleapp.local` behind the scenes. So for a user called `pastor`:

- Email: `pastor@bibleapp.local`
- Password: something long. These are the only credentials that exist — make them real.

Repeat for each person. Then **copy each user's UID** (the long string in the
Users table) — you need it in the next step.

To use a different suffix, change `CONFIG.nameDomain` in `index.html` and create
the accounts to match.

### 4. Create the vault and the allow-list

**Build → Firestore Database → Create database → Production mode →** pick a region.

Then add two collections by hand:

**`vault`** — collection id `vault`, document id `app`, one field:

| Field | Type | Value |
|---|---|---|
| `k` | string | the base64 key printed by `node tools/genkey.mjs` |

**`allowlist`** — collection id `allowlist`, then **one document per person, whose
document id is that person's UID** from step 3. The contents don't matter; add a
field for your own reference:

| Field | Type | Value |
|---|---|---|
| `name` | string | `pastor` |

### 5. Publish the rules

**Firestore Database → Rules** tab. Replace everything with the contents of
[`firestore.rules`](firestore.rules) and click **Publish**.

This is the actual lock. It says: the vault key may be read only by a request
that Firebase has authenticated *and* whose uid has a document in `allowlist`.
Everything else in the database is refused.

### 6. Authorised domain

**Authentication → Settings → Authorized domains** → add `ifaulkner13.github.io`
if it isn't listed.

### 7. Build and publish

```sh
node tools/genkey.mjs            # once, if you haven't already
node tools/encrypt-app.mjs       # seals src/app.html into app.enc
git add index.html app.enc manifest.json .gitignore .gitattributes firestore.rules SECURITY-SETUP.md
git commit -m "Gate the app behind Firebase authentication"
git push
```

---

## Everyday use

**Editing the app.** Edit `src/app.html` exactly as you used to edit `index.html`.
Then:

```sh
node tools/encrypt-app.mjs
node tools/selftest.mjs          # optional but cheap: proves the gate can reopen it
git add app.enc manifest.json && git commit -m "..." && git push
```

If you forget to re-seal, the site keeps serving the previous version — it never
breaks, it just doesn't update.

**Adding a person.** Authentication → Add user, then add their UID to `allowlist`.

**Removing a person.** Delete their `allowlist` document. Access dies on their
next page load. To be thorough, also delete the user under Authentication.

**Rotating the key** (do this if `tools/.appkey` is ever exposed):

```sh
node tools/genkey.mjs --force
node tools/encrypt-app.mjs
```

then paste the new value into `vault/app.k` and push. Everyone keeps their same
password; the old `app.enc` becomes permanently unopenable.

---

## Two things to be honest about

**1. The old plaintext is still in this repository's git history.**

Every previous commit still contains the full unencrypted `index.html`, and
GitHub serves those commits publicly. Sealing today does not retroactively seal
yesterday. To actually close that gap, publish this as a clean repository:

```sh
git checkout --orphan sealed
git add -A
git commit -m "Bible Verse Display System, behind authentication"
git branch -M sealed main
git push --force origin main
```

That discards all previous history. Take a local backup of the folder first, and
re-check the Pages settings afterwards. Until you do this, treat the current
contents as already public.

**2. A signed-in user can still copy what they are shown.**

Once someone legitimately signs in, the app is decrypted in their browser and
they can save it. No browser-delivered content can prevent that — not here, not
anywhere. What this system does is control *who gets that far*, and let you
revoke a person instantly. That is the correct goal; anything promising more
would be lying.

---

## Limits worth knowing

- Firestore free tier: 50,000 reads/day. This uses **one** read per app open.
- GitHub Pages: 100 GB/month soft limit. At 15.6 MB per first load, roughly 6,500
  cold loads a month; repeat loads are served from the browser cache and cost nothing.
- The gate needs internet to sign in. Once signed in, the browser keeps the
  session, but the sealed payload still has to be fetched or cached.
- Requires a browser with `DecompressionStream`: Chrome/Edge 80+, Safari 16.4+,
  Firefox 113+. The gate says so plainly on anything older.
