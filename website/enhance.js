(() => {
  const asset = (name) => `assets/${name}`;

  document.querySelectorAll(".brand-badge").forEach((badge) => {
    const image = document.createElement("img");
    image.src = asset("app-icon.png");
    image.alt = "";
    badge.replaceChildren(image);
  });

})();
