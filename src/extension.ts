'use strict';

import { ExtensionContext } from 'vscode';

import { PerforceCommands } from './PerforceCommands';
import { PerforceContentProvider } from './ContentProvider';
import FileSystemListener from './FileSystemListener';
import { PerforceSCMProvider } from './ScmProvider';
import { Display } from './Display';

export function activate(ctx: ExtensionContext) : void {
    //Register all commands
    PerforceCommands.registerCommands();
    Display.initialize();
    ctx.subscriptions.push(new PerforceContentProvider());
    ctx.subscriptions.push(new FileSystemListener());
    ctx.subscriptions.push( new PerforceSCMProvider() );
}