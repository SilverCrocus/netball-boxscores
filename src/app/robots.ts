import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin/', '/api/', '/auth/', '/settings'],
      },
    ],
    sitemap: 'https://centrepass.io/sitemap.xml',
  };
}
