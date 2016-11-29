import {
	workspace,
    window
} from 'vscode';

import {Utils} from './Utils';
import {Display} from './Display';

import * as CP from 'child_process';

var perforceCmdPath = PerforceService.getPerforceCmdPath();

export namespace PerforceService {

    export function getPerforceCmdPath() : string {
        var p4Path = workspace.getConfiguration('perforce').get('command', 'none');
        var p4Client = workspace.getConfiguration('perforce').get('client', 'none');

        if(p4Path == 'none') {
            var isWindows = /^win/.test(process.platform);
            p4Path = isWindows ? 'p4.exe' : 'p4';
        } else {
            p4Path = Utils.normalizePath(p4Path);
        }

        if(p4Client !== 'none') {
            p4Path += ' -c ' + p4Client;
        }

        return p4Path;
    }

    export function execute(command: string, responseCallback: (err: Error, stdout: Buffer, stderr: Buffer) => void, args?: string) {
        var cmdLine = this.perforceCmdPath + ' ' + command;
        if(args != null) {
            cmdLine += ' ' + args;
        }

        CP.exec(cmdLine, {cwd: workspace.rootPath}, responseCallback);
    }

    export function handleCommonServiceResponse(err: Error, stdout: Buffer, stderr: Buffer) {
        if(err){
            Display.showError(stderr.toString());
        } else {
            Display.channel.append(stdout.toString());
            Display.updateEditor();
        }
    }
}