# VantaVault GitHub Discovery and Community Plan

Status: planning document only. Nothing here changes repository settings, Discord, or the application until it is explicitly implemented.

## Goal

Make VantaVault easy to discover, understand, trust, install, discuss, and contribute to without spamming communities or presenting it as an official Riot product.

The useful funnel is:

`Search / shared link -> GitHub README -> release download -> successful install -> Discord or Discussions -> feedback / contribution`

Stars are helpful, but successful installs, returning users, useful reports, and contributors are better measures of whether this is working.

## Current position

### Already strong

- The README has real screenshots, feature descriptions, install instructions, privacy information, badges, and release links.
- Releases and an automated Windows build pipeline already exist.
- VantaVault has a recognizable name, logo, and a visually distinct application.
- Discord Rich Presence links directly to the latest VantaVault release and the community server.
- The project is open source and has a clear non-endorsement notice.

### Main gaps

- `valo-project` is a generic repository name and is weaker for search and link recognition than `VantaVault`.
- The repository does not currently have the basic community files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `SUPPORT.md`, issue forms, or a pull-request template.
- GitHub Discussions is not being used as the durable public knowledge base.
- The README's “What's new” section can become stale and should follow the latest release automatically or be kept deliberately current.
- There is no short demo clip that communicates the product in under a minute.
- Android is under development and must not be presented as available until an installable build is ready.

## Phase 1: Make the GitHub repository discoverable

These are repository settings, not code changes.

### Repository name

Consider renaming `valo-project` to `VantaVault` or `vantavault`. This is the clearest long-term name, but do it only as a controlled migration. Before renaming, audit updater URLs, release-download URLs, workflow references, badges, Discord Rich Presence, local remotes, and documentation. GitHub redirects many old URLs, but the updater should never depend on that assumption.

### About description

Suggested description while Android is not released:

> Private, open-source VALORANT companion for Windows — loadouts, storefront, match history, profiles, friends, parties, and live context.

Do not call it “official.” Add “Android in development” to the README or roadmap rather than the main description.

### Topics

Use a focused subset of GitHub's maximum 20 topics:

- `valorant`
- `valorant-companion`
- `riot-games`
- `gaming-tools`
- `match-history`
- `loadout-manager`
- `valorant-store`
- `tauri`
- `react`
- `nextjs`
- `golang`
- `windows`
- `open-source`
- `discord-rich-presence`

Add `android` and the chosen Android framework only when that version is genuinely usable. Topics improve discovery through GitHub search and topic pages. See [GitHub's repository topics documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics).

### Social preview

Upload a clean 1280×640 repository social-preview image. It should contain:

- VantaVault logo and name;
- one strong, readable app screenshot;
- a short line such as “Your private VALORANT companion”;
- no fake Riot branding and no dense feature list.

This is what people see when the repository is linked on Discord, Reddit, and other sites, so it matters more than a decorative README banner.

### GitHub features

Enable:

- Issues for verified bugs and scoped tasks;
- Discussions for support, ideas, questions, and community conversation;
- the repository's security-reporting path once `SECURITY.md` is ready.

GitHub recommends separating durable community conversation from issue tracking. See [enabling GitHub Discussions](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/enabling-features-for-your-repository/enabling-or-disabling-github-discussions-for-a-repository).

## Phase 2: Make the README convert visitors into users

The first screen should answer four questions immediately: what is it, why should I trust it, what does it look like, and where do I download it?

Recommended top actions, in this order:

1. **Download for Windows** — direct link to the latest release page.
2. **Join the Discord** — permanent invite, once created.
3. **Ask a question / suggest an idea** — GitHub Discussions.

Recommended README improvements:

- Add a 30–60 second compressed demo video or GIF showing one complete flow, not a montage of every screen.
- Put three real differentiators near the top: private/local-first behavior, all-in-one companion features, and open-source transparency.
- Keep the user installation path before developer build instructions.
- Add a compact trust section covering signed/reproducible release expectations, VirusTotal results, local data behavior, and exactly what credentials/tokens are or are not stored.
- Link “What's new” to the latest GitHub release or update it with every release. Do not leave old version numbers at the top of an active project.
- Label Android plainly as **in development** until users can install and use it.
- Keep the Riot non-endorsement notice visible but not so dominant that it obscures the product.

## Phase 3: Add the minimum healthy-project files

Create only files that will actually be maintained:

- `CONTRIBUTING.md` — local setup, build/test commands, branch/PR expectations, and “open an issue first” for large changes.
- `SECURITY.md` — private vulnerability-reporting route and an explicit warning not to post tokens, credentials, or unredacted logs publicly.
- `SUPPORT.md` — setup questions go to Discussions or Discord; reproducible product bugs go to Issues.
- `CODE_OF_CONDUCT.md` — a standard, maintained code of conduct such as Contributor Covenant.
- `.github/ISSUE_TEMPLATE/bug.yml` — app version, OS, reproduction steps, expected/actual behavior, sanitized logs, and screenshots.
- `.github/ISSUE_TEMPLATE/feature.yml` — problem, proposed behavior, alternatives, and affected platform.
- `.github/ISSUE_TEMPLATE/config.yml` — links to support, Discussions, Discord, and private security reporting.
- `.github/pull_request_template.md` — scope, screenshots for UI changes, tests, and linked issue.

GitHub surfaces contribution guidelines in the repository interface, so these are part of onboarding rather than paperwork. See [healthy contribution setup](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions) and [issue/PR templates](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/about-issue-and-pull-request-templates).

Useful initial labels:

- `bug`
- `feature`
- `android`
- `windows`
- `ui-ux`
- `backend`
- `documentation`
- `needs-reproduction`
- `good-first-issue`
- `help-wanted`
- `security` — never use this for unpatched vulnerability details

## Phase 4: Start a Discord that is useful when it is still small

Create a permanent invite owned by the VantaVault server, not a temporary personal invite. Start with a compact structure:

- `#start-here` — what VantaVault is, download link, GitHub link, safety notice;
- `#rules`;
- `#announcements`;
- `#releases` — release posts only;
- `#support` — setup and usage help;
- `#bug-reports` — points users to the GitHub bug form;
- `#ideas` — points durable proposals to GitHub Discussions;
- `#development`;
- `#android-progress`;
- `#off-topic`.

Minimal roles are enough: `Maintainer`, `Contributor`, and `Tester`. Avoid creating a large empty server, many decorative roles, or separate channels for every feature.

Use a GitHub integration or webhook for releases and important announcements only. Posting every commit creates noise and teaches members to mute the server.

Pin a safe support template asking for app version, operating system, reproduction steps, and sanitized logs. Tell users never to paste Riot tokens, cookies, passwords, machine secrets, or full credential files.

### GitHub Discussions categories

- **Announcements** — maintainer-only updates;
- **Help & Setup** — Q&A format so accepted answers become reusable documentation;
- **Ideas** — feature proposals and product discussion;
- **Android Development** — progress, testing, and platform-specific feedback.

Discord is the fast conversation layer; Discussions is the searchable, durable record. Important Discord answers should be promoted into documentation or a Discussion rather than disappearing in chat history.

## Discord Rich Presence and the community link

Use ordinary URL buttons, not Discord's game-session join mechanism.

The implemented presence buttons are:

1. `Download VantaVault` -> latest GitHub release;
2. `View on GitHub` -> VantaVault repository.

Alternatively, keep one button pointing to the repository if open-source visibility matters more than direct downloads. The presence should never use a fake lobby, party, or join secret merely to open a community server. Discord's native Join flow is designed for joining a game session, while Rich Presence URL buttons are appropriate for project and community links. See [Discord Rich Presence](https://docs.discord.com/developers/discord-social-sdk/development-guides/setting-rich-presence) and [game invite behavior](https://docs.discord.com/developers/discord-social-sdk/development-guides/managing-game-invites).

Rich Presence is a secondary path because it depends on the desktop Discord client and the application running. Put the same Discord link in the README, repository About area, release notes, and app Settings/About screen.

## Phase 5: Earn visibility without spam

### Every meaningful release

- Publish a clear GitHub Release with user-facing notes: Added, Improved, Fixed, and Known Issues.
- Include one current screenshot or short clip.
- Explain why the change matters instead of listing commit messages.
- Make the correct installer asset obvious.
- Post the same concise announcement in Discord and GitHub Discussions.

GitHub Releases provide stable downloadable assets and release history; download counts can also help measure adoption. See [About releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases).

### Community launch

After the install path and support flow are reliable:

- share a short, honest demo in VALORANT communities only where self-promotion rules allow it;
- ask moderators before posting in Discord servers that restrict promotion;
- clearly identify yourself as the developer;
- lead with the user problem and a real demo, not “please star my repo”;
- invite a small tester group before a broad launch;
- turn well-scoped work into `good-first-issue` tasks for contributors;
- submit to relevant maintained open-source/tool directories only when their rules allow the project.

Do not buy stars or members, mass-DM people, cross-post the same promotion everywhere, imitate Riot branding, hide unofficial API limitations, or promise Android availability before it exists.

### Content rhythm

- Release announcement whenever a real release ships.
- Android progress update weekly or biweekly only when there is something visible or testable.
- Small technical write-ups for interesting work such as privacy, updater reliability, match-map visualization, or cross-platform architecture.
- Public roadmap based on GitHub issues/milestones rather than a large list of unsupported promises.

## Measurement

Check these monthly:

- release asset downloads;
- successful update/install reports and installer failures;
- repository traffic and unique visitors;
- Discord joins and retained active members;
- Discussions questions answered;
- reproducible bug reports received and resolved;
- external contributors and merged pull requests;
- stars and forks as secondary signals.

GitHub and Discord's own insights are sufficient initially. Do not add invasive analytics just to count clicks.

## 30-day rollout

### Week 1 — foundation

- Create the Discord server and permanent invite.
- Set repository description, topics, and social preview.
- Enable Discussions and create the four categories.
- Add the community health files and issue forms.
- Decide whether to plan a controlled repository rename.

### Week 2 — presentation

- Refresh README calls to action and current release information.
- Create one strong demo clip.
- Add Discord links to the repository and app Settings/About.
- Update Rich Presence buttons using the permanent invite.

### Week 3 — small launch

- Invite a small tester group.
- Fix onboarding and installer problems they find.
- Publish one polished release with a screenshot and clear notes.
- Share it in a small number of rule-compatible communities.

### Week 4 — retention

- Convert repeated support answers into docs/Discussions.
- Publish a short Android progress update.
- Label a few genuinely approachable `good-first-issue` tasks.
- Review downloads, support volume, retention, and the most common onboarding failure.

## Decisions and inputs needed before implementation

- Discord server name and owner/moderator plan.
- Private security contact method or email.
- Whether the repository should be renamed from `valo-project` to `VantaVault`.
- Which screenshot should become the social preview.

## Recommended next five actions

1. Finish Android Studio setup; this does not block the community work.
2. Create the minimal VantaVault Discord and a permanent invite.
3. Configure GitHub About, topics, social preview, Issues, and Discussions.
4. Add the community files and templates listed above.
5. Update the README and Rich Presence only after the permanent invite is available.
