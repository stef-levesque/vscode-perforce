import { Uri, EventEmitter, Event, SourceControl, SourceControlResourceGroup, Disposable, window } from 'vscode';
import { Utils } from '../Utils';
import { Display } from '../Display';
import { Resource } from './Resource';
import { ResourceGroup, DefaultGroup, PendingGroup, ShelvedGroup } from './ResourceGroups';

import * as Path from 'path';


export class Model implements Disposable {
    private _disposables: Disposable[] = [];

    private _onDidChange = new EventEmitter<SourceControlResourceGroup[]>();
    public get onDidChange(): Event<SourceControlResourceGroup[]> {
        return this._onDidChange.event;
    }

    public dispose() {
        if (this._disposables) {
            this._disposables.forEach(d => d.dispose());
            this._disposables = [];
        }
    }

    public _sourceControl: SourceControl;

    private _defaultGroup: SourceControlResourceGroup;
    private _pendingGroups: SourceControlResourceGroup[] = [];
    private _shelvedGroups: SourceControlResourceGroup[] = [];

    public get ResourceGroups(): SourceControlResourceGroup[] {
        const result: SourceControlResourceGroup[] = [];

        if (this._defaultGroup)
            result.push(this._defaultGroup);
        
        this._pendingGroups.forEach((value) => {
            result.push(value);
        });

        this._shelvedGroups.forEach((value) => {
            result.push(value);
        });
        
        return result;
    }

    public constructor() {}

    public async Refresh(): Promise<void> {
        this.clean();

        const loggedin = await Utils.isLoggedIn();
        if (!loggedin) {
            return;
        }

        window.withScmProgress( () => this.update() );
    }

    public async Submit(input: Uri | string | number): Promise<void> {
        const command = 'submit';
        let args = '';
        
        if (input instanceof Uri && input.scheme === 'p4-resource-group') {
            args = '-c ' + input.path.substr(input.path.indexOf(':') + 1);
    }
        else if (typeof input === 'number') {
            args = '-c ' + input.toString();
        } else {
            args = input ? '-d ' + input : '';
        }

        Utils.getOutput(command, null, null, args).then((output) => {
            Display.channel.append(output);
            this.Refresh();
        }).catch((reason) => {
            Display.showError(reason);
        });
    }

    private clean() {
        if (this._defaultGroup) {
            this._defaultGroup.dispose();
        }

        this._pendingGroups.forEach((value) => value.dispose());
        this._shelvedGroups.forEach((value) => value.dispose());

    }

    private async update(): Promise<void> {
        const loggedin = await Utils.isLoggedIn();
        if (!loggedin) {
            return;
        }
        
        const output: string = await Utils.getOutput('opened');
        var opened = output.trim().split('\n');
        if (opened.length === 0) {
            return;
        }

        let defaults: Resource[] = [];
        let pendings = new Map<number, Resource[]>();
        let shelved = new Map<number, Resource[]>();

        for (let i = 0, n = opened.length; i < n; ++i) {
            // depot-file#rev - action chnum change (type) [lock-status]
            const matches = opened[i].match(/(.+)#(\d+)\s-\s([\w\/]+)\s(default\schange|change\s\d+)\s\((\w+)\)/);

            if (matches) {
                const depotFile = matches[1];
                const rev = matches[2];
                const action = matches[3];
                const change = matches[4];
                const type = matches[5];

                const output: string = await Utils.getOutput('fstat', depotFile, null, '-T clientFile');

                if (output.indexOf('... clientFile ') === 0) {
                    const clientFile = output.substring(15, output.indexOf('\n')).trim();
                    const uri = Uri.file(clientFile);
                    const resource: Resource = new Resource(uri, change, action);

                    if (change === 'default change') {
                        defaults.push(resource);
                    } else {
                        let chnum: number = parseInt( change.substr(change.indexOf(' ')).trim() );

                        if (!pendings.has(chnum)) {
                            pendings.set(chnum, []);
                        }
                        pendings.get(chnum).push(resource);
                    }
                }
            }

        }

        //TODO shelved

        this._defaultGroup = this._sourceControl.createResourceGroup('default', 'Default Changelist');
        this._defaultGroup.resourceStates = defaults;

        pendings.forEach( (value, key) => {
            const chnum = key.toString();
            const pending = this._sourceControl.createResourceGroup(chnum, 'Changelist #' + chnum);
            pending.resourceStates = value;
            this._pendingGroups.push( pending );
        });

        this._onDidChange.fire(this.ResourceGroups);

    }
}