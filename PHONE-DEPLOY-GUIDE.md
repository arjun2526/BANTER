# BANTER — phone-only GitHub setup

## Important hosting boundary

This repository contains a full-stack TanStack Start app (server routes, Better Auth and PostgreSQL access). GitHub Pages only serves static files. It cannot run the app's server, authentication endpoints or PostgreSQL queries. GitHub also says Pages is not intended to host a SaaS service. The `docs/` folder is therefore a transparent project-preview page only; it does not provide login or messaging.

The GitHub Pages workflow publishes `docs/` only. To launch the real app, deploy the full-stack app to a server-capable host and connect it to PostgreSQL. The current Vite/Nitro configuration targets Vercel; do not point GitHub Pages at the project root and expect the app to work.

## A. Create the public repository on your phone

1. Open https://github.com in Chrome and sign in.
2. Tap **+** → **New repository**.
3. Repository name: `banter`.
4. Choose **Public**.
5. Do not add a README, .gitignore or license (this package already contains project files).
6. Tap **Create repository**.

## B. Upload the project from Android using Termux

1. Download `BANTER-GitHub-Ready.zip` from the ChatGPT conversation to your phone's Downloads folder.
2. Install/open Termux from its official F-Droid or GitHub distribution. Do not use an untrusted APK mirror.
3. In Termux, run:

```sh
pkg update -y
pkg install git unzip -y
termux-setup-storage
cd ~/storage/downloads
unzip BANTER-GitHub-Ready.zip
cd BANTER-GitHub-Ready
```

4. Replace `YOUR_GITHUB_USERNAME` below with your own GitHub username:

```sh
git init -b main
git config user.name "Your Name"
git config user.email "YOUR_GITHUB_NOREPLY_EMAIL"
git add .
git commit -m "Prepare BANTER project"
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/banter.git
git push -u origin main
```

5. If Git asks for a password, GitHub does not accept your account password for Git HTTPS. Create a fine-grained Personal Access Token in GitHub settings with access limited to this repository and **Contents: Read and write**. Set an expiry, keep it private, and paste it only into the Termux password prompt. Never send it in chat or commit it to the repository.

## C. Turn on the GitHub Pages project preview

1. Open your `banter` repository on GitHub.
2. Go to **Settings** → **Pages**.
3. Under **Build and deployment**, choose **GitHub Actions** as the source.
4. Go to the **Actions** tab. If the workflow has not started, open **Deploy BANTER project preview to GitHub Pages** and tap **Run workflow**.
5. Wait until the workflow finishes with a green check.
6. Return to **Settings** → **Pages**. GitHub displays the published URL. For a repository called `banter`, it will normally be `https://YOUR_GITHUB_USERNAME.github.io/banter/`.

## D. PostgreSQL and the real app

- Create a PostgreSQL database with a provider that supports your chosen full-stack host.
- Add `DATABASE_URL`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` only in the server host's secret/environment settings.
- Never put database URLs, database passwords or Better Auth secrets in `docs/`, browser JavaScript, GitHub Pages files or committed `.env` files.
- Run the SQL migrations against the production database using the project's migration command from a server-capable deployment environment.
- Test account creation, login, access controls and message privacy before inviting users.

## E. What the GitHub Pages URL does and does not do

It displays the static BANTER project-preview page from `docs/index.html`. It does not run login, chat, calls, file uploads or PostgreSQL. The real messaging application needs a separate server-capable deployment. Do not collect real phone numbers or messages on this preview page.
