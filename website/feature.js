(() => {
  const API = "https://api.github.com/repos/akawazak/valo-project/releases/latest";
  const FALLBACK = "https://github.com/akawazak/valo-project/releases/latest/download/VantaVault-portable.exe";

  document.querySelectorAll(".download-link").forEach((link) => {
    link.href = FALLBACK;
  });

  fetch(API, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    }
  })
    .then((response) => {
      if (!response.ok) throw new Error(String(response.status));
      return response.json();
    })
    .then((release) => {
      const asset = (release.assets || []).find((item) => item.name === "VantaVault-portable.exe");
      document.querySelectorAll("[data-release-version]").forEach((node) => {
        node.textContent = release.tag_name || "Latest";
      });
      document.querySelectorAll("[data-download-count]").forEach((node) => {
        node.textContent = Number(asset?.download_count || 0).toLocaleString();
      });
    })
    .catch(() => {});
})();
