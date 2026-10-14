/**
 * ui/enterpriseTrialRequest.ts — ask Evolve Mind Solutions for an Enterprise trial.
 *
 * A trial is never switched on locally. The user sends a request by email; once it is
 * approved, Evolve Mind Solutions issues a signed 30-day key
 * (`node scripts/issue-license.js --trial ...`) and the user activates it with
 * "Enter Licence Key", which verifies the Ed25519 signature like any other licence.
 */

import * as vscode from 'vscode';
import * as os from 'os';

export const TRIAL_REQUEST_EMAIL = 'sales@evolveminds.com.au';

export type TrialRequestOutcome = 'sent' | 'enter-key' | 'cancelled';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Collects the requester's details, drafts the request email, and tells the user what
 * happens next. Returns 'enter-key' when the user already has a key to activate.
 */
export async function requestEnterpriseTrial(source: string, extensionVersion: string): Promise<TrialRequestOutcome> {
  const email = await vscode.window.showInputBox({
    title: 'Request an Evolve AI Enterprise trial (1/2)',
    prompt: 'Your work email. The approved trial key is sent here.',
    placeHolder: 'name@company.com',
    ignoreFocusOut: true,
    validateInput: v => (EMAIL_RE.test(v.trim()) ? undefined : 'Enter a valid email address'),
  });
  if (!email) return 'cancelled';

  const organisation = await vscode.window.showInputBox({
    title: 'Request an Evolve AI Enterprise trial (2/2)',
    prompt: 'Your organisation',
    placeHolder: 'Company name',
    ignoreFocusOut: true,
    validateInput: v => (v.trim() ? undefined : 'Enter your organisation'),
  });
  if (!organisation) return 'cancelled';

  const subject = `Evolve AI Enterprise trial request — ${organisation.trim()}`;
  const body = [
    'Hello Evolve Mind Solutions,',
    '',
    'I would like to request a 30-day Evolve AI Enterprise trial.',
    '',
    `Work email: ${email.trim()}`,
    `Organisation: ${organisation.trim()}`,
    'Name: ',
    'What I would like to evaluate: ',
    '',
    `Requested from: VS Code extension ${extensionVersion} (${source})`,
    `Platform: ${os.platform()} ${os.arch()}`,
  ].join('\n');

  const mailto = `mailto:${TRIAL_REQUEST_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  // Passed as a string on purpose. A vscode.Uri re-serialises the query: encoded, it turns
  // "&body=" into "%26body%3D"; decoded, an "&" in the organisation name splits the body.
  // openExternal accepts a string at runtime and hands it to the OS unchanged.
  await vscode.env.openExternal(mailto as unknown as vscode.Uri);

  const choice = await vscode.window.showInformationMessage(
    `Your trial request is ready in your email app — send it to ${TRIAL_REQUEST_EMAIL}. ` +
      'Once it is approved you will receive a trial key by email; activate it with "Enter Licence Key".',
    'Copy Request',
    'I Have a Key',
  );
  if (choice === 'Copy Request') {
    await vscode.env.clipboard.writeText(`To: ${TRIAL_REQUEST_EMAIL}\nSubject: ${subject}\n\n${body}`);
    vscode.window.showInformationMessage(`Request copied. Paste it into an email to ${TRIAL_REQUEST_EMAIL}.`);
  }
  return choice === 'I Have a Key' ? 'enter-key' : 'sent';
}
