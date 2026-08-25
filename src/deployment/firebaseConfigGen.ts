/**
 * deployment/firebaseConfigGen.ts — Firebase Hosting & Multi-Target Config Scaffolder
 *
 * Scaffolds production-grade, multi-environment Firebase configuration:
 *  - firebase.json with SPA rewrites, security headers, and asset caching rules.
 *  - .firebaserc with target site mapping (dev, test, client-pilot, prod).
 */

export interface FirebaseTargetConfig {
  targetName: string;
  siteId: string;
  publicDir: string;
}

export interface FirebaseScaffoldOptions {
  projectId: string;
  defaultPublicDir?: string;
  spaRouting?: boolean;
  targets?: FirebaseTargetConfig[];
}

export class FirebaseConfigGenerator {
  static generateFirebaseJson(opts: FirebaseScaffoldOptions): string {
    const publicDir = opts.defaultPublicDir || 'dist';
    const targets = opts.targets || [
      { targetName: 'dev', siteId: `${opts.projectId}-dev`, publicDir },
      { targetName: 'test', siteId: `${opts.projectId}-test`, publicDir },
      { targetName: 'pilot', siteId: `${opts.projectId}-pilot`, publicDir },
      { targetName: 'prod', siteId: opts.projectId, publicDir },
    ];

    const hostingConfigs = targets.map(t => ({
      target: t.targetName,
      public: t.publicDir,
      ignore: [
        'firebase.json',
        '**/.*',
        '**/node_modules/**',
      ],
      rewrites: opts.spaRouting !== false ? [
        {
          source: '**',
          destination: '/index.html',
        },
      ] : [],
      headers: [
        {
          source: '**/*.@(js|css)',
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=31536000, immutable',
            },
          ],
        },
        {
          source: '**/*.@(glb|gltf|fbx|obj|mp3|wav|ogg|png|jpg|jpeg|svg|webp|woff|woff2)',
          headers: [
            {
              key: 'Cache-Control',
              value: 'public, max-age=86400',
            },
          ],
        },
        {
          source: '**',
          headers: [
            {
              key: 'X-Content-Type-Options',
              value: 'nosniff',
            },
            {
              key: 'X-Frame-Options',
              value: 'DENY',
            },
            {
              key: 'X-XSS-Protection',
              value: '1; mode=block',
            },
          ],
        },
      ],
    }));

    return JSON.stringify({ hosting: hostingConfigs }, null, 2);
  }

  static generateFirebaseRc(opts: FirebaseScaffoldOptions): string {
    const targets = opts.targets || [
      { targetName: 'dev', siteId: `${opts.projectId}-dev`, publicDir: 'dist' },
      { targetName: 'test', siteId: `${opts.projectId}-test`, publicDir: 'dist' },
      { targetName: 'pilot', siteId: `${opts.projectId}-pilot`, publicDir: 'dist' },
      { targetName: 'prod', siteId: opts.projectId, publicDir: 'dist' },
    ];

    const hostingMap: Record<string, string[]> = {};
    for (const t of targets) {
      hostingMap[t.targetName] = [t.siteId];
    }

    const rc = {
      projects: {
        default: opts.projectId,
      },
      targets: {
        [opts.projectId]: {
          hosting: hostingMap,
        },
      },
    };

    return JSON.stringify(rc, null, 2);
  }
}
