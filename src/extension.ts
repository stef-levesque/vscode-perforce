'use strict';

import {
    ExtensionContext, 
    workspace,
    window
} from 'vscode';

import PerforceCommands from './PerforceCommands';
import FileSystemListener from './FileSystemListener';
import {Display} from './Display';

export function activate(ctx: ExtensionContext) : void {
    var perforceCommands = new PerforceCommands();
    ctx.subscriptions.push(perforceCommands);

    //Register all commands
    perforceCommands.registerCommands();

    var config = workspace.getConfiguration('perforce');
    //FileSystemListener is used if we want to do any perforce actions automatically on varius actions
    if(config['editOnFileSave'] || config['editOnFileModified'] || config['addOnFileCreate'] || config['deleteOnFileDelete']) 
    {
        ctx.subscriptions.push(new FileSystemListener());
    }

    Display.initialize();

    window.onDidChangeActiveTextEditor(Display.updateEditor, this, ctx.subscriptions);
}