import * as assert from 'assert';
import { CloudResourceDiscovery } from '../../../deployment/cloudResourceDiscovery';

suite('FDE Suite — CloudResourceDiscovery', () => {
  test('parses GCP compute networks JSON output correctly', () => {
    const sampleJson = JSON.stringify([
      { name: 'default', selfLink: 'https://.../networks/default' },
      { name: 'client-vpc-internal', selfLink: 'https://.../networks/client-vpc-internal' },
    ]);

    const networks = CloudResourceDiscovery.parseGcpNetworks(sampleJson);
    assert.strictEqual(networks.length, 2);
    assert.strictEqual(networks[0], 'default');
    assert.strictEqual(networks[1], 'client-vpc-internal');
  });

  test('parses GCP compute subnets JSON output correctly', () => {
    const sampleJson = JSON.stringify([
      { name: 'pilot-subnet-1', region: 'australia-southeast1' },
      { name: 'pilot-subnet-2', region: 'australia-southeast1' },
    ]);

    const subnets = CloudResourceDiscovery.parseGcpSubnets(sampleJson);
    assert.strictEqual(subnets.length, 2);
    assert.strictEqual(subnets[0], 'pilot-subnet-1');
    assert.strictEqual(subnets[1], 'pilot-subnet-2');
  });

  test('parses AWS VPCs and Subnets JSON output correctly', () => {
    const vpcJson = JSON.stringify({
      Vpcs: [
        { VpcId: 'vpc-0123456789abcdef0', Tags: [{ Key: 'Name', Value: 'ClientPilotVpc' }] },
        { VpcId: 'vpc-9876543210fedcba0' },
      ],
    });

    const subJson = JSON.stringify({
      Subnets: [
        { SubnetId: 'subnet-0a1b2c3d4e5f6g7h8', Tags: [{ Key: 'Name', Value: 'PrivateAppSubnetA' }] },
      ],
    });

    const vpcs = CloudResourceDiscovery.parseAwsVpcs(vpcJson);
    assert.strictEqual(vpcs.length, 2);
    assert.strictEqual(vpcs[0], 'vpc-0123456789abcdef0 (ClientPilotVpc)');
    assert.strictEqual(vpcs[1], 'vpc-9876543210fedcba0');

    const subnets = CloudResourceDiscovery.parseAwsSubnets(subJson);
    assert.strictEqual(subnets.length, 1);
    assert.strictEqual(subnets[0], 'subnet-0a1b2c3d4e5f6g7h8 (PrivateAppSubnetA)');
  });

  test('handles malformed JSON gracefully without throwing', () => {
    const invalidJson = 'ERROR: could not reach metadata server';
    const vpcs = CloudResourceDiscovery.parseGcpNetworks(invalidJson);
    const subnets = CloudResourceDiscovery.parseGcpSubnets(invalidJson);
    const awsVpcs = CloudResourceDiscovery.parseAwsVpcs(invalidJson);

    assert.deepStrictEqual(vpcs, []);
    assert.deepStrictEqual(subnets, []);
    assert.deepStrictEqual(awsVpcs, []);
  });
});
