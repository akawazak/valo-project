# VantaVault website

Static, dependency-free landing page for VantaVault.

## Deploy on Vercel

1. Import `akawazak/valo-project` in Vercel.
2. Set **Root Directory** to `website`.
3. Leave the framework preset as **Other** and deploy.

The page fetches the latest public GitHub release in the browser and points every download button to `VantaVault-portable.exe`. If the API is temporarily unavailable, the buttons fall back to GitHub's permanent latest-release download URL.
