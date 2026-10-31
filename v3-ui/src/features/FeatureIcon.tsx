const paths: Record<string, string> = {
  book: 'M3 5c4-2 7-2 9 0 2-2 5-2 9 0v15c-4-2-7-2-9 0-2-2-5-2-9 0V5Zm9 0v15M6 8h3m-3 4h3m6-4h3m-3 4h3',
  chakra: 'M18 6c-8-6-17 4-11 11 5 6 14-1 10-6-3-4-9 1-5 4M7 17l-4 4 1-7',
  flame: 'M13 3c2 5-3 6 1 10 2-1 3-3 3-5 7 7 2 13-4 13S2 15 7 9c0 3 1 4 2 5 3-3 0-7 4-11Z',
  star: 'm12 2 3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1 3-7Z',
  blades: 'm4 3 12 12-2 2L2 5l2-2Zm16 0L8 15l2 2L22 5l-2-2ZM13 18l5-5m-1 4 4 4M6 13l5 5m-4-1-4 4',
  boss: 'M5 9 3 3l6 4h6l6-4-2 6v8l-7 5-7-5V9Zm3 3 3 2m5-2-3 2m-4 3h6',
  chest: 'M3 10h18v11H3V10Zm0 0V6l3-3h12l3 3v4M2 14h20M10 11h4v6h-4v-6Z',
  help: 'M9 8c0-5 8-5 8 0 0 3-5 3-5 6m0 4v1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  guild: 'm12 2 9 4v9l-9 7-9-7V6l9-4Zm-4 8h8m-4-4v12m-4-3h8',
  people: 'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-1a3 3 0 1 0 0-6M1 21v-4c0-6 14-6 14 0v4H1Zm17-8c4 0 5 2 5 5v3h-5',
  shop: 'M3 9 5 3h14l2 6M3 9v3c0 3 5 3 5 0 0 3 8 3 8 0 0 3 5 3 5 0V9H3Zm2 6v7h14v-7m-9 2h4v5',
  tech: 'M9 3h6l1 4 4 1 2 4-3 3 1 4-5 2-3-3-4 1-3-4 2-4-1-4 4-1 1-3Zm7 9a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  mail: 'M2 5h20v15H2V5Zm0 0 10 9L22 5',
  chat: 'M3 3h18v14H9l-6 5V3Zm4 6h1m4 0h1m4 0h1',
  lock: 'M5 10h14v12H5V10Zm3 0V6c0-6 8-6 8 0v4m-4 5v3',
  search: 'M15 15l7 7M18 9a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
};

export function FeatureIcon({ name, className = '' }: { name: string; className?: string }) {
  return <svg className={`v3-feature-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.book} /></svg>;
}
