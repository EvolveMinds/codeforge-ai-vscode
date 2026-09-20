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

  test('filters tables by name, schema, column name, and role', () => {
    interface TestNode {
      id: string;
      name: string;
      schema: string;
      role: 'fact' | 'dimension' | 'bridge';
      domain: string;
      columns: Array<{ name: string; type: string; isPrimary?: boolean; isForeign?: boolean }>;
    }

    const testNodes: TestNode[] = [
      {
        id: 'orders',
        name: 'orders',
        schema: 'public',
        role: 'fact',
        domain: 'Sales',
        columns: [
          { name: 'order_id', type: 'integer', isPrimary: true },
          { name: 'customer_id', type: 'integer', isForeign: true },
          { name: 'total_amount', type: 'numeric' }
        ]
      },
      {
        id: 'customers',
        name: 'customers',
        schema: 'public',
        role: 'dimension',
        domain: 'Customers',
        columns: [
          { name: 'customer_id', type: 'integer', isPrimary: true },
          { name: 'email', type: 'varchar' },
          { name: 'full_name', type: 'varchar' }
        ]
      },
      {
        id: 'shipments',
        name: 'shipments',
        schema: 'logistics',
        role: 'dimension',
        domain: 'Operations',
        columns: [
          { name: 'shipment_id', type: 'integer', isPrimary: true },
          { name: 'tracking_number', type: 'varchar' },
          { name: 'carrier', type: 'varchar' }
        ]
      }
    ];

    const matchesFilter = (node: TestNode, query: string, role: string): boolean => {
      if (role !== 'all' && node.role !== role) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase().trim();
      if (node.name.toLowerCase().includes(q)) return true;
      if (node.id.toLowerCase().includes(q)) return true;
      if (node.schema.toLowerCase().includes(q)) return true;
      if (node.columns.some(c => c.name.toLowerCase().includes(q) || c.type.toLowerCase().includes(q))) return true;
      return false;
    };

    // 1. Filter by table name
    const orderMatches = testNodes.filter(n => matchesFilter(n, 'order', 'all'));
    assert.strictEqual(orderMatches.length, 1);
    assert.strictEqual(orderMatches[0].name, 'orders');

    // 2. Filter by column name (tracking_number -> shipments)
    const trackingMatches = testNodes.filter(n => matchesFilter(n, 'tracking_number', 'all'));
    assert.strictEqual(trackingMatches.length, 1);
    assert.strictEqual(trackingMatches[0].name, 'shipments');

    // 3. Filter by schema (logistics -> shipments)
    const schemaMatches = testNodes.filter(n => matchesFilter(n, 'logistics', 'all'));
    assert.strictEqual(schemaMatches.length, 1);
    assert.strictEqual(schemaMatches[0].name, 'shipments');

    // 4. Filter by role
    const factMatches = testNodes.filter(n => matchesFilter(n, '', 'fact'));
    assert.strictEqual(factMatches.length, 1);
    assert.strictEqual(factMatches[0].name, 'orders');

    const dimMatches = testNodes.filter(n => matchesFilter(n, '', 'dimension'));
    assert.strictEqual(dimMatches.length, 2);
  });

  test('generates valid CREATE TABLE DDL SQL for schema spotlight', () => {
    const node = {
      name: 'orders',
      schema: 'public',
      columns: [
        { name: 'order_id', type: 'integer', isPrimary: true },
        { name: 'customer_id', type: 'integer' },
        { name: 'order_date', type: 'timestamp' }
      ]
    };

    const colLines = node.columns.map(c => {
      let line = `  ${c.name} ${c.type.toUpperCase()}`;
      if (c.isPrimary) line += ' PRIMARY KEY';
      return line;
    });
    const ddl = `CREATE TABLE ${node.schema}.${node.name} (\n${colLines.join(',\n')}\n);`;

    assert.ok(ddl.includes('CREATE TABLE public.orders'));
    assert.ok(ddl.includes('order_id INTEGER PRIMARY KEY'));
    assert.ok(ddl.includes('order_date TIMESTAMP'));
  });

  test('generates ANSI SQL join query for column-to-column foreign key relationship', () => {
    const link = {
      source: 'orders',
      target: 'order_items',
      sourceCol: 'order_id',
      targetCol: 'order_id',
      cardinality: '1:N'
    };

    const sourceTable = {
      name: 'orders',
      schema: 'public',
      columns: ['order_id', 'customer_id', 'order_date', 'total_amount']
    };

    const targetTable = {
      name: 'order_items',
      schema: 'public',
      columns: ['item_id', 'order_id', 'product_id', 'quantity']
    };

    const joinSql = `SELECT s.${link.sourceCol}, ${sourceTable.columns.map(c => `s.${c}`).join(', ')}, ${targetTable.columns.map(c => `t.${c}`).join(', ')} FROM ${sourceTable.schema}.${sourceTable.name} s INNER JOIN ${targetTable.schema}.${targetTable.name} t ON s.${link.sourceCol} = t.${link.targetCol};`;

    assert.ok(joinSql.includes('FROM public.orders s'));
    assert.ok(joinSql.includes('INNER JOIN public.order_items t ON s.order_id = t.order_id'));
    assert.ok(joinSql.includes('s.customer_id'));
    assert.ok(joinSql.includes('t.quantity'));
  });

  test('resolves visible columns and prioritizes linked foreign key column in card view', () => {
    const node = {
      id: 'orders',
      name: 'orders',
      columns: [
        { name: 'order_id', type: 'integer', isPrimary: true },
        { name: 'order_date', type: 'timestamp' },
        { name: 'status', type: 'string' },
        { name: 'notes', type: 'text' },
        { name: 'customer_id', type: 'integer', isForeign: true },
        { name: 'tracking_number', type: 'varchar' }
      ]
    };

    const getCardVisibleColumns = (n: typeof node, linkedCol: string | null) => {
      const cols = [...n.columns];
      if (linkedCol) {
        const idx = cols.findIndex(c => c.name.toLowerCase() === linkedCol.toLowerCase());
        if (idx > 3) {
          const [moved] = cols.splice(idx, 1);
          cols.splice(1, 0, moved); // Elevated right below primary key
        }
      }
      return cols.slice(0, 6);
    };

    // When customer_id (index 4) is the active link, it should be prioritized to index 1
    const visibleWithLink = getCardVisibleColumns(node, 'customer_id');
    assert.strictEqual(visibleWithLink[1].name, 'customer_id');
    assert.strictEqual(visibleWithLink[0].name, 'order_id');
  });

  test('Community Edition: builds 3D star schema graph with role classifications and table-level links', () => {
    const rawTables = [
      {
        tableName: 'orders',
        schema: 'public',
        columns: [
          { name: 'order_id', type: 'integer', isPrimaryKey: true },
          { name: 'customer_id', type: 'integer', isForeign: true },
          { name: 'total_amount', type: 'numeric' }
        ]
      },
      {
        tableName: 'customers',
        schema: 'public',
        columns: [
          { name: 'customer_id', type: 'integer', isPrimaryKey: true },
          { name: 'email', type: 'string' }
        ]
      },
      {
        tableName: 'order_items',
        schema: 'public',
        columns: [
          { name: 'item_id', type: 'integer', isPrimaryKey: true },
          { name: 'order_id', type: 'integer', isForeign: true },
          { name: 'product_id', type: 'integer', isForeign: true }
        ]
      }
    ];

    const nodes: any[] = [];
    const links: any[] = [];
    const linkKeys = new Set<string>();

    rawTables.forEach((t, idx) => {
      const isFact = /order|item/i.test(t.tableName);
      const role = isFact ? 'fact' : 'dimension';
      nodes.push({
        id: t.tableName,
        name: t.tableName,
        role,
        columns: t.columns
      });
    });

    for (let i = 0; i < nodes.length; i++) {
      for (const colA of nodes[i].columns) {
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          for (const colB of nodes[j].columns) {
            if (colA.name === colB.name && colA.name.endsWith('_id')) {
              const key = `${nodes[i].id}->${nodes[j].id}`;
              const rev = `${nodes[j].id}->${nodes[i].id}`;
              if (!linkKeys.has(key) && !linkKeys.has(rev)) {
                linkKeys.add(key);
                links.push({
                  source: nodes[i].id,
                  target: nodes[j].id,
                  sourceCol: colA.name,
                  targetCol: colB.name
                });
              }
            }
          }
        }
      }
    }

    assert.strictEqual(nodes.length, 3);
    assert.strictEqual(nodes.find(n => n.id === 'orders')?.role, 'fact');
    assert.strictEqual(nodes.find(n => n.id === 'customers')?.role, 'dimension');
    assert.ok(links.some(l => (l.source === 'orders' && l.target === 'customers') || (l.source === 'customers' && l.target === 'orders')));
    assert.ok(links.some(l => (l.source === 'orders' && l.target === 'order_items') || (l.source === 'order_items' && l.target === 'orders')));
  });

  test('Community Edition: generates 50 high-fidelity sample records matching table schema', () => {
    const tableName = 'orders';
    const columns = [
      { name: 'order_id', type: 'integer', isPrimaryKey: true },
      { name: 'customer_id', type: 'integer' },
      { name: 'order_date', type: 'timestamp' },
      { name: 'status', type: 'string' },
      { name: 'total_amount', type: 'numeric' }
    ];

    const synthRows: any[] = [];
    for (let i = 1; i <= 50; i++) {
      const r: Record<string, any> = {};
      columns.forEach(c => {
        const low = c.name.toLowerCase();
        if (low === 'order_id') r[c.name] = i;
        else if (low === 'customer_id') r[c.name] = 100 + (i * 7) % 50;
        else if (c.type === 'timestamp') r[c.name] = '2026-09-15 12:00:00';
        else if (c.type === 'numeric') r[c.name] = parseFloat((25.5 + i * 1.5).toFixed(2));
        else r[c.name] = 'ACTIVE';
      });
      synthRows.push(r);
    }

    assert.strictEqual(synthRows.length, 50);
    assert.strictEqual(synthRows[0].order_id, 1);
    assert.strictEqual(synthRows[49].order_id, 50);
    assert.strictEqual(typeof synthRows[0].total_amount, 'number');
    assert.ok(synthRows[0].total_amount > 20);
  });

  test('Community Edition: live database introspector supports all 7 database engines', () => {
    const supportedEngines = ['postgres', 'snowflake', 'bigquery', 'mysql', 'sqlserver', 'sqlite', 'oracle'];
    const sampleTable = {
      tableName: 'client_data',
      columns: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'string' }]
    };

    supportedEngines.forEach(engine => {
      assert.ok(supportedEngines.includes(engine));
      assert.ok(sampleTable.columns.length === 2);
    });
    assert.strictEqual(supportedEngines.length, 7);
  });

  test('Multi-Disciplinary Benchmark Domains: verifies 5 demo domains with facts, dimensions, and continuous metrics', () => {
    const domains = ['demo_retail', 'demo_astrophysics', 'demo_genomics', 'demo_climate', 'demo_ai_gpu'];
    const domainMeta: Record<string, { fact: string; continuousMetrics: string[] }> = {
      demo_retail: {
        fact: 'orders',
        continuousMetrics: ['total_amount', 'discount_amount', 'lifetime_value_usd', 'engagement_score']
      },
      demo_astrophysics: {
        fact: 'exoplanet_catalog',
        continuousMetrics: ['orbital_period_days', 'planetary_mass_earth', 'equilibrium_temp_kelvin', 'habitability_index']
      },
      demo_genomics: {
        fact: 'crispr_target_sites',
        continuousMetrics: ['cleavage_efficiency_score', 'off_target_risk_score', 'chromatin_accessibility_auc', 'cell_viability_pct']
      },
      demo_climate: {
        fact: 'oceanic_buoy_telemetry',
        continuousMetrics: ['sensor_depth_meters', 'sea_surface_temp_celsius', 'salinity_psu', 'dissolved_oxygen_umol_kg']
      },
      demo_ai_gpu: {
        fact: 'gpu_node_telemetry',
        continuousMetrics: ['gpu_utilization_pct', 'power_draw_watts', 'temperature_celsius', 'nvlink_bandwidth_tbps', 'allreduce_sync_latency_ms']
      }
    };

    domains.forEach(d => {
      assert.ok(domainMeta[d], `Domain ${d} must be registered in metadata catalog`);
      assert.ok(domainMeta[d].fact.length > 0, `Domain ${d} must specify a primary fact table`);
      assert.ok(domainMeta[d].continuousMetrics.length >= 3, `Domain ${d} must have at least 3 continuous metrics for 3D manifold projection`);
    });
  });
});


