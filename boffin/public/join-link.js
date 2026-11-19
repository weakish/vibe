// The invitation token is the fragment parameter `join`. A legacy `?join=` is
// removed so a later load does not send the token to the server. When the
// fragment has no token, the query value is copied there first.
export function invitationFromHref(href) {
  const url = new URL(href);
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : '';
  const hashParams = new URLSearchParams(hash);
  const fromHash = hashParams.get('join');
  const fromSearch = url.searchParams.get('join');
  const hadQuery = url.searchParams.has('join');
  if (hadQuery) {
    url.searchParams.delete('join');
  }
  if (!fromHash && fromSearch) {
    hashParams.set('join', fromSearch);
    const nextHash = hashParams.toString();
    url.hash = nextHash ? `#${nextHash}` : '';
  }
  const rewritten = hadQuery || (!fromHash && Boolean(fromSearch));
  return {
    joinId: fromHash || fromSearch || null,
    path: rewritten ? `${url.pathname}${url.search}${url.hash}` : null,
  };
}
