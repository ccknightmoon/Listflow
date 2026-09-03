// Temporary, deliberately-broken route for confirming the Sentry setup
// actually works end to end. Visit it once after deploying -- it always
// throws, on purpose -- then check the Sentry dashboard for the event. Safe
// to leave in (it does nothing but throw a harmless test error) or delete
// once you've confirmed it shows up.
export const runtime = "nodejs";
// Forces this to run per-request instead of being executed once at build
// time for static prerendering -- which would make the build itself fail,
// since this route always throws on purpose.
export const dynamic = "force-dynamic";

export async function GET() {
  throw new Error("Sentry test error -- if you see this in Sentry, it's working.");
}
