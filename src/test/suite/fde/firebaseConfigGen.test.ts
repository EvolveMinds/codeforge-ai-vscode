import * as assert from 'assert';
import { FirebaseConfigGenerator } from '../../../deployment/firebaseConfigGen';

suite('FDE Suite — FirebaseConfigGenerator', () => {
  test('generates valid multi-target firebase.json with caching & security headers', () => {
    const jsonStr = FirebaseConfigGenerator.generateFirebaseJson({
      projectId: 'acme-pilot-2026',
      defaultPublicDir: 'frontend/dist',
    });

    const parsed = JSON.parse(jsonStr);
    assert.ok(Array.isArray(parsed.hosting));
    assert.strictEqual(parsed.hosting.length, 4);

    const prodTarget = parsed.hosting.find((h: any) => h.target === 'prod');
    assert.ok(prodTarget);
    assert.strictEqual(prodTarget.public, 'frontend/dist');
    assert.ok(prodTarget.rewrites.some((r: any) => r.destination === '/index.html'));
    assert.ok(prodTarget.headers.some((h: any) => h.headers.some((kv: any) => kv.value.includes('immutable'))));
    assert.ok(prodTarget.headers.some((h: any) => h.headers.some((kv: any) => kv.key === 'X-Content-Type-Options')));
  });

  test('generates valid .firebaserc mapping', () => {
    const rcStr = FirebaseConfigGenerator.generateFirebaseRc({
      projectId: 'acme-pilot-2026',
    });

    const parsed = JSON.parse(rcStr);
    assert.strictEqual(parsed.projects.default, 'acme-pilot-2026');
    assert.ok(parsed.targets['acme-pilot-2026'].hosting.prod);
    assert.ok(parsed.targets['acme-pilot-2026'].hosting.pilot);
  });
});
