export type RouteContext = {
  pathname: string;
  method?: string;
  user?: { id: string } | null;
  isPublic?: boolean;
};

export function validateRouteProtection({
  pathname,
  method = "GET",
  user = null,
  isPublic = false,
}: RouteContext) {
  const publicPaths = ["/", "/login"];
  const publicPrefixes = ["/_next", "/favicon", "/api/ebay/callback"];

  const isPublicPath = publicPaths.includes(pathname) || publicPrefixes.some((prefix) => pathname.startsWith(prefix));

  if (isPublic || isPublicPath) {
    return {
      allowed: true,
      redirect: pathname === "/login" && user ? "/dashboard" : null,
    };
  }

  if (!user) {
    if (pathname.startsWith("/api")) {
      return {
        allowed: false,
        status: 401,
        redirect: null,
      };
    }

    return {
      allowed: false,
      status: 302,
      redirect: "/login",
    };
  }

  if (user && pathname === "/login") {
    return {
      allowed: false,
      status: 302,
      redirect: "/dashboard",
    };
  }

  if (method === "POST" && pathname.startsWith("/api") && !user) {
    return {
      allowed: false,
      status: 401,
      redirect: null,
    };
  }

  return {
    allowed: true,
    redirect: null,
  };
}
