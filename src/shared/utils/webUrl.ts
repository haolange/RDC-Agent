/** The site a URL belongs to, without `www.`; the input itself when it does not parse. */
export const webHostname = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
};

/** One page identity for matching links against reads: scheme, `www.`, fragments and trailing slashes do not count. */
export const normalizeWebUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.hostname.replace(/^www\./, '')}${path}${parsed.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
};
