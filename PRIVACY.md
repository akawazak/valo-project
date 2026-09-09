# VantaVault Privacy Notice

Last updated: August 3, 2026

VantaVault is a local-first desktop and Android application. The project does
not operate an account-storage server. The public VantaVault website uses
Vercel Web Analytics and Speed Insights to measure page visits, download-button
interactions, and site performance.

## Data processed

VantaVault processes the Riot account identifiers, session credentials,
loadouts, storefront data, profile and match data, and social or live-session
data needed for features the user chooses to open.

## Where data goes

- Riot account and game requests are sent directly from the user's device to
  Riot services.
- Public game metadata and images are requested from valorant-api.com.
- Update checks and downloads use this project's GitHub Releases.
- Visits to the public website send limited usage and performance measurements
  to Vercel. Riot account identifiers, app credentials, game data, and chat
  content are not included in those website events.

VantaVault does not sell personal data or include advertising trackers.

## Local storage

Public account records and non-secret caches are stored in VantaVault's local
application-data directories. Reusable Riot session credentials are kept in
Windows Credential Manager on desktop and encrypted with an Android
Keystore-backed key on Android; they are not stored in browser local storage or
the application's SQLite databases.

Removing an account in VantaVault deletes its stored credentials, saved login
profile, local chat history, and account-scoped caches before removing it from
the app's account list. If cleanup cannot complete, the account stays visible
and the app asks the user to retry.
Uninstalling a desktop application may leave application-data directories
behind; users can delete the VantaVault directories under their Windows
`%APPDATA%` folder to remove the remaining local data.

## Retention and control

Data is retained locally until the user removes the account, clears the
application data, or Riot expires the session. Users can stop processing by
closing the app and can remove the application at any time.

## Third parties

Riot Games, GitHub, valorant-api.com, and Vercel process requests under their
own terms and privacy notices. VantaVault is not endorsed by Riot Games.

## Contact

Privacy questions can be submitted through the project's
[GitHub issue tracker](https://github.com/akawazak/valo-project/issues).
