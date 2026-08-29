/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // The app never actually uses next/image's <Image> component anywhere —
    // every photo (drafts, batch results, store listings) renders through a
    // plain <img> tag instead (see the eslint-disable comments next to each
    // one). That made the old `remotePatterns: [{ hostname: "**" }]` config
    // pure risk with no upside: it left Next's built-in image-optimization
    // route reachable and willing to fetch/transcode/cache an image from ANY
    // https host on request — exactly the setup a 2025 Next.js advisory
    // (GHSA-9g9p-9gw9-jx7f, a self-hosted image-optimizer DoS) warns about,
    // and one that isn't patched anywhere in the 14.x line — only 15.5.10+/
    // 16.1.5+ fix it. Since the feature was never used, the safer fix is to
    // turn it off outright rather than wait on a major-version upgrade.
    unoptimized: true,
  },
};

module.exports = nextConfig;
