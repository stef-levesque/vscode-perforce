'use strict';

import { ExtensionContext, workspace, commands } from 'vscode';

import { PerforceCommands } from './PerforceCommands';
import { PerforceContentProvider } from './ContentProvider';
import FileSystemListener from './FileSystemListener';
import { PerforceSCMProvider } from './ScmProvider';
import { Display } from './Display';

export function activate(ctx: ExtensionContext) : void {
    const compatibilityMode = workspace.getConfiguration('perforce').get('compatibilityMode', 'perforce');
    commands.executeCommand('setContext', 'perforce.compatibilityMode', compatibilityMode);

    //Register all commands
    PerforceCommands.registerCommands();
    Display.initialize();
    ctx.subscriptions.push(new PerforceContentProvider(compatibilityMode));
    ctx.subscriptions.push(new FileSystemListener());
    ctx.subscriptions.push(new PerforceSCMProvider(compatibilityMode));
}