/**
 * fde/index.ts — Forward Deployed Engineer (FDE) & Delivery Suite registration
 */

import * as vscode from 'vscode';
import type { IServices } from '../core/services';
import { FdeCommands } from '../commands/fdeCommands';

export function registerFdeSuite(vsCtx: vscode.ExtensionContext, services: IServices): void {
  const commands = new FdeCommands(services);
  commands.register();
}

export * from './fdeContext';
export * from './schemaMapper';
export * from './apiConnectorGen';
export * from './runbookGenerator';
export * from '../deployment/preflightAuditor';
export * from '../deployment/firebaseConfigGen';
export * from '../deployment/deployScriptScaffolder';
