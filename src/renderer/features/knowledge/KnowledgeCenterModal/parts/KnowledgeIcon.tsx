const paths = {
  book: 'M4 5h6a3 3 0 0 1 3 3v13a3 3 0 0 0-3-3H4V5Zm9 3a3 3 0 0 1 3-3h5v13h-5a3 3 0 0 0-3 3',
  inbox: 'M4 4h16v16H4V4Zm0 10h5l2 3h2l2-3h5',
  conflict: 'M7 3v14m-3-3 3 3 3-3M17 21V7m-3 3 3-3 3 3',
  folder: 'M3 7V5h6l2 2h10v13H3V7Z',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
  filter: 'M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6M7 14v6',
};

export function KnowledgeIcon({ name }: { name: keyof typeof paths }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
