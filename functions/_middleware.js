// Canonical host: send www.logichain.no (and any non-canonical host on the custom domain) to logichain.no,
// and keep API endpoints out of search engines.
export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname === "www.logichain.no") {
    url.hostname = "logichain.no";
    return Response.redirect(url.toString(), 301);
  }
  const res = await next();
  if (url.pathname.startsWith("/api/")) {
    const r = new Response(res.body, res);
    r.headers.set("X-Robots-Tag", "noindex, nofollow");
    return r;
  }
  return res;
}
