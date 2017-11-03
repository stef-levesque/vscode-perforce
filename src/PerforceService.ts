import { IPerforceConfig } from './PerforceService';
import {
    workspace,
    window,
    TextDocument,
    Uri
} from 'vscode';

import { Utils } from './Utils';
import { Display } from './Display';
import { PerforceSCMProvider } from './ScmProvider';

import * as CP from 'child_process';

export interface IPerforceConfig {

    // p4 standard configuration variables
    p4Client?: string;
    p4Host?: string;
    p4Pass?: string;
    p4Port?: number;
    p4Tickets?: string;
    p4User?: string;

    // specific to this exension
    // use this value as the clientRoot PWD for this .p4config file's location
    p4Dir?: string;

    // root directory of the user space (or .p4config)
    localDir: string;

    // whether to strip the localDir when calling espansePath
    stripLocalDir?: boolean;
}

export namespace PerforceService {

    // todo: convert this to an object with local config and cached cmdpath
    // note that there are still some early commands that need static access

    let _config: IPerforceConfig;

    export function setConfig(inConfig: IPerforceConfig): void {
        _config = inConfig;
    }
    export function getConfig(): IPerforceConfig {
        return _config;
    }
    export function convertToRel(path: string): string {
        if (!_config
            || !_config.stripLocalDir
            || !_config.localDir || _config.localDir.length === 0
            || !_config.p4Dir || _config.p4Dir.length === 0) {

            return path;
        }

        const pathN = Utils.normalize(path);
        if (pathN.startsWith(_config.localDir)) {
            path = pathN.slice(_config.localDir.length);
        }
        return path;
    }

    export function getPerforceCmdPath(resource: Uri): string {
        var p4Path = workspace.getConfiguration('perforce', resource).get('command', 'none');
        var p4User = workspace.getConfiguration('perforce', resource).get('user', 'none');
        var p4Client = workspace.getConfiguration('perforce', resource).get('client', 'none');
        var p4Port = workspace.getConfiguration('perforce', resource).get('port', 'none');
        var p4Pass = workspace.getConfiguration('perforce', resource).get('password', 'none');
        var p4Dir = workspace.getConfiguration('perforce', resource).get('dir', 'none');

        const buildCmd = (value, arg): string => {
            if (!value || value === 'none')
                return '';
            return ` ${arg} ${value}`;
        }

        if (p4Path == 'none') {
            var isWindows = /^win/.test(process.platform);
            p4Path = isWindows ? 'p4.exe' : 'p4';
        } else {
            const toUNC = (path: string): string => {
                let uncPath = path;

                if (uncPath.indexOf('\\\\') !== 0) {
                    const replaceable = uncPath.split('\\');
                    uncPath = replaceable.join('\\\\');
                }

                uncPath = `"${uncPath}"`;
                return uncPath;
            }

            p4Path = toUNC(p4Path);
        }

        p4Path += buildCmd(p4User, '-u');
        p4Path += buildCmd(p4Client, '-c');
        p4Path += buildCmd(p4Port, '-p');
        p4Path += buildCmd(p4Pass, '-P');
        p4Path += buildCmd(p4Dir, '-d');

        // later args override earlier args
        if (_config) {
            p4Path += buildCmd(_config.p4User, '-u');
            p4Path += buildCmd(_config.p4Client, '-c');
            p4Path += buildCmd(_config.p4Port, '-p');
            p4Path += buildCmd(_config.p4Pass, '-P');
            p4Path += buildCmd(_config.p4Dir, '-d');
        }

        return p4Path;
    }

    export function execute(resource: Uri, command: string, responseCallback: (err: Error, stdout: string, stderr: string) => void, args?: string, directoryOverride?: string, input?: string): void {
        execCommand(resource, command, responseCallback, args, directoryOverride, input);
    }

    export function executeAsPromise(resource: Uri, command: string, args?: string, directoryOverride?: string, input?: string): Promise<string> {
        return new Promise((resolve, reject) => {
            execCommand(resource, command, (err, stdout, stderr) => {
                if (err) {
                    reject(err.message);
                } else if (stderr) {
                    reject(stderr);
                } else {
                    resolve(stdout.toString());
                }
            }, args, directoryOverride, input);
        });
    }

    function execCommand(resource: Uri, command: string, responseCallback: (err: Error, stdout: string, stderr: string) => void, args?: string, directoryOverride?: string, input?: string) {
        const wksFolder = workspace.getWorkspaceFolder(resource);
        const wksPath = wksFolder ? wksFolder.uri.fsPath : '';
        var cmdLine = getPerforceCmdPath(resource);
        const maxBuffer = workspace.getConfiguration('perforce').get('maxBuffer', 200 * 1024);

        if (directoryOverride != null) {
            cmdLine += ' -d ' + directoryOverride;
        }
        cmdLine += ' ' + command;

        if (args != null) {
            if (_config && _config.stripLocalDir) {
                args = args.replace(_config.localDir, '');
            }

            cmdLine += ' ' + args;
        }

        Display.channel.appendLine(cmdLine);
        const cmdArgs = { cwd: _config ? _config.localDir : wksPath, maxBuffer: maxBuffer };
        var child = CP.exec(cmdLine, cmdArgs, responseCallback);

        if (input != null) {
            child.stdin.end(input, 'utf8');
        }
    }

    export function handleInfoServiceResponse(err: Error, stdout: string, stderr: string) {
        if (err) {
            Display.showError(stderr.toString());
        } else {
            Display.channel.append(stdout.toString());
        }
    }
    
    export function handleCommonServiceResponse(err: Error, stdout: string, stderr: string) {
        if (err) {
            Display.showError(stderr.toString());
        } else {
            Display.channel.append(stdout.toString());
            Display.updateEditor();
            PerforceSCMProvider.Refresh();
        }
    }

    export function getClientRoot(resource: Uri): Promise<string> {
        return new Promise((resolve, reject) => {
            PerforceService.executeAsPromise(resource, 'info').then((stdout) => {
                var clientRootIndex = stdout.indexOf('Client root: ');
                if (clientRootIndex === -1) {
                    reject("P4 Info didn't specify a valid Client Root path");
                    return;
                }

                clientRootIndex += 'Client root: '.length;
                var endClientRootIndex = stdout.indexOf('\n', clientRootIndex);
                if (endClientRootIndex === -1) {
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

    export function getConfigFilename(resource: Uri): Promise<string> {
        return new Promise((resolve, reject) => {
            PerforceService.executeAsPromise(resource, 'set', '-q').then((stdout) => {
                var configIndex = stdout.indexOf('P4CONFIG=');
                if (configIndex === -1) {
                    resolve('.p4config');
                    return;
                }

                configIndex += 'P4CONFIG='.length;
                var endConfigIndex = stdout.indexOf('\n', configIndex);
                if (endConfigIndex === -1) {
                    //reject("P4 set -q parsing for P4CONFIG contains unexpected format");
                    resolve('.p4config');
                    return;
                }

                //Resolve with p4 config filename as string
                resolve(stdout.substring(configIndex, endConfigIndex));
            }).catch((err) => {
                reject(err);
            });
        });
    }
}
