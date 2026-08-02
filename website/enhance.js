(() => {
  const asset = (name) => `assets/${name}`;

  const replaceImage = (selector, src, alt) => {
    const image = document.querySelector(selector);
    if (!image) return;
    image.src = asset(src);
    image.alt = alt;
    image.decoding = "async";
  };

  replaceImage(
    ".app-frame img",
    "profile.png",
    "VantaVault profile with rank history, account progression, and match analytics"
  );
  replaceImage(
    ".loadout-card img",
    "current-loadout.png",
    "VantaVault complete weapon and cosmetic loadout"
  );
  replaceImage(
    ".profile-card img",
    "profile.png",
    "VantaVault profile and competitive history"
  );
  replaceImage(
    "#stage-image",
    "profile.png",
    "VantaVault profile and competitive history"
  );

  document.querySelectorAll(".brand-badge").forEach((badge) => {
    const image = document.createElement("img");
    image.src = asset("app-icon.png");
    image.alt = "";
    badge.replaceChildren(image);
  });

  const views = {
    profile: {
      src: asset("profile.png"),
      alt: "VantaVault profile and competitive history"
    },
    loadout: {
      src: asset("current-loadout.png"),
      alt: "VantaVault complete weapon and cosmetic loadout"
    },
    customization: {
      src: asset("cosmetic-picker.png"),
      alt: "VantaVault cosmetic picker"
    },
    social: {
      src: asset("party-friends.png"),
      alt: "VantaVault party and friends panel"
    }
  };

  const stage = document.querySelector("#stage-image");
  document.querySelectorAll(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      const view = views[button.dataset.screen];
      if (!view || !stage) return;
      window.setTimeout(() => {
        stage.src = view.src;
        stage.alt = view.alt;
      }, 155);
    });
  });
})();
