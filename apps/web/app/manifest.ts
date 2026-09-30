import type { MetadataRoute } from 'next';

/** The installable app (PWA). Arabic first; the start page redirects to the saved locale. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'منصة المعلّم',
    short_name: 'المعلّم',
    description: 'دروس وامتحانات وحضور ومدفوعات في مكان واحد.',
    lang: 'ar',
    dir: 'rtl',
    start_url: '/ar',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#0f766e',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
