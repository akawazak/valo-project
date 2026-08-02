const RELEASE_API = "https://api.github.com/repos/akawazak/valo-project/releases/latest";
const RELEASE_PAGE = "https://github.com/akawazak/valo-project/releases/latest";
const PORTABLE_FALLBACK = `${RELEASE_PAGE}/download/VantaVault-portable.exe`;

const screens = {
  loadout: {
    src: "assets/current-loadout.png",
    alt: "VantaVault current loadout screen showing every equipped weapon and cosmetic",
  },
  store: {
    src: "assets/storefront.png",
    alt: "VantaVault storefront showing current offers and a featured bundle",
  },
  lobby: {
    src: "assets/live-match.png",
    alt: "VantaVault live match screen showing both teams and lobby context",
  },
  profile: {
    src: "assets/profile.png",
    alt: "VantaVault profile screen showing rank history and performance context",
  },
};

const byId = (id) => document.getElementById(id);

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatDate(value, long = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    month: long ? "long" : "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function setDownloadUrl(url) {
  document.querySelectorAll(".js-download").forEach((link) => {
    link.href = url;
  });
}

async function hydrateRelease() {
  setDownloadUrl(PORTABLE_FALLBACK);

  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
    });

    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);

    const release = await response.json();
    const portable = release.assets?.find((asset) => asset.name === "VantaVault-portable.exe")
      ?? release.assets?.find((asset) => /portable.*\.exe$/i.test(asset.name));

    const version = release.tag_name || release.name || "Latest";
    const published = release.published_at || release.created_at;
    const downloadUrl = PORTABLE_FALLBACK;

    byId("hero-version").textContent = version;
    byId("release-version").textContent = version;
    byId("hero-date").textContent = formatDate(published, true);
    byId("hero-date").dateTime = published || "";
    byId("release-date").textContent = formatDate(published);
    byId("release-file").textContent = portable?.name || "Latest release";
    byId("release-size").textContent = formatBytes(portable?.size);
    byId("release-notes").href = release.html_url || RELEASE_PAGE;
    byId("release-status").textContent = portable
      ? "Latest release details are fetched directly from GitHub."
      : "Release details loaded. Open GitHub to choose an available Windows download.";
    setDownloadUrl(downloadUrl);
  } catch (error) {
    console.warn("Could not refresh GitHub release metadata", error);
    byId("release-status").textContent = "GitHub is temporarily unavailable. The download still points to the latest portable release.";
  }
}

function activateScreen(button) {
  const screen = screens[button.dataset.screen];
  const image = byId("showcase-image");
  const frame = image?.closest(".window-frame");
  if (!screen || !image) return;

  document.querySelectorAll(".feature-tab").forEach((tab) => {
    const selected = tab === button;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });

  image.classList.add("is-changing");
  window.setTimeout(() => {
    image.src = screen.src;
    image.alt = screen.alt;
    if (frame) frame.dataset.screen = button.dataset.screen;
    image.classList.remove("is-changing");
  }, 120);
}

document.querySelectorAll(".feature-tab").forEach((button) => {
  button.addEventListener("click", () => activateScreen(button));
});

hydrateRelease();
