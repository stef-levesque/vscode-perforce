'use strict';

import {
    ExtensionContext, 
    workspace,
    window
} from 'vscode';

import {PerforceCommands} from './PerforceCommands';
import FileSystemListener from './FileSystemListener';
import {Display} from './Display';

export function activate(ctx: ExtensionContext) : void {
    //Register all commands
    PerforceCommands.registerCommands();
    Display.initialize();
    ctx.subscriptions.push(new FileSystemListener());
}