import * as assert from 'assert';
import { DeployScriptScaffolder } from '../../../deployment/deployScriptScaffolder';

suite('FDE Suite — DeployScriptScaffolder', () => {
  test('generates Terraform configuration for Cloud Run and Secret Manager', () => {
    const tf = DeployScriptScaffolder.generateTerraform({
      projectId: 'acme-pilot-2026',
      cpu: '2',
      memory: '2Gi',
      ingress: 'internal',
      minInstances: 1,
      maxInstances: 20,
      secretsProvider: 'gcp-secret-manager',
    });

    assert.ok(tf.includes('provider "google"'));
    assert.ok(tf.includes('google_cloud_run_v2_service'));
    assert.ok(tf.includes('google_secret_manager_secret'));
    assert.ok(tf.includes('cpu    = "2"'));
    assert.ok(tf.includes('memory = "2Gi"'));
    assert.ok(tf.includes('INGRESS_TRAFFIC_INTERNAL_ONLY'));
    assert.ok(tf.includes('min_instance_count = 1'));
    assert.ok(tf.includes('max_instance_count = 20'));
  });

  test('generates Kubernetes manifest YAML with Deployment and Service', () => {
    const k8s = DeployScriptScaffolder.generateKubernetesManifest({
      projectId: 'acme-pilot-2026',
      cpu: '1',
      memory: '1Gi',
      minInstances: 3,
    });

    assert.ok(k8s.includes('apiVersion: apps/v1'));
    assert.ok(k8s.includes('kind: Deployment'));
    assert.ok(k8s.includes('replicas: 3'));
    assert.ok(k8s.includes('cpu: "1"'));
    assert.ok(k8s.includes('memory: "1Gi"'));
    assert.ok(k8s.includes('kind: Service'));
  });

  test('generates Docker Compose YAML for air-gapped pilot container setup', () => {
    const compose = DeployScriptScaffolder.generateDockerCompose({
      projectId: 'acme-pilot-2026',
      memory: '1Gi',
    });

    assert.ok(compose.includes('version: "3.8"') || compose.includes("version: '3.8'"));
    assert.ok(compose.includes('acme-pilot-2026-backend:local') || compose.includes('backend:'));
    assert.ok(compose.includes('memory: 1Gi'));
    assert.ok(compose.includes('ports:'));
  });

  test('generates Terraform with VPC access connector and GPU node selector', () => {
    const tf = DeployScriptScaffolder.generateTerraform({
      projectId: 'acme-pilot-2026',
      cpu: '4',
      memory: '16Gi',
      gpu: 'nvidia-l4',
      vpcId: 'projects/acme-pilot-2026/global/networks/client-vpc',
      subnetId: 'projects/acme-pilot-2026/regions/us-central1/subnetworks/pilot-sub',
    });

    assert.ok(tf.includes('vpc_access {'));
    assert.ok(tf.includes('network    = "projects/acme-pilot-2026/global/networks/client-vpc"'));
    assert.ok(tf.includes('subnetwork = "projects/acme-pilot-2026/regions/us-central1/subnetworks/pilot-sub"'));
    assert.ok(tf.includes('"google.com/gpu" = "1"'));
    assert.ok(tf.includes('cloud.google.com/gke-accelerator'));
    assert.ok(tf.includes('nvidia-l4'));
  });

  test('generates Kubernetes manifest with Subnet annotation and GPU limits', () => {
    const k8s = DeployScriptScaffolder.generateKubernetesManifest({
      projectId: 'acme-pilot-2026',
      cpu: '8',
      memory: '32Gi',
      gpu: 'nvidia-tesla-t4',
      subnetId: 'subnet-0a1b2c3d4e5f',
    });

    assert.ok(k8s.includes('networking.k8s.io/subnet: "subnet-0a1b2c3d4e5f"'));
    assert.ok(k8s.includes('nvidia.com/gpu: "1"'));
    assert.ok(k8s.includes('cpu: "8"'));
    assert.ok(k8s.includes('memory: "32Gi"'));
  });
});
