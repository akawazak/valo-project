# winget

`manifests/` holds the first VantaVault manifest (0.5.31) for [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs). It passes `winget validate`.

## First submission (once, by hand)

1. Test it locally: `winget install --manifest packaging/winget/manifests/a/akawazak/VantaVault/0.5.31`
2. Fork `microsoft/winget-pkgs` on GitHub.
3. Copy `manifests/a/akawazak/VantaVault/0.5.31/` into the same path in the fork, then open a pull request. Or let the tool do it: `wingetcreate submit packaging/winget/manifests/a/akawazak/VantaVault/0.5.31`.
4. Wait for the automated checks and a moderator to merge it.

## After that

`.github/workflows/winget.yaml` opens the pull request for every new release. Add a classic personal access token with the `public_repo` and `workflow` scopes as the repository secret `WINGET_TOKEN`. Without the secret, the workflow does nothing.
