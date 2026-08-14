// The header banner is drawn from a collection of variants (client/src/assets/
// logos): one is picked at random per page load, so a refresh reshuffles it.
// Vite resolves the glob to hashed URLs at build time — nothing is decoded
// until the <img> that uses it actually loads, so the other 95 cost nothing.
// Drop a new .webp into that folder and it joins the rotation automatically.
const LOGOS = Object.entries(
  import.meta.glob("./assets/logos/*.webp", { eager: true, query: "?url", import: "default" }),
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, url]) => url as string);

// Chosen once per module load (i.e. once per page load) so the sidebar and
// the mobile top bar always show the same banner.
export const brandLogo: string =
  LOGOS.length > 0 ? LOGOS[Math.floor(Math.random() * LOGOS.length)] : "/logo.png";
