// Canonical host: send www.logichain.no (and any non-canonical host on the custom domain) to logichain.no,
// and keep API endpoints out of search engines.
export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname === "www.logichain.no") {
    url.hostname = "logichain.no";
    return Response.redirect(url.toString(), 301);
  }
  // Source files in the repo (database scripts, edge functions, worker code, docs) are not part of the website
  if (/^\/(supabase|cloudflare|functions|scripts)(\/|$)|^\/(README\.md|SETUP\.md|\.git[^/]*|_headers|_redirects)$/i.test(url.pathname)) {
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" } });
  }
  const res = await next();
  if (url.pathname.startsWith("/api/")) {
    const r = new Response(res.body, res);
    r.headers.set("X-Robots-Tag", "noindex, nofollow");
    return r;
  }
  return res;
}
