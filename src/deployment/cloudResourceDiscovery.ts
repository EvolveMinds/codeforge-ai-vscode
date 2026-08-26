/**
 * deployment/cloudResourceDiscovery.ts — Live Cloud API Resource Discovery
 *
 * Inspects active cloud connections (GCP gcloud, AWS aws-cli, Azure az, Docker)
 * to automatically discover VPCs, subnets, clusters, and security groups.
 * Provides safe, non-destructive read-only queries with clear auth guidance.
 */

import { runForStdout } from '../core/processUtil';

export interface DiscoveredCloudResources {
  provider: 'gcp-firebase' | 'aws' | 'azure' | 'docker' | 'unknown';
  authenticated: boolean;
  activeAccount?: string;
  activeProject?: string;
  region?: string;
  vpcs: string[];
  subnets: string[];
  clusters: string[];
  regions: string[];
  securityGroups: string[];
  rawMessage?: string;
  authHelpPrompt?: string;
}

export class CloudResourceDiscovery {
  /**
   * Universal entry point to discover cloud resources based on target VPC provider.
   */
  static async discover(options: {
    provider: 'gcp-firebase' | 'aws' | 'azure' | 'docker' | string;
    projectId?: string;
    region?: string;
    cwd?: string;
  }): Promise<DiscoveredCloudResources> {
    const cwd = options.cwd || process.cwd();
    const provider = options.provider;

    if (provider === 'gcp-firebase' || provider === 'gcp') {
      return this.discoverGcp(options.projectId, options.region, cwd);
    } else if (provider === 'aws') {
      return this.discoverAws(options.region, cwd);
    } else if (provider === 'azure') {
      return this.discoverAzure(cwd);
    } else if (provider === 'docker') {
      return this.discoverDocker(cwd);
    }

    return {
      provider: 'unknown',
      authenticated: false,
      vpcs: [],
      subnets: [],
      clusters: [],
      regions: [],
      securityGroups: [],
      rawMessage: `Unsupported or unspecified provider: ${provider}`,
    };
  }

  /**
   * Discovers Google Cloud VPC networks, subnets, and Cloud Run services.
   */
  static async discoverGcp(projectId?: string, region = 'us-central1', cwd?: string): Promise<DiscoveredCloudResources> {
    const res: DiscoveredCloudResources = {
      provider: 'gcp-firebase',
      authenticated: false,
      region,
      vpcs: [],
      subnets: [],
      clusters: [],
      regions: ['us-central1', 'us-east1', 'us-west1', 'europe-west1', 'australia-southeast1', 'asia-southeast1'],
      securityGroups: [],
    };

    try {
      // 1. Check Auth & Active Project
      const authOut = await runForStdout('gcloud', ['config', 'get-value', 'account'], { cwd, timeoutMs: 8000 });
      if (authOut && authOut.trim() && !authOut.includes('ERROR') && !authOut.includes('unset')) {
        res.authenticated = true;
        res.activeAccount = authOut.trim();
      }

      const projOut = await runForStdout('gcloud', ['config', 'get-value', 'project'], { cwd, timeoutMs: 8000 });
      if (projOut && projOut.trim() && !projOut.includes('ERROR') && !projOut.includes('unset')) {
        res.activeProject = projOut.trim();
      } else if (projectId) {
        res.activeProject = projectId;
      }

      if (!res.authenticated) {
        res.authHelpPrompt = 'Run "gcloud auth login" or "gcloud auth application-default login" to authenticate with Google Cloud.';
        res.rawMessage = 'Google Cloud CLI is installed but not authenticated.';
        return res;
      }

      // 2. Discover VPC Networks
      const vpcArgs = ['compute', 'networks', 'list', '--format=json'];
      if (res.activeProject) vpcArgs.push(`--project=${res.activeProject}`);
      const vpcOut = await runForStdout('gcloud', vpcArgs, { cwd, timeoutMs: 12000 });
      res.vpcs = this.parseGcpNetworks(vpcOut || '');

      // 3. Discover Subnets in target region
      const subArgs = ['compute', 'networks', 'subnets', 'list', '--format=json'];
      if (res.activeProject) subArgs.push(`--project=${res.activeProject}`);
      if (region) subArgs.push(`--filter=region:(${region})`);
      const subOut = await runForStdout('gcloud', subArgs, { cwd, timeoutMs: 12000 });
      res.subnets = this.parseGcpSubnets(subOut || '');

      // 4. Discover Cloud Run Services
      const runArgs = ['run', 'services', 'list', '--format=json', `--region=${region}`];
      if (res.activeProject) runArgs.push(`--project=${res.activeProject}`);
      const runOut = await runForStdout('gcloud', runArgs, { cwd, timeoutMs: 10000 });
      res.clusters = this.parseGcpRunServices(runOut || '');

      res.rawMessage = `Successfully discovered ${res.vpcs.length} VPCs and ${res.subnets.length} subnets from GCP project '${res.activeProject || 'active'}'.`;
    } catch (e: any) {
      res.rawMessage = `GCP discovery encountered: ${e?.message || e}`;
      res.authHelpPrompt = 'Ensure gcloud CLI is in PATH and run "gcloud auth login".';
    }

    return res;
  }

  /**
   * Discovers AWS VPCs, Subnets, and ECS Clusters.
   */
  static async discoverAws(region = 'us-east-1', cwd?: string): Promise<DiscoveredCloudResources> {
    const res: DiscoveredCloudResources = {
      provider: 'aws',
      authenticated: false,
      region,
      vpcs: [],
      subnets: [],
      clusters: [],
      regions: ['us-east-1', 'us-east-2', 'us-west-2', 'eu-west-1', 'ap-southeast-2', 'ap-southeast-1'],
      securityGroups: [],
    };

    try {
      // 1. Check STS Caller Identity
      const stsOut = await runForStdout('aws', ['sts', 'get-caller-identity', '--output', 'json'], { cwd, timeoutMs: 8000 });
      try {
        const stsJson = JSON.parse(stsOut || '{}');
        if (stsJson.Account) {
          res.authenticated = true;
          res.activeAccount = stsJson.Account;
          res.activeProject = stsJson.Arn || stsJson.Account;
        }
      } catch {
        // not json
      }

      if (!res.authenticated) {
        res.authHelpPrompt = 'Run "aws configure" or set AWS_ACCESS_KEY_ID & AWS_SECRET_ACCESS_KEY to authenticate.';
        res.rawMessage = 'AWS CLI is not authenticated.';
        return res;
      }

      // 2. Describe VPCs
      const vpcOut = await runForStdout('aws', ['ec2', 'describe-vpcs', '--region', region, '--output', 'json'], { cwd, timeoutMs: 10000 });
      res.vpcs = this.parseAwsVpcs(vpcOut || '');

      // 3. Describe Subnets
      const subOut = await runForStdout('aws', ['ec2', 'describe-subnets', '--region', region, '--output', 'json'], { cwd, timeoutMs: 10000 });
      res.subnets = this.parseAwsSubnets(subOut || '');

      // 4. Describe Security Groups
      const sgOut = await runForStdout('aws', ['ec2', 'describe-security-groups', '--region', region, '--output', 'json'], { cwd, timeoutMs: 10000 });
      res.securityGroups = this.parseAwsSecurityGroups(sgOut || '');

      // 5. List ECS Clusters
      const ecsOut = await runForStdout('aws', ['ecs', 'list-clusters', '--region', region, '--output', 'json'], { cwd, timeoutMs: 8000 });
      try {
        const ecsJson = JSON.parse(ecsOut || '{}');
        res.clusters = (ecsJson.clusterArns || []).map((arn: string) => arn.split('/').pop() || arn);
      } catch {}

      res.rawMessage = `Successfully discovered ${res.vpcs.length} VPCs and ${res.subnets.length} subnets from AWS account '${res.activeAccount}'.`;
    } catch (e: any) {
      res.rawMessage = `AWS discovery encountered: ${e?.message || e}`;
      res.authHelpPrompt = 'Ensure aws-cli is installed and configured via "aws configure".';
    }

    return res;
  }

  /**
   * Discovers Azure VNETs and Subnets.
   */
  static async discoverAzure(cwd?: string): Promise<DiscoveredCloudResources> {
    const res: DiscoveredCloudResources = {
      provider: 'azure',
      authenticated: false,
      vpcs: [],
      subnets: [],
      clusters: [],
      regions: ['eastus', 'westus2', 'westeurope', 'australiaeast', 'southeastasia'],
      securityGroups: [],
    };

    try {
      const accOut = await runForStdout('az', ['account', 'show', '-o', 'json'], { cwd, timeoutMs: 8000 });
      try {
        const acc = JSON.parse(accOut || '{}');
        if (acc.id) {
          res.authenticated = true;
          res.activeAccount = acc.user?.name || acc.name;
          res.activeProject = acc.id;
        }
      } catch {}

      if (!res.authenticated) {
        res.authHelpPrompt = 'Run "az login" to authenticate with Microsoft Azure.';
        res.rawMessage = 'Azure CLI is not logged in.';
        return res;
      }

      const vnetOut = await runForStdout('az', ['network', 'vnet', 'list', '-o', 'json'], { cwd, timeoutMs: 10000 });
      try {
        const vnets = JSON.parse(vnetOut || '[]');
        res.vpcs = vnets.map((v: any) => v.name || v.id);
        const allSubs: string[] = [];
        vnets.forEach((v: any) => {
          (v.subnets || []).forEach((s: any) => allSubs.push(`${v.name}/${s.name}`));
        });
        res.subnets = allSubs;
      } catch {}

      res.rawMessage = `Successfully discovered ${res.vpcs.length} Azure VNets.`;
    } catch (e: any) {
      res.rawMessage = `Azure discovery encountered: ${e?.message || e}`;
      res.authHelpPrompt = 'Run "az login" to connect Azure CLI.';
    }

    return res;
  }

  /**
   * Discovers Local Docker Networks and System Resources.
   */
  static async discoverDocker(cwd?: string): Promise<DiscoveredCloudResources> {
    const res: DiscoveredCloudResources = {
      provider: 'docker',
      authenticated: false,
      vpcs: [],
      subnets: [],
      clusters: [],
      regions: ['local-host', 'bridge', 'host', 'none'],
      securityGroups: [],
    };

    try {
      const netOut = await runForStdout('docker', ['network', 'ls', '--format', '{{.Name}}'], { cwd, timeoutMs: 6000 });
      if (netOut && !netOut.includes('error') && !netOut.includes('Cannot connect')) {
        res.authenticated = true;
        res.vpcs = netOut.split('\n').map(s => s.trim()).filter(Boolean);
        res.rawMessage = `Docker Daemon active with ${res.vpcs.length} networks.`;
      } else {
        res.rawMessage = 'Docker Daemon is not running or unreachable.';
        res.authHelpPrompt = 'Ensure Docker Desktop / daemon is started locally.';
      }
    } catch (e: any) {
      res.rawMessage = `Docker discovery encountered: ${e?.message || e}`;
      res.authHelpPrompt = 'Start Docker Desktop to enable container discovery.';
    }

    return res;
  }

  // --- Parsing Helpers ---

  static parseGcpNetworks(stdout: string): string[] {
    try {
      const data = JSON.parse(stdout);
      if (Array.isArray(data)) {
        return data.map((n: any) => n.name || n.selfLink || '').filter(Boolean);
      }
    } catch {}
    return [];
  }

  static parseGcpSubnets(stdout: string): string[] {
    try {
      const data = JSON.parse(stdout);
      if (Array.isArray(data)) {
        return data.map((s: any) => s.name || s.selfLink || '').filter(Boolean);
      }
    } catch {}
    return [];
  }

  static parseGcpRunServices(stdout: string): string[] {
    try {
      const data = JSON.parse(stdout);
      if (Array.isArray(data)) {
        return data.map((s: any) => s.metadata?.name || s.name || '').filter(Boolean);
      }
    } catch {}
    return [];
  }

  static parseAwsVpcs(stdout: string): string[] {
    try {
      const data = JSON.parse(stdout);
      if (data.Vpcs && Array.isArray(data.Vpcs)) {
        return data.Vpcs.map((v: any) => {
          const nameTag = (v.Tags || []).find((t: any) => t.Key === 'Name')?.Value;
          return nameTag ? `${v.VpcId} (${nameTag})` : v.VpcId;
        });
      }
    } catch {}
    return [];
  }

  static parseAwsSubnets(stdout: string): string[] {
    try {
      const data = JSON.parse(stdout);
      if (data.Subnets && Array.isArray(data.Subnets)) {
        return data.Subnets.map((s: any) => {
          const nameTag = (s.Tags || []).find((t: any) => t.Key === 'Name')?.Value;
          return nameTag ? `${s.SubnetId} (${nameTag})` : s.SubnetId;
        });
      }
    } catch {}
    return [];
  }

  static parseAwsSecurityGroups(stdout: string): string[] {
    try {
      const data = JSON.parse(stdout);
      if (data.SecurityGroups && Array.isArray(data.SecurityGroups)) {
        return data.SecurityGroups.map((sg: any) => `${sg.GroupId} (${sg.GroupName})`);
      }
    } catch {}
    return [];
  }
}
