/**
 * test/suite/dockerDiscovery.test.ts — Unit tests for Docker Desktop discovery and resilient launch
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { findDockerDesktopPath, getDockerLaunchCommand } from '../../core/processUtil';

suite('Docker Desktop Discovery & Launch Command Suite', () => {
  test('findDockerDesktopPath returns string path or null without throwing', () => {
    const result = findDockerDesktopPath();
    assert.ok(result === null || typeof result === 'string');
    if (result) {
      assert.ok(fs.existsSync(result), `Discovered Docker path must exist on disk: ${result}`);
      if (process.platform === 'win32') {
        assert.ok(result.toLowerCase().endsWith('docker desktop.exe'), `Windows path must end with Docker Desktop.exe: ${result}`);
      }
    }
  });

  test('getDockerLaunchCommand returns valid command structure', () => {
    const launch = getDockerLaunchCommand(false);
    assert.strictEqual(typeof launch.cmd, 'string');
    assert.ok(launch.cmd.length > 0);
    assert.strictEqual(typeof launch.isInstalled, 'boolean');

    if (launch.isInstalled) {
      assert.ok(launch.path !== null);
      if (process.platform === 'win32') {
        assert.ok(launch.cmd.includes('Start-Process'));
      }
    } else {
      assert.strictEqual(launch.path, null);
      if (process.platform === 'win32') {
        assert.ok(launch.cmd.includes('winget install'));
        assert.ok(launch.cmd.includes('Docker.DockerDesktop'));
      }
    }
  });

  test('getDockerLaunchCommand with forceInstall=true generates install-and-start command', () => {
    const installLaunch = getDockerLaunchCommand(true);
    assert.strictEqual(installLaunch.isInstalled, false);
    assert.strictEqual(installLaunch.path, null);
    if (process.platform === 'win32') {
      assert.ok(installLaunch.cmd.includes('winget install'));
      assert.ok(installLaunch.cmd.includes('Docker.DockerDesktop'));
      assert.ok(installLaunch.cmd.includes('Start-Process'));
    } else if (process.platform === 'darwin') {
      assert.ok(installLaunch.cmd.includes('brew install --cask docker'));
    } else {
      assert.ok(installLaunch.cmd.includes('curl -fsSL https://get.docker.com'));
    }
  });
});
