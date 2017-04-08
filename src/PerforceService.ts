import {
	workspace,
    window,
    TextDocument
} from 'vscode';

import { Utils } from './Utils';
import { Display } from './Display';
import { PerforceSCMProvider } from './ScmProvider';

import * as CP from 'child_process';

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

    export function execute(command: string, responseCallback: (err: Error, stdout: string, stderr: string) => void, args?: string, directoryOverride?: string, input?: string): void {
        execCommand(command, responseCallback, args, directoryOverride, input);
    }

    export function executeAsPromise(command: string, args?: string, directoryOverride?: string, input?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            execCommand(command, (err, stdout, stderr) => {
                if(err) {
                    reject(err.message);
                } else if(stderr) {
                    reject(stderr);
                } else {
                    resolve(stdout.toString());
                }
            }, args, directoryOverride, input);
        });
    }

    function execCommand(command:string, responseCallback: (err: Error, stdout: string, stderr: string) => void, args?: string, directoryOverride?: string, input?: string) {
        var cmdLine = _perforceCmdPath;

        if(directoryOverride != null) {
            cmdLine += ' -d ' + directoryOverride;
        }   
        cmdLine += ' ' + command;

        if(args != null) {
            cmdLine += ' ' + args;
        }     

        Display.channel.appendLine(cmdLine);
        console.log(`execCommand: ${cmdLine}`);
        var child = CP.exec(cmdLine, {cwd: workspace.rootPath}, responseCallback);

        if (input != null) {
            child.stdin.end(input, 'utf8');
        }

    }

    export function handleCommonServiceResponse(err: Error, stdout: string, stderr: string) {
        if(err){
            Display.showError(stderr.toString());
        } else {
            Display.channel.append(stdout.toString());
            Display.updateEditor();
            PerforceSCMProvider.Refresh();
        }
    }

    export function getClientRoot() : Promise<string> {
        return new Promise((resolve, reject) => {
            PerforceService.executeAsPromise('info').then((stdout) =>{
                var clientRootIndex = stdout.indexOf('Client root: ');
                if(clientRootIndex === -1) {
                    reject("P4 Info didn't specify a valid Client Root path");
                    return;
                }

                clientRootIndex += 'Client root: '.length;
                var endClientRootIndex = stdout.indexOf('\n', clientRootIndex);
                if(endClientRootIndex === -1) {
                    reject("P4 Info Client Root path contains unexpected format");
                    return;
                }

                //Resolve with client root as string
                resolve(stdout.substring(clientRootIndex, endClientRootIndex));
            }).catch((err) => {
                reject(err);
            });
        });
    }
}

var _perforceCmdPath = PerforceService.getPerforceCmdPath();