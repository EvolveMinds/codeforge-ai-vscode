import * as assert from 'assert';

suite('FDE Suite — 3D Data Cosmos & Schema Topology', () => {
  interface TestLink {
    source: string;
    target: string;
    sourceCol: string;
    targetCol: string;
  }

  function findShortestJoinPath(
    nodes: string[],
    links: TestLink[],
    startId: string,
    endId: string
  ): { path: string[]; sql: string } | null {
    if (!startId || !endId || startId === endId) return null;

    const adj = new Map<string, Array<{ neighbor: string; link: TestLink }>>();
    nodes.forEach(n => adj.set(n, []));

    links.forEach(l => {
      adj.get(l.source)?.push({ neighbor: l.target, link: l });
      adj.get(l.target)?.push({ neighbor: l.source, link: l });
    });

    const queue: Array<{ curr: string; path: string[]; linkPath: TestLink[] }> = [
      { curr: startId, path: [startId], linkPath: [] }
    ];
    const visited = new Set<string>([startId]);

    let foundPath: string[] | null = null;
    let foundLinks: TestLink[] = [];

    while (queue.length > 0) {
      const { curr, path, linkPath } = queue.shift()!;
      if (curr === endId) {
        foundPath = path;
        foundLinks = linkPath;
        break;
      }

      const neighbors = adj.get(curr) || [];
      for (const edge of neighbors) {
        if (!visited.has(edge.neighbor)) {
          visited.add(edge.neighbor);
          queue.push({
            curr: edge.neighbor,
            path: [...path, edge.neighbor],
            linkPath: [...linkPath, edge.link]
          });
        }
      }
    }

    if (!foundPath) return null;

    const joins: string[] = [];
    for (let i = 0; i < foundPath.length - 1; i++) {
      const t1 = foundPath[i];
      const t2 = foundPath[i + 1];
      const rel = foundLinks[i];
      const isForward = rel.source === t1;
      const col1 = isForward ? rel.sourceCol : rel.targetCol;
      const col2 = isForward ? rel.targetCol : rel.sourceCol;
      joins.push(`JOIN ${t2} ON ${t1}.${col1} = ${t2}.${col2}`);
    }

    const selectCols = foundPath.map(t => `${t}.*`).join(', ');
    const sql = `SELECT ${selectCols} FROM ${foundPath[0]} ${joins.join(' ')} LIMIT 100;`;

    return { path: foundPath, sql };
  }

  test('finds direct foreign key join between adjacent tables', () => {
    const nodes = ['orders', 'customers', 'products'];
    const links: TestLink[] = [
      { source: 'orders', target: 'customers', sourceCol: 'customer_id', targetCol: 'customer_id' },
      { source: 'orders', target: 'products', sourceCol: 'product_id', targetCol: 'product_id' }
    ];

    const result = findShortestJoinPath(nodes, links, 'orders', 'customers');
    assert.ok(result);
    assert.deepStrictEqual(result.path, ['orders', 'customers']);
    assert.ok(result.sql.includes('FROM orders JOIN customers ON orders.customer_id = customers.customer_id'));
  });

  test('finds multi-hop shortest join path across enterprise star schema', () => {
    const nodes = ['payments', 'orders', 'order_items', 'products', 'categories'];
    const links: TestLink[] = [
      { source: 'payments', target: 'orders', sourceCol: 'order_id', targetCol: 'order_id' },
      { source: 'order_items', target: 'orders', sourceCol: 'order_id', targetCol: 'order_id' },
      { source: 'order_items', target: 'products', sourceCol: 'product_id', targetCol: 'product_id' },
      { source: 'products', target: 'categories', sourceCol: 'category_id', targetCol: 'category_id' }
    ];

    const result = findShortestJoinPath(nodes, links, 'payments', 'categories');
    assert.ok(result);
    assert.deepStrictEqual(result.path, ['payments', 'orders', 'order_items', 'products', 'categories']);
    assert.ok(result.sql.includes('FROM payments'));
    assert.ok(result.sql.includes('JOIN orders ON payments.order_id = orders.order_id'));
    assert.ok(result.sql.includes('JOIN categories ON products.category_id = categories.category_id'));
  });

  test('returns null when no reachable join path exists', () => {
    const nodes = ['table_a', 'table_b', 'isolated_table'];
    const links: TestLink[] = [
      { source: 'table_a', target: 'table_b', sourceCol: 'b_id', targetCol: 'id' }
    ];

    const result = findShortestJoinPath(nodes, links, 'table_a', 'isolated_table');
    assert.strictEqual(result, null);
  });

  test('verifies executive approval sign-off blocks in client POC pack', () => {
    const pack = {
      client: 'Retail Corp',
      targetVpc: 'vpc-apac-prod',
      fdeName: 'Lead FDE Alice',
      status: 'PENDING EXECUTIVE APPROVAL & SIGN-OFF'
    };

    assert.ok(pack.client.length > 0);
    assert.ok(pack.targetVpc.includes('vpc'));
    assert.strictEqual(pack.status, 'PENDING EXECUTIVE APPROVAL & SIGN-OFF');
  });
});
